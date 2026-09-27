"""
Failure scenario engine for ORBITAL-X1 (Phase 2).

Each scenario describes a gradual failure mode. The engine tracks elapsed
time and exposes a `progress` value (0→1 over the ramp duration). The
`update(state, dt)` method applies correlated, physically-meaningful
effects to the spacecraft state after the base physics tick runs.

Key design principles:
- Failures develop GRADUALLY, not instantly.
- Correlated physics: a failing subsystem affects related subsystems.
- The engine does NOT replace the physics tick; it augments it.

Scenario registry:
    SCENARIOS: dict[str, type[Scenario]]
"""
from __future__ import annotations
import math
from typing import Any, Dict, Type

from src.noise import bounded_noise


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RAMP_DURATION = 60.0  # simulated seconds over which a failure ramps to full severity
LEAK_FUEL_LOSS_RATE = 0.004  # percentage points per second at full leak severity


class Scenario:
    """Base class for all failure scenarios.

    Subclasses override `update()` to apply scenario-specific effects.

    Attributes
    ----------
    name : str
        The scenario identifier (e.g. "NORMAL", "PROPULSION_LEAK").
    elapsed_time : float
        Simulated seconds since this scenario was instantiated.
    ramp_duration : float
        Simulated seconds until progress reaches 1.0.
    """

    name: str = "NORMAL"
    ramp_duration: float = RAMP_DURATION

    def __init__(self):
        self.elapsed_time: float = 0.0

    @property
    def progress(self) -> float:
        """0.0 at t=0, 1.0 once elapsed >= ramp_duration."""
        if self.ramp_duration <= 0:
            return 1.0
        return min(1.0, self.elapsed_time / self.ramp_duration)

    def update(self, state, dt: float) -> None:
        """Apply scenario effects to `state` (mutates in-place).

        Called AFTER the base physics tick in `physics.tick()`.
        Subclasses should call `super().update(state, dt)` first to
        advance elapsed_time.
        """
        self.elapsed_time += dt

    def transform_telemetry(self, frame: Dict[str, Any]) -> Dict[str, Any]:
        """Return a telemetry frame after scenario-specific sensor effects."""
        return dict(frame)


# ---------------------------------------------------------------------------
# Normal scenario — pure baseline, no fault effects
# ---------------------------------------------------------------------------

class NormalScenario(Scenario):
    """NORMAL — baseline with no additional fault effects."""
    name = "NORMAL"

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        # No fault effects; base physics handles everything


# ---------------------------------------------------------------------------
# Propulsion leak — fuel pressure drops, consumption rises, thrust drops
# ---------------------------------------------------------------------------

class PropulsionLeakScenario(Scenario):
    """PROPULSION_LEAK — fuel pressure drops gradually with correlated side effects.

    Failure signature (spec):
        2.5 → 2.4 → 2.3 → 2.1 → 1.9 → 1.7 → 1.5 → 1.3 MPa over ~60s
    Correlated effects:
        - fuel_flow ↑ (leak means more mass escaping)
        - thrust ↓ (lower pressure → less efficient combustion)
        - engine_temperature ↑ (unstable combustion)
    """
    name = "PROPULSION_LEAK"
    # Target pressure at full severity
    TARGET_FUEL_PRESSURE = 1.3  # MPa
    # Pressure before failure begins
    START_FUEL_PRESSURE = 2.5   # MPa

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        p = state.propulsion
        if state.recovery.isolation_valve_closed:
            stable = state.recovery.isolated_fuel_pressure
            if stable is None:
                stable = p.fuel_pressure
            stable = min(2.10, stable + 0.02 * dt)
            state.recovery.isolated_fuel_pressure = stable
            p.fuel_pressure = bounded_noise(stable, pct=0.003)
            p.fuel_flow = bounded_noise(0.50, pct=0.01)
            p.thrust = bounded_noise(min(82.0, state.recovery.thrust_ceiling), pct=0.005)
            p.engine_temperature += (78.0 - p.engine_temperature) * min(1.0, 0.08 * dt)
            return
        prog = self.progress

        # --- Primary: fuel pressure drops linearly toward target ---
        clean_pressure = self.START_FUEL_PRESSURE + (self.TARGET_FUEL_PRESSURE - self.START_FUEL_PRESSURE) * prog
        p.fuel_pressure = bounded_noise(clean_pressure, pct=0.01)

        # --- Correlation 1: fuel flow increases (leak + inefficient combustion) ---
        # nominal fuel_flow is 0.50 kg/s; leak adds up to +0.5 kg/s
        leak_flow = bounded_noise(0.50 + 0.50 * prog, pct=0.03)
        p.fuel_flow = leak_flow
        p.fuel_level = max(0.0, p.fuel_level - LEAK_FUEL_LOSS_RATE * prog * dt)

        # --- Correlation 2: thrust drops as pressure falls ---
        # thrust is in percent; nominal is 98. Pressure ratio drives thrust
        if p.fuel_pressure > 0:
            thrust_ratio = p.fuel_pressure / self.START_FUEL_PRESSURE
            base_thrust = 98.0 * thrust_ratio
            p.thrust = bounded_noise(base_thrust, pct=0.01)
        else:
            p.thrust = bounded_noise(20.0, pct=0.01)

        # --- Correlation 3: engine temperature rises (rich/unstable mixture) ---
        # Normal target is 78°C at nominal thrust; leak causes instability
        temp_drift = 15.0 * prog  # up to +15°C
        p.engine_temperature = bounded_noise(p.engine_temperature + temp_drift * 0.1 * dt, pct=0.005)


# ---------------------------------------------------------------------------
# Cooling failure — temperature rises, power demand increases
# ---------------------------------------------------------------------------

class CoolingFailureScenario(Scenario):
    """COOLING_FAILURE — radiator efficiency degrades, temperatures rise.

    Correlated effects:
        - engine_temperature ↑ (coolant loop failing)
        - cpu_temperature ↑ (radiator less effective)
        - power_consumption ↑ (cooling pumps work harder)
        - thrust may ↓ (thermal throttling)
    """
    name = "COOLING_FAILURE"
    # Severity multiplier: radiator_efficiency drops toward this at full progress
    TARGET_RADIATOR_EFFICIENCY = 0.20  # normal is 0.95
    TEMP_RISE = 25.0  # °C above nominal at full severity

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress

        # --- Primary: radiator efficiency degrades ---
        th = state.thermal
        th.radiator_efficiency = 0.95 - (0.95 - self.TARGET_RADIATOR_EFFICIENCY) * prog

        # --- Correlation 1: engine temperature rises ---
        # The base physics already drives engine temp toward a thrust-dependent
        # target, but with degraded cooling it runs hotter. We apply a direct
        # heat addition proportional to progress and radiator degradation.
        heat_add = (self.TEMP_RISE * prog) * 0.1 * dt
        # Engine temperature belongs to the propulsion subsystem.  Thermal
        # state contributes the radiator efficiency and CPU temperatures.
        state.propulsion.engine_temperature = bounded_noise(
            state.propulsion.engine_temperature + heat_add, pct=0.005
        )

        # --- Correlation 2: CPU temperature rises ---
        cpu_heat = 15.0 * prog * 0.1 * dt
        th.cpu_temperature = bounded_noise(th.cpu_temperature + cpu_heat, pct=0.01)

        # --- Correlation 3: power consumption increases (cooling pumps) ---
        state.power.power_consumption += 0.8 * prog * 0.05 * dt
        state.power.current_draw = bounded_noise(state.power.power_consumption, pct=0.01)


# ---------------------------------------------------------------------------
# Battery degradation — capacity fades, charging degrades
# ---------------------------------------------------------------------------

class BatteryDegradationScenario(Scenario):
    """BATTERY_DEGRADATION — capacity fades, voltage sags.

    Correlated effects:
        - battery_level drains faster even with nominal solar
        - battery_voltage sags under load
        - solar_generation appears reduced (panel degradation coupling)
    """
    name = "BATTERY_DEGRADATION"
    TARGET_CAPACITY_FACTOR = 0.5  # at full severity, effective capacity is 50%
    SOLAR_DEGRADATION = 0.5       # solar panels degrade by up to 50%

    def __init__(self):
        super().__init__()
        self._nominal_solar_generation = None

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress
        pw = state.power
        if self._nominal_solar_generation is None:
            self._nominal_solar_generation = pw.solar_generation

        # --- Primary: capacity degradation makes battery drain faster ---
        # Effective capacity factor reduces how much the battery can hold
        capacity_factor = 1.0 - (1.0 - self.TARGET_CAPACITY_FACTOR) * prog
        # Battery level is expressed as a percentage, but with reduced capacity
        # the same charge produces a lower *effective* percentage and drains faster
        if pw.battery_level > 0:
            # Drain accelerates: extra consumption factor based on degradation
            extra_drain = (1.0 - capacity_factor) * 0.3 * dt
            pw.battery_level = max(0.0, pw.battery_level - extra_drain)

        # --- Correlation: solar generation degrades ---
        pw.solar_generation = self._nominal_solar_generation * (
            1.0 - self.SOLAR_DEGRADATION * prog
        )

        # --- Correlation: voltage sags ---
        voltage_clean = 24.0 + (pw.battery_level / 100.0) * 5.0
        voltage_clean *= (1.0 - 0.2 * prog)  # up to 20% sag
        pw.battery_voltage = bounded_noise(voltage_clean, pct=0.005)


# ---------------------------------------------------------------------------
# Communication failure — signal degrades, packet loss rises
# ---------------------------------------------------------------------------

class CommunicationFailureScenario(Scenario):
    """COMMUNICATION_FAILURE — antenna/amplifier degradation.

    Correlated effects:
        - signal_strength ↓ (weaker signal)
        - packet_loss ↑
        - latency ↑
        - bandwidth ↓
    """
    name = "COMMUNICATION_FAILURE"
    SIGNAL_BASE = -50.0       # normal (dBm)
    TARGET_SIGNAL = -85.0     # degraded at full severity
    TARGET_PACKET_LOSS = 25.0  # percent
    TARGET_LATENCY = 800.0    # ms
    TARGET_BANDWIDTH = 2.0    # Mbps (down from 10)

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress
        c = state.communications

        # --- Primary: signal strength drops ---
        clean_signal = self.SIGNAL_BASE + (self.TARGET_SIGNAL - self.SIGNAL_BASE) * prog
        c.signal_strength = bounded_noise(clean_signal, pct=0.03)

        # --- Correlation 1: packet loss increases ---
        clean_loss = 0.1 + (self.TARGET_PACKET_LOSS - 0.1) * prog
        c.packet_loss = bounded_noise(clean_loss, pct=0.15)

        # --- Correlation 2: latency increases ---
        clean_latency = self.SIGNAL_BASE * 0 + 40.0 + (self.TARGET_LATENCY - 40.0) * prog
        c.latency = bounded_noise(clean_latency, pct=0.08)

        # --- Correlation 3: bandwidth drops ---
        clean_bandwidth = 10.0 + (self.TARGET_BANDWIDTH - 10.0) * prog
        c.bandwidth = bounded_noise(clean_bandwidth, pct=0.05)


# ---------------------------------------------------------------------------
# Sensor failure — telemetry bias/offset
# ---------------------------------------------------------------------------

class SensorFailureScenario(Scenario):
    """SENSOR_FAILURE — sensor calibration drift.

    This affects REPORTED values, introducing bias that looks plausible
    to downstream anomaly detection but is actually sensor error.

    Correlated effects:
        - fuel_pressure reading offset (bias toward normal-looking values)
        - temperature sensor drift
        - battery level inaccuracy
    """
    name = "SENSOR_FAILURE"

    def __init__(self):
        super().__init__()
        # Persistent biases set at the start and slowly drift
        self.bias = {
            "fuel_pressure": 0.0,
            "engine_temperature": 0.0,
            "battery_level": 0.0,
        }

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress

        # Biases accumulate gradually
        pressure_bias = 0.3 * prog  # +0.3 MPa at full severity
        temp_bias = -5.0 * prog     # -5°C at full severity (reads cold, hides overheating!)
        battery_bias = -8.0 * prog  # -8% at full severity

        # Apply bias to the *reported* values (we model bias in state since
        # telemetry is direct from state in Phase 2 — Phase 3 will separate raw
        # vs reported)
        self.bias = {
            "fuel_pressure": pressure_bias,
            "engine_temperature": temp_bias,
            "battery_level": battery_bias,
        }

    def transform_telemetry(self, frame: Dict[str, Any]) -> Dict[str, Any]:
        reported = super().transform_telemetry(frame)
        for metric, offset in self.bias.items():
            value = reported.get(metric)
            if isinstance(value, (int, float)):
                reported[metric] = round(value + offset, 4)
        return reported


# ---------------------------------------------------------------------------
# Flight computer failure — CPU/memory issues
# ---------------------------------------------------------------------------

class FlightComputerFailureScenario(Scenario):
    """FLIGHT_COMPUTER_FAILURE — CPU issues develop over time.

    Correlated effects:
        - cpu_usage ↑ (memory leak causing high load)
        - memory_usage ↑
        - process_health ↓ (processes failing)
        - storage_used ↑ faster
    """
    name = "FLIGHT_COMPUTER_FAILURE"
    TARGET_CPU_USAGE = 95.0
    TARGET_MEMORY = 90.0
    TARGET_HEALTH = 30.0
    TARGET_STORAGE = 80.0

    def __init__(self):
        super().__init__()
        self._initial_cpu_usage = None
        self._initial_memory_usage = None
        self._initial_process_health = None
        self._initial_storage_used = None

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress
        fc = state.flight_computer
        if self._initial_cpu_usage is None:
            self._initial_cpu_usage = fc.cpu_usage
            self._initial_memory_usage = fc.memory_usage
            self._initial_process_health = fc.process_health
            self._initial_storage_used = fc.storage_used

        # --- Primary: CPU usage spikes ---
        target_cpu = self._initial_cpu_usage + (self.TARGET_CPU_USAGE - self._initial_cpu_usage) * prog
        fc.cpu_usage = bounded_noise(target_cpu, pct=0.03)

        # --- Correlation 1: memory usage climbs ---
        target_mem = self._initial_memory_usage + (self.TARGET_MEMORY - self._initial_memory_usage) * prog
        fc.memory_usage = bounded_noise(target_mem, pct=0.03)

        # --- Correlation 2: process health degrades ---
        fc.process_health = max(
            0.0,
            self._initial_process_health + (self.TARGET_HEALTH - self._initial_process_health) * prog,
        )

        # --- Correlation 3: storage fills faster ---
        fc.storage_used = min(
            100.0,
            self._initial_storage_used + (self.TARGET_STORAGE - self._initial_storage_used) * prog,
        )


# ---------------------------------------------------------------------------
# Cascading failure — multiple subsystems failing in sequence
# ---------------------------------------------------------------------------

class CascadingFailureScenario(Scenario):
    """CASCADING_FAILURE — cooling failure → thermal stress → power → FC.

    A composite scenario where one failure triggers others.
    Timeline (spec for primary demo):
        - T+0–20s: thermal degradation begins
        - T+20–40s: power subsystem stressed by thermal demand
        - T+40–60s: flight computer degrades from thermal stress
    """
    name = "CASCADING_FAILURE"

    def __init__(self):
        super().__init__()
        # Sub-scenarios for each phase of the cascade
        self._cooling = CoolingFailureScenario()
        self._power_stress = BatteryDegradationScenario()
        self._fc_stress = FlightComputerFailureScenario()

    def update(self, state, dt: float) -> None:
        super().update(state, dt)
        prog = self.progress

        # Map each 20-second cascade stage onto its child's 60-second ramp
        # before that child advances. This preserves continuous stage-local
        # severity instead of jumping directly to full failure.
        self._cooling.elapsed_time = max(0.0, min(self.elapsed_time, 20.0) * 3.0 - dt)
        self._power_stress.elapsed_time = max(
            0.0, min(max(self.elapsed_time - 20.0, 0.0), 20.0) * 3.0 - dt
        )
        self._fc_stress.elapsed_time = max(
            0.0, min(max(self.elapsed_time - 40.0, 0.0), 20.0) * 3.0 - dt
        )

        # Stage 1 (0–33%): cooling failure ramps up
        if prog < 0.33:
            self._cooling.update(state, dt)

        # Stage 2 (33–66%): power subsystem begins degrading
        elif prog < 0.66:
            # Run cooling at full
            self._cooling.elapsed_time = self._cooling.ramp_duration
            self._cooling.update(state, dt)
            # Begin power degradation
            self._power_stress.update(state, dt)

        # Stage 3 (66–100%): flight computer degrades under thermal stress
        else:
            self._cooling.elapsed_time = self._cooling.ramp_duration
            self._cooling.update(state, dt)
            self._power_stress.elapsed_time = self._power_stress.ramp_duration
            self._power_stress.update(state, dt)
            self._fc_stress.update(state, dt)

        # Engine temperature rises throughout (heat soak)
        if prog > 0.2:
            extra_heat = 30.0 * (1.0 - 0.2) * prog * 0.1 * dt
            state.propulsion.engine_temperature += extra_heat


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

SCENARIOS: Dict[str, Type[Scenario]] = {
    "NORMAL": NormalScenario,
    "PROPULSION_LEAK": PropulsionLeakScenario,
    "COOLING_FAILURE": CoolingFailureScenario,
    "BATTERY_DEGRADATION": BatteryDegradationScenario,
    "COMMUNICATION_FAILURE": CommunicationFailureScenario,
    "SENSOR_FAILURE": SensorFailureScenario,
    "FLIGHT_COMPUTER_FAILURE": FlightComputerFailureScenario,
    "CASCADING_FAILURE": CascadingFailureScenario,
}


def get_scenario_class(name: str) -> Type[Scenario]:
    """Look up a scenario class by name. Raises ValueError if unknown."""
    name = name.upper()
    if name not in SCENARIOS:
        raise ValueError(
            f"Unknown scenario '{name}'. Available: {', '.join(sorted(SCENARIOS))}"
        )
    return SCENARIOS[name]


def create_scenario(name: str) -> Scenario:
    """Instantiate a scenario by name."""
    return get_scenario_class(name)()
