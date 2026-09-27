"""
ORBITAL-X1 Physics Tick

The single pure function `tick(state, dt)` advances the simulation by
`dt` simulated seconds. It mutates `state` in place (so the function is
side-effectful) but does not read external state — easy to test.

Correlation rules (from spec):
  - fuel ↓ → fuel_flow changes → engine state → thrust changes
  - battery + solar_generation − power_consumption = new battery
  - temperature = heat_generation − heat_dissipation
  - comms depend on spacecraft state + simulated distance/environment
  - small controlled noise everywhere
"""
from __future__ import annotations

import math

from src.noise import bounded_noise
from src.state import SpacecraftState


# --- Constants for the NORMAL scenario ---
FUEL_PRESSURE_BASE = 2.0        # MPa at fuel_level=0
FUEL_PRESSURE_RANGE = 0.8       # additional MPa at fuel_level=100
NOMINAL_FUEL_FLOW = 0.5         # kg/s
NOMINAL_ENGINE_TEMP = 78.0      # Celsius
COLD_ENGINE_TEMP = 65.0         # Celsius when thrust < 50%
ENGINE_TEMP_RESPONSE = 0.1      # how fast engine temp converges

NOMINAL_SOLAR = 8.0             # A
NOMINAL_CONSUMPTION = 5.5       # kW
HIGH_TEMP_POWER_PENALTY = 0.05  # kW per °C above 80
POWER_TEMP_THRESHOLD = 80.0

CPU_NOMINAL_TEMP = 45.0         # Celsius
RADIATOR_NOMINAL_TEMP = -10.0   # Celsius
CPU_TEMP_RESPONSE = 0.1

DISTANCE_NORM = 7000.0          # km — baseline for signal/latency
SIGNAL_BASE = -50.0             # dBm
LATENCY_BASE = 250.0            # ms

CPU_USAGE_BASE = 35.0           # percent
CPU_TEMP_THROTTLE_THRESHOLD = 80.0
CPU_USAGE_THROTTLE_GAIN = 0.5


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def tick(state: SpacecraftState, dt: float) -> SpacecraftState:
    """Advance `state` by `dt` simulated seconds. Mutates and returns it.

    Speed is handled by the caller: the loop calls `tick` once per
    simulated second and uses the clock to advance time at the right
    wall-clock rate. `state.speed` is kept in sync for telemetry and
    for tests that want to know the configured rate, but the physics
    math itself uses `dt` as-given so a single tick is always stable.
    """
    if state.is_paused:
        return state

    # Advance the simulation clock by exactly `dt` simulated seconds.
    state.simulation_time += dt

    _tick_propulsion(state, dt)
    _tick_power(state, dt)
    _tick_thermal(state, dt)
    _tick_communications(state, dt)
    _tick_flight_computer(state, dt)
    _tick_navigation(state, dt)

    return state


# ---------------------------------------------------------------------
# Subsystem ticks
# ---------------------------------------------------------------------

def _tick_propulsion(state: SpacecraftState, dt: float) -> None:
    p = state.propulsion

    # Fuel consumption scales with thrust (0..1)
    thrust_fraction = p.thrust / 100.0
    base_consumption = 0.005 * dt * (0.1 + thrust_fraction)
    p.fuel_level = max(0.0, p.fuel_level - base_consumption)

    # Fuel pressure correlates with fuel level (spec: 2.0–2.8 MPa normal)
    pressure_clean = FUEL_PRESSURE_BASE + (p.fuel_level / 100.0) * FUEL_PRESSURE_RANGE
    p.fuel_pressure = bounded_noise(pressure_clean, pct=0.01)

    # Fuel flow — stable baseline with small noise
    p.fuel_flow = bounded_noise(NOMINAL_FUEL_FLOW, pct=0.02)

    # Engine temperature converges toward thrust-dependent target
    target = NOMINAL_ENGINE_TEMP if p.thrust > 50 else COLD_ENGINE_TEMP
    p.engine_temperature += (target - p.engine_temperature) * ENGINE_TEMP_RESPONSE * dt
    p.engine_temperature = bounded_noise(p.engine_temperature, pct=0.005)


def _tick_power(state: SpacecraftState, dt: float) -> None:
    pw = state.power
    p = state.propulsion

    # Solar generation is stable in NORMAL (no orientation changes yet).
    # Perturb the current value rather than overwrite it so caller's setup
    # values (e.g. tests forcing a discharge regime) survive the tick.
    pw.solar_generation = bounded_noise(pw.solar_generation, pct=0.02)

    # Power consumption rises when engine is hot (cooling load).
    consumption_target = NOMINAL_CONSUMPTION
    if p.engine_temperature > POWER_TEMP_THRESHOLD:
        consumption_target += (p.engine_temperature - POWER_TEMP_THRESHOLD) * HIGH_TEMP_POWER_PENALTY
    # Pull current draw gently toward the engine-driven target
    pw.power_consumption += (consumption_target - pw.power_consumption) * 0.1 * dt
    pw.power_consumption = bounded_noise(pw.power_consumption, pct=0.01)
    pw.current_draw = bounded_noise(pw.power_consumption, pct=0.01)

    # Battery charge: net = (solar − consumption) * dt, in percent
    net_a = pw.solar_generation - pw.current_draw
    # Scale: assume battery capacity such that ~10A net ≈ 1%/s
    pw.battery_level = _clamp(pw.battery_level + net_a * 0.1 * dt, 0.0, 100.0)

    # Voltage tracks level: ~24V empty → ~29V full
    voltage_clean = 24.0 + (pw.battery_level / 100.0) * 5.0
    pw.battery_voltage = bounded_noise(voltage_clean, pct=0.005)


def _tick_thermal(state: SpacecraftState, dt: float) -> None:
    th = state.thermal
    pw = state.power

    # CPU temperature tracks power draw (heat generation)
    heat_factor = pw.power_consumption / NOMINAL_CONSUMPTION
    target = CPU_NOMINAL_TEMP * heat_factor
    th.cpu_temperature += (target - th.cpu_temperature) * CPU_TEMP_RESPONSE * dt
    th.cpu_temperature = bounded_noise(th.cpu_temperature, pct=0.01)

    # Radiator temperature converges to its ambient (cold in space)
    th.radiator_temperature += (RADIATOR_NOMINAL_TEMP - th.radiator_temperature) * 0.05 * dt
    th.radiator_temperature = bounded_noise(th.radiator_temperature, pct=0.01)

    # Cabin is stable (life support regulates it)
    th.cabin_temperature = bounded_noise(22.0, pct=0.01)


def _tick_communications(state: SpacecraftState, dt: float) -> None:
    c = state.communications
    n = state.navigation

    # Distance factor: more distance → weaker signal, more latency
    distance = math.sqrt(n.position_x ** 2 + n.position_y ** 2 + n.position_z ** 2)
    distance_factor = 1.0 - max(0.0, (distance - DISTANCE_NORM) / DISTANCE_NORM) * 0.1

    c.signal_strength = bounded_noise(SIGNAL_BASE * distance_factor, pct=0.02)
    c.packet_loss = bounded_noise(0.1, pct=0.5)  # tight absolute noise
    c.latency = bounded_noise(LATENCY_BASE * distance_factor, pct=0.04)
    c.bandwidth = bounded_noise(10.0, pct=0.05)


def _tick_flight_computer(state: SpacecraftState, dt: float) -> None:
    fc = state.flight_computer
    th = state.thermal

    # Base CPU usage with small jitter
    fc.cpu_usage = bounded_noise(CPU_USAGE_BASE, pct=0.15)
    fc.memory_usage = bounded_noise(55.0, pct=0.04)
    fc.storage_used = bounded_noise(42.0, pct=0.01)

    # Throttling when CPU is hot
    if th.cpu_temperature > CPU_TEMP_THROTTLE_THRESHOLD:
        over = th.cpu_temperature - CPU_TEMP_THROTTLE_THRESHOLD
        throttle = min(60.0, over * CPU_USAGE_THROTTLE_GAIN)
        fc.cpu_usage = min(100.0, fc.cpu_usage + throttle)
        # Persistent thermal stress slowly degrades process health
        fc.process_health = max(0.0, fc.process_health - 0.05 * over * dt)


def _tick_navigation(state: SpacecraftState, dt: float) -> None:
    n = state.navigation
    p = state.propulsion

    # Circular orbit approximation: position magnitude stays ~constant
    distance = math.sqrt(n.position_x ** 2 + n.position_y ** 2 + n.position_z ** 2) or 1.0
    # Use a small constant speed modified by thrust for simplicity
    orbital_speed = 7.8 * (0.95 + 0.05 * (p.thrust / 100.0))

    # Move along the orbit (tangent direction at current position)
    # Tangent = rotate position by 90° in xy plane
    tx = -n.position_y / distance
    ty = n.position_x / distance
    n.position_x += tx * orbital_speed * dt
    n.position_y += ty * orbital_speed * dt
    n.position_z = 0.0  # keep equatorial for now

    n.velocity_x = bounded_noise(tx * orbital_speed, pct=0.001)
    n.velocity_y = bounded_noise(ty * orbital_speed, pct=0.001)
    n.velocity_z = 0.0

    # Tiny orientation drift (would come from attitude control in real life)
    n.orientation_roll = bounded_noise(0.0, pct=0.5)
    n.orientation_pitch = bounded_noise(0.0, pct=0.5)
    n.orientation_yaw = bounded_noise(0.0, pct=0.5)
