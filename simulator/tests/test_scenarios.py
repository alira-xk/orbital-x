"""
Tests for failure scenario engine (Phase 2).

Each scenario has:
- name: string identifier
- elapsed_time: float (seconds since scenario began)
- progress: property 0..1 based on elapsed_time / ramp_duration
- update(state, dt): modifies state in place for correlated effects

Scenarios are GRADUAL, not instant. A failure develops over ~60 simulated seconds.
"""
import pytest

from src.scenarios import (
    Scenario,
    NormalScenario,
    PropulsionLeakScenario,
    CoolingFailureScenario,
    BatteryDegradationScenario,
    CommunicationFailureScenario,
    SensorFailureScenario,
    FlightComputerFailureScenario,
    CascadingFailureScenario,
    SCENARIOS,
    create_scenario,
    get_scenario_class,
)
from src.physics import tick
from src.state import SpacecraftState


@pytest.fixture(autouse=True)
def _seed():
    """Make every test deterministic."""
    from src.noise import set_seed
    set_seed(5678)
    yield


def _fresh_state() -> SpacecraftState:
    return SpacecraftState()


class TestScenarioBase:
    """Tests for the Scenario base class."""

    def test_progress_zeros_until_elapsed(self):
        s = NormalScenario()
        assert s.progress == 0.0
        assert s.elapsed_time == 0.0

    def test_progress_increases_with_time(self):
        s = NormalScenario()
        s.update(_fresh_state(), 30.0)
        assert s.elapsed_time == 30.0
        assert s.progress == pytest.approx(0.5, rel=0.01)

    def test_progress_caps_at_one(self):
        s = NormalScenario()
        s.update(_fresh_state(), 100.0)
        assert s.progress == 1.0

    def test_registry_creates_every_supported_scenario(self):
        expected = {
            "NORMAL",
            "PROPULSION_LEAK",
            "COOLING_FAILURE",
            "BATTERY_DEGRADATION",
            "COMMUNICATION_FAILURE",
            "SENSOR_FAILURE",
            "FLIGHT_COMPUTER_FAILURE",
            "CASCADING_FAILURE",
        }

        assert set(SCENARIOS) == expected
        assert all(create_scenario(name).name == name for name in expected)
        assert get_scenario_class("NORMAL") is NormalScenario


class TestNormalScenario:
    """NORMAL — baseline, no additional effects."""

    def test_name_is_normal(self):
        s = NormalScenario()
        assert s.name == "NORMAL"

    def test_no_modification_to_state(self):
        state = _fresh_state()
        initial = state.to_telemetry()
        for _ in range(100):
            s = NormalScenario()
            s.update(state, dt=1.0)
        final = state.to_telemetry()
        # All values should be similar (within noise tolerance)
        for key in ["fuel_pressure", "engine_temperature", "battery_level", "signal_strength"]:
            assert final[key] == pytest.approx(initial[key], rel=0.1)


class TestPropulsionLeakScenario:
    """
    PROPULSION_LEAK — fuel pressure drops gradually 2.5→1.3 MPa over 60s.

    Correlated effects:
    - fuel pressure drops (primary indicator)
    - fuel consumption ↑ (leak causes higher flow)
    - thrust ↓ (reduced pressure means less efficient thrust)
    - fuel level drains faster
    - engine temperature may rise (unstable combustion)
    """

    def test_name_matches_enum(self):
        s = PropulsionLeakScenario()
        assert s.name == "PROPULSION_LEAK"

    def test_progress_reaches_one_at_ramp_duration(self):
        s = PropulsionLeakScenario()
        s.update(_fresh_state(), 60.0)
        assert s.progress == 1.0

    def test_fuel_pressure_drops_gradually(self):
        state = _fresh_state()
        scenario = PropulsionLeakScenario()

        # At 50% progress, pressure should match the documented leak signature.
        for _ in range(30):
            scenario.update(state, dt=1.0)

        assert 1.8 <= state.propulsion.fuel_pressure <= 2.1

        for _ in range(30):
            scenario.update(state, dt=1.0)

        assert 1.25 <= state.propulsion.fuel_pressure <= 1.35

    def test_fuel_consumption_increases_with_leak(self):
        state = _fresh_state()
        scenario = PropulsionLeakScenario()

        # Simulate a significant leak progression
        for _ in range(45):
            scenario.update(state, dt=1.0)

        # Fuel flow should be elevated due to leak
        assert state.propulsion.fuel_flow > 0.5  # nominal is 0.5 kg/s

    def test_fuel_level_drains_faster_than_the_normal_model(self):
        leaking = _fresh_state()
        normal = _fresh_state()
        scenario = PropulsionLeakScenario()

        for _ in range(60):
            tick(leaking, dt=1.0)
            scenario.update(leaking, dt=1.0)
            tick(normal, dt=1.0)

        assert leaking.propulsion.fuel_level < normal.propulsion.fuel_level

    def test_thrust_drops_gradually(self):
        state = _fresh_state()
        scenario = PropulsionLeakScenario()

        for _ in range(50):
            tick(state, dt=1.0)
            scenario.update(state, dt=1.0)

        # Thrust should be degraded by the leak
        assert state.propulsion.thrust < 100.0


class TestCoolingFailureScenario:
    """
    COOLING_FAILURE — radiator efficiency degrades, temperature rises.

    Correlated effects:
    - engine_temperature ↑
    - cpu_temperature ↑
    - power consumption ↑ (more cooling needed)
    - thrust may ↓ (thermal throttling)
    - process health ↓ (CPU under thermal stress)
    """

    def test_name_is_cooling_failure(self):
        s = CoolingFailureScenario()
        assert s.name == "COOLING_FAILURE"

    def test_engine_temp_rises_gradually(self):
        state = _fresh_state()
        initial_temp = state.propulsion.engine_temperature
        scenario = CoolingFailureScenario()

        for _ in range(45):
            tick(state, dt=1.0)
            scenario.update(state, dt=1.0)

        # Engine temp should rise above normal
        assert state.propulsion.engine_temperature > initial_temp

    def test_cpu_temp_rises(self):
        state = _fresh_state()
        scenario = CoolingFailureScenario()

        for _ in range(50):
            tick(state, dt=1.0)
            scenario.update(state, dt=1.0)

        assert state.thermal.cpu_temperature > 52.0  # default is 52


class TestBatteryDegradationScenario:
    """
    BATTERY_DEGRADATION — capacity fades, charging efficiency drops.

    Correlated effects:
    - battery_level ↓ faster even with same solar input
    - solar_generation appears reduced (degraded panels)
    - battery_voltage sags
    - power consumption ↑ due to voltage regulator inefficiency
    """

    def test_name_is_battery_degradation(self):
        s = BatteryDegradationScenario()
        assert s.name == "BATTERY_DEGRADATION"

    def test_battery_drains_faster(self):
        state = _fresh_state()
        normal = _fresh_state()
        scenario = BatteryDegradationScenario()

        for _ in range(30):
            tick(state, dt=1.0)
            scenario.update(state, dt=1.0)
            tick(normal, dt=1.0)

        # Capacity/panel degradation leaves less charge than an otherwise
        # identical nominal spacecraft.
        assert state.power.battery_level < normal.power.battery_level

    def test_solar_generation_reaches_the_declared_half_capacity_floor(self):
        state = _fresh_state()
        scenario = BatteryDegradationScenario()

        for _ in range(60):
            scenario.update(state, dt=1.0)

        assert state.power.solar_generation == pytest.approx(4.0, abs=0.1)


class TestCommunicationFailureScenario:
    """
    COMMUNICATION_FAILURE — antenna or amplifier degradation.

    Correlated effects:
    - signal_strength ↓ (weaker signal)
    - packet_loss ↑
    - latency ↑
    - bandwidth ↓
    """

    def test_name_is_communication_failure(self):
        s = CommunicationFailureScenario()
        assert s.name == "COMMUNICATION_FAILURE"

    def test_signal_strength_degrades(self):
        state = _fresh_state()
        initial_signal = state.communications.signal_strength
        scenario = CommunicationFailureScenario()

        for _ in range(30):
            scenario.update(state, dt=1.0)

        assert state.communications.signal_strength < initial_signal

    def test_packet_loss_increases(self):
        state = _fresh_state()
        scenario = CommunicationFailureScenario()

        for _ in range(30):
            scenario.update(state, dt=1.0)

        assert state.communications.packet_loss > 0.1


class TestSensorFailureScenario:
    """
    SENSOR_FAILURE — telemetry sensor bias/offset.

    This scenario affects what's REPORTED, not the actual state.
    For simplicity, we model it as the reported values being corrupted.

    Correlated effects:
    - fuel_pressure reading offset
    - temperature readings biased
    - battery level inaccurate
    """

    def test_name_is_sensor_failure(self):
        s = SensorFailureScenario()
        assert s.name == "SENSOR_FAILURE"

    def test_reported_fuel_pressure_has_bias(self):
        state = _fresh_state()
        scenario = SensorFailureScenario()

        for _ in range(20):
            scenario.update(state, dt=1.0)

        raw_pressure = state.propulsion.fuel_pressure
        reported = scenario.transform_telemetry(state.to_telemetry())

        # A sensor fault corrupts telemetry, never the physical state model.
        assert state.propulsion.fuel_pressure == raw_pressure
        assert reported["fuel_pressure"] > raw_pressure


class TestFlightComputerFailureScenario:
    """
    FLIGHT_COMPUTER_FAILURE — CPU issues developing.

    Correlated effects:
    - cpu_usage ↑ or oscillate erratically
    - memory_usage ↑ (memory leak)
    - process_health ↓
    - storage_used ↑ faster
    """

    def test_name_is_flight_computer_failure(self):
        s = FlightComputerFailureScenario()
        assert s.name == "FLIGHT_COMPUTER_FAILURE"

    def test_process_health_degrades(self):
        state = _fresh_state()
        scenario = FlightComputerFailureScenario()

        for _ in range(30):
            tick(state, dt=1.0)
            scenario.update(state, dt=1.0)

        assert state.flight_computer.process_health < 100.0

    def test_process_health_reaches_its_declared_full_severity_target(self):
        state = _fresh_state()
        scenario = FlightComputerFailureScenario()

        for _ in range(60):
            scenario.update(state, dt=1.0)

        assert state.flight_computer.process_health == pytest.approx(30.0, abs=1.0)


class TestCascadingFailureScenario:
    """
    CASCADING_FAILURE — multiple systems failing in sequence.

    This is a composite scenario that activates other failures.
    Primary trigger: cooling failure → affects power → affects flight computer.
    """

    def test_name_is_cascading_failure(self):
        s = CascadingFailureScenario()
        assert s.name == "CASCADING_FAILURE"

    def test_progress_affects_primary_system(self):
        state = _fresh_state()
        scenario = CascadingFailureScenario()

        # Run for most of the ramp duration
        for _ in range(45):
            scenario.update(state, dt=1.0)

        # Primary effect: thermal stress
        assert state.propulsion.engine_temperature > 78.0  # rising from nominal

    def test_cooling_stage_advances_once_per_simulated_second(self):
        state = _fresh_state()
        scenario = CascadingFailureScenario()

        for _ in range(10):
            scenario.update(state, dt=1.0)

        # The cascade's cooling stage lasts 20 seconds, so at T+10 it is
        # half-severe rather than double-advancing the child scenario.
        assert state.thermal.radiator_efficiency == pytest.approx(0.575, abs=0.01)

    def test_power_stage_starts_gradually_after_cooling_completes(self):
        state = _fresh_state()
        scenario = CascadingFailureScenario()

        for _ in range(21):
            scenario.update(state, dt=1.0)

        # One second into the power stage should not immediately apply the
        # full battery-voltage sag.
        assert state.power.battery_voltage > 27.0
