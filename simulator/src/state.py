"""
ORBITAL-X1 Spacecraft State

Phase 1: NORMAL scenario only. Six subsystem dataclasses plus a top-level
SpacecraftState that aggregates them. The physics tick that mutates these
values lives in physics.py — this module is purely the state schema + a
JSON-safe serialization helper.
"""
from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict


@dataclass
class PropulsionState:
    """Propulsion subsystem — fuel, pressure, flow, thrust, engine temp."""
    fuel_level: float = 88.0           # percent
    fuel_pressure: float = 2.45        # MPa (within 2.0–2.8 normal range)
    fuel_flow: float = 0.50            # kg/s
    thrust: float = 98.0               # percent
    engine_temperature: float = 78.0   # Celsius


@dataclass
class PowerState:
    """Power subsystem — battery, solar, consumption."""
    battery_level: float = 92.0         # percent
    battery_voltage: float = 28.4       # V (24V/28V bus)
    current_draw: float = 5.2           # A
    solar_generation: float = 8.0       # A
    power_consumption: float = 5.5      # kW


@dataclass
class ThermalState:
    """Thermal subsystem — CPU/cabin/radiator temperatures + radiator efficiency."""
    cpu_temperature: float = 52.0       # Celsius
    cabin_temperature: float = 22.0     # Celsius
    radiator_temperature: float = -10.0 # Celsius (cold in space)
    radiator_efficiency: float = 0.95   # 0..1


@dataclass
class CommunicationsState:
    """Communications subsystem — signal, packet loss, latency, bandwidth."""
    signal_strength: float = -55.0   # dBm
    packet_loss: float = 0.10         # percent
    latency: float = 240.0            # ms
    bandwidth: float = 10.0           # Mbps


@dataclass
class FlightComputerState:
    """Flight computer — CPU/memory/storage/process health."""
    cpu_usage: float = 35.0         # percent
    memory_usage: float = 55.0      # percent
    storage_used: float = 42.0      # percent
    process_health: float = 100.0   # percent


@dataclass
class NavigationState:
    """Navigation — position, velocity, orientation."""
    position_x: float = 6778.0      # km (LEO altitude + Earth radius)
    position_y: float = 0.0
    position_z: float = 0.0
    velocity_x: float = 0.0         # km/s
    velocity_y: float = 7.8         # km/s (orbital velocity)
    velocity_z: float = 0.0
    orientation_roll: float = 0.0   # degrees
    orientation_pitch: float = 0.0
    orientation_yaw: float = 0.0

@dataclass
class RecoveryState:
    isolation_valve_closed: bool = False
    isolated_fuel_pressure: float | None = None
    thrust_ceiling: float = 100.0
    safe_mode: bool = False
    flight_computer_restart_ticks: int = 0


@dataclass
class SpacecraftState:
    """Top-level state — spacecraft ID, scenario, sim clock, all subsystems."""
    spacecraft_id: str = "ORBITAL-X1"
    scenario: str = "NORMAL"
    simulation_time: float = 0.0
    is_paused: bool = False
    speed: int = 1

    propulsion: PropulsionState = field(default_factory=PropulsionState)
    power: PowerState = field(default_factory=PowerState)
    thermal: ThermalState = field(default_factory=ThermalState)
    communications: CommunicationsState = field(default_factory=CommunicationsState)
    flight_computer: FlightComputerState = field(default_factory=FlightComputerState)
    navigation: NavigationState = field(default_factory=NavigationState)
    recovery: RecoveryState = field(default_factory=RecoveryState)

    def to_telemetry(self) -> Dict[str, Any]:
        """Serialize to a flat JSON-safe dict for downstream consumers."""
        # Use asdict for the subsystems so future fields are picked up automatically,
        # but flatten to top-level keys for transport simplicity.
        flat: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "spacecraft_id": self.spacecraft_id,
            "simulation_time": round(self.simulation_time, 2),
            "scenario": self.scenario,
        }
        for sub_name, sub in [
            ("propulsion", self.propulsion),
            ("power", self.power),
            ("thermal", self.thermal),
            ("communications", self.communications),
            ("flight_computer", self.flight_computer),
            ("navigation", self.navigation),
        ]:
            for k, v in asdict(sub).items():
                flat[k] = round(v, 4) if isinstance(v, float) else v
        return flat
