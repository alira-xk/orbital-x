"""
Tests for spacecraft state dataclasses.

Phase 1: NORMAL scenario only. The state must capture all 6 subsystems
with sensible defaults that match the physics rules in the spec.
"""
import json
import pytest
from dataclasses import asdict

from src.state import (
    SpacecraftState,
    PropulsionState,
    PowerState,
    ThermalState,
    CommunicationsState,
    FlightComputerState,
    NavigationState,
)


class TestPropulsionState:
    def test_has_required_fields(self):
        p = PropulsionState()
        assert hasattr(p, "fuel_level")
        assert hasattr(p, "fuel_pressure")
        assert hasattr(p, "fuel_flow")
        assert hasattr(p, "thrust")
        assert hasattr(p, "engine_temperature")

    def test_fuel_pressure_within_normal_range(self):
        # Normal fuel pressure: 2.0–2.8 MPa (spec section 10)
        for _ in range(20):
            p = PropulsionState()
            assert 2.0 <= p.fuel_pressure <= 2.8

    def test_thrust_is_percent(self):
        p = PropulsionState()
        assert 0 <= p.thrust <= 100

    def test_fuel_level_is_percent(self):
        p = PropulsionState()
        assert 0 <= p.fuel_level <= 100

    def test_engine_temperature_reasonable(self):
        # Operating range ~60-100°C
        p = PropulsionState()
        assert 50 <= p.engine_temperature <= 100


class TestPowerState:
    def test_has_required_fields(self):
        p = PowerState()
        for field in ["battery_level", "battery_voltage", "current_draw",
                      "solar_generation", "power_consumption"]:
            assert hasattr(p, field)

    def test_battery_level_is_percent(self):
        p = PowerState()
        assert 0 <= p.battery_level <= 100

    def test_battery_voltage_24v_system(self):
        # Spacecraft typically 24V or 28V bus
        p = PowerState()
        assert 20 <= p.battery_voltage <= 32


class TestThermalState:
    def test_has_required_fields(self):
        t = ThermalState()
        for field in ["cpu_temperature", "cabin_temperature",
                      "radiator_temperature", "radiator_efficiency"]:
            assert hasattr(t, field)

    def test_radiator_efficiency_is_percent(self):
        t = ThermalState()
        assert 0 <= t.radiator_efficiency <= 1.0


class TestCommunicationsState:
    def test_has_required_fields(self):
        c = CommunicationsState()
        for field in ["signal_strength", "packet_loss", "latency", "bandwidth"]:
            assert hasattr(c, field)

    def test_packet_loss_is_percent(self):
        c = CommunicationsState()
        assert 0 <= c.packet_loss <= 100


class TestFlightComputerState:
    def test_has_required_fields(self):
        f = FlightComputerState()
        for field in ["cpu_usage", "memory_usage", "storage_used", "process_health"]:
            assert hasattr(f, field)

    def test_all_percentages(self):
        f = FlightComputerState()
        assert 0 <= f.cpu_usage <= 100
        assert 0 <= f.memory_usage <= 100
        assert 0 <= f.storage_used <= 100
        assert 0 <= f.process_health <= 100


class TestNavigationState:
    def test_has_required_fields(self):
        n = NavigationState()
        for field in ["position_x", "position_y", "position_z",
                      "velocity_x", "velocity_y", "velocity_z",
                      "orientation_roll", "orientation_pitch", "orientation_yaw"]:
            assert hasattr(n, field)


class TestSpacecraftState:
    def test_has_all_six_subsystems(self):
        s = SpacecraftState()
        assert isinstance(s.propulsion, PropulsionState)
        assert isinstance(s.power, PowerState)
        assert isinstance(s.thermal, ThermalState)
        assert isinstance(s.communications, CommunicationsState)
        assert isinstance(s.flight_computer, FlightComputerState)
        assert isinstance(s.navigation, NavigationState)

    def test_default_spacecraft_id(self):
        s = SpacecraftState()
        assert s.spacecraft_id == "ORBITAL-X1"

    def test_simulation_time_starts_at_zero(self):
        s = SpacecraftState()
        assert s.simulation_time == 0.0

    def test_default_scenario_is_normal(self):
        s = SpacecraftState()
        assert s.scenario == "NORMAL"

    def test_default_not_paused(self):
        s = SpacecraftState()
        assert s.is_paused is False

    def test_to_telemetry_returns_dict(self):
        s = SpacecraftState()
        t = s.to_telemetry()
        assert isinstance(t, dict)

    def test_to_telemetry_includes_all_subsystem_metrics(self):
        s = SpacecraftState()
        t = s.to_telemetry()
        # Propulsion
        for k in ["fuel_level", "fuel_pressure", "fuel_flow", "thrust", "engine_temperature"]:
            assert k in t, f"missing {k}"
        # Power
        for k in ["battery_level", "battery_voltage", "current_draw",
                  "solar_generation", "power_consumption"]:
            assert k in t, f"missing {k}"
        # Thermal
        for k in ["cpu_temperature", "cabin_temperature", "radiator_temperature"]:
            assert k in t, f"missing {k}"
        # Comms
        for k in ["signal_strength", "packet_loss", "latency", "bandwidth"]:
            assert k in t, f"missing {k}"
        # Flight computer
        for k in ["cpu_usage", "memory_usage", "storage_used", "process_health"]:
            assert k in t, f"missing {k}"
        # Navigation
        for k in ["position_x", "position_y", "position_z",
                  "velocity_x", "velocity_y", "velocity_z"]:
            assert k in t, f"missing {k}"

    def test_to_telemetry_is_json_serializable(self):
        s = SpacecraftState()
        t = s.to_telemetry()
        # Must round-trip through JSON without TypeError
        serialized = json.dumps(t)
        deserialized = json.loads(serialized)
        assert deserialized == t

    def test_to_telemetry_includes_metadata(self):
        s = SpacecraftState()
        t = s.to_telemetry()
        for k in ["timestamp", "spacecraft_id", "simulation_time", "scenario"]:
            assert k in t, f"missing {k}"
