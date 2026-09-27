"""
Tests for the physics tick.

The spec is explicit:
- Telemetry should be RELATED, not independent random numbers
- fuel ↓ → fuel_flow changes → engine state → thrust changes
- battery + solar_generation − power_consumption = new battery state
- temperature = heat_generation − heat_dissipation
- comms depend on spacecraft state + simulated distance/environment

`tick(state, dt)` is a pure function that mutates state in-place and
returns it. The tests below pin down each correlation rule.
"""
import pytest

from src.physics import tick
from src.state import SpacecraftState


@pytest.fixture(autouse=True)
def _seed():
    """Make every test deterministic by seeding the noise RNG."""
    from src.noise import set_seed
    set_seed(1234)
    yield


def _fresh_state() -> SpacecraftState:
    return SpacecraftState()


class TestPropulsionCorrelations:
    def test_fuel_consumed_when_thrust_on(self):
        # thrust=98% by default → fuel should decrease over time
        s = _fresh_state()
        start_fuel = s.propulsion.fuel_level
        for _ in range(10):
            tick(s, dt=1.0)
        assert s.propulsion.fuel_level < start_fuel

    def test_fuel_consumption_scales_with_thrust(self):
        # Two spacecrafts — one at 100% thrust, one at 0% — diverging fuel
        hi = _fresh_state()
        hi.propulsion.thrust = 100.0
        lo = _fresh_state()
        lo.propulsion.thrust = 0.0
        for _ in range(20):
            tick(hi, dt=1.0)
            tick(lo, dt=1.0)
        assert hi.propulsion.fuel_level < lo.propulsion.fuel_level

    def test_fuel_pressure_drops_when_fuel_low(self):
        # fuel_pressure = 2.0 + (fuel_level / 100) * 0.8 (spec's hint)
        s = _fresh_state()
        s.propulsion.fuel_level = 5.0  # almost empty
        tick(s, dt=1.0)
        # With very low fuel, pressure should be near 2.0 (the spec floor)
        assert s.propulsion.fuel_pressure < 2.3

    def test_fuel_level_clamped_at_zero(self):
        s = _fresh_state()
        s.propulsion.fuel_level = 0.5
        for _ in range(100):
            tick(s, dt=1.0)
        assert s.propulsion.fuel_level >= 0.0


class TestPowerCorrelations:
    def test_battery_charges_when_solar_exceeds_consumption(self):
        # Set up: solar way above consumption → net positive → battery rises
        s = _fresh_state()
        s.power.solar_generation = 10.0
        s.power.current_draw = 4.0
        s.power.power_consumption = 4.0
        s.power.battery_level = 50.0
        for _ in range(10):
            tick(s, dt=1.0)
        assert s.power.battery_level > 50.0

    def test_battery_discharges_when_consumption_exceeds_solar(self):
        s = _fresh_state()
        s.power.solar_generation = 2.0
        s.power.current_draw = 8.0
        s.power.power_consumption = 8.0
        s.power.battery_level = 50.0
        for _ in range(10):
            tick(s, dt=1.0)
        assert s.power.battery_level < 50.0

    def test_battery_clamped_at_100(self):
        s = _fresh_state()
        s.power.solar_generation = 50.0
        s.power.current_draw = 0.1
        s.power.battery_level = 99.5
        for _ in range(100):
            tick(s, dt=1.0)
        assert s.power.battery_level <= 100.0

    def test_power_consumption_increases_with_hot_engine(self):
        # Engine >80°C → more power for cooling
        cold = _fresh_state()
        cold.propulsion.engine_temperature = 70.0
        hot = _fresh_state()
        hot.propulsion.engine_temperature = 95.0
        for _ in range(20):
            tick(cold, dt=1.0)
            tick(hot, dt=1.0)
        assert hot.power.power_consumption > cold.power.power_consumption


class TestThermalCorrelations:
    def test_cpu_temp_rises_when_power_high(self):
        # Force a persistently heavy power draw (e.g. payload operation)
        # and the CPU should warm up from heat generation.
        s = _fresh_state()
        before = s.thermal.cpu_temperature
        for _ in range(20):
            # Pin power_consumption high each tick to simulate a sustained load
            s.power.power_consumption = 9.0
            s.power.current_draw = 9.0
            tick(s, dt=1.0)
        assert s.thermal.cpu_temperature > before

    def test_cpu_temp_converges_to_target(self):
        # After many ticks, CPU temp should be in a stable range
        s = _fresh_state()
        for _ in range(200):
            tick(s, dt=1.0)
        assert 30 <= s.thermal.cpu_temperature <= 100


class TestFlightComputerCorrelations:
    def test_cpu_usage_increases_when_thermal_high(self):
        # Force CPU temp high each tick (simulates a stuck-hot CPU) → throttle
        s = _fresh_state()
        for _ in range(20):
            s.thermal.cpu_temperature = 95.0
            tick(s, dt=1.0)
        assert s.flight_computer.cpu_usage > 40.0

    def test_process_health_degrades_with_persistent_thermal_stress(self):
        s = _fresh_state()
        start = s.flight_computer.process_health
        for _ in range(50):
            s.thermal.cpu_temperature = 95.0
            tick(s, dt=1.0)
        assert s.flight_computer.process_health < start


class TestSimulationClock:
    def test_simulation_time_advances(self):
        s = _fresh_state()
        tick(s, dt=2.0)
        assert s.simulation_time == pytest.approx(2.0)

    def test_simulation_time_speed_is_metadata_only(self):
        # Speed is applied by the loop, not the physics tick.
        # The physics tick advances sim_time by exactly the dt passed in.
        s = _fresh_state()
        s.speed = 10
        tick(s, dt=1.0)
        assert s.simulation_time == pytest.approx(1.0)

    def test_paused_does_not_advance(self):
        s = _fresh_state()
        s.is_paused = True
        tick(s, dt=5.0)
        assert s.simulation_time == 0.0
        # Subsystems shouldn't move either
        before = s.propulsion.fuel_level
        tick(s, dt=5.0)
        assert s.propulsion.fuel_level == before

    def test_resume_continues(self):
        s = _fresh_state()
        s.is_paused = True
        tick(s, dt=1.0)
        s.is_paused = False
        tick(s, dt=1.0)
        assert s.simulation_time == pytest.approx(1.0)


class TestStability:
    def test_runs_500_ticks_without_crashing(self):
        s = _fresh_state()
        for _ in range(500):
            tick(s, dt=1.0)
        # All key values must remain finite
        for sub in [s.propulsion, s.power, s.thermal, s.communications,
                    s.flight_computer, s.navigation]:
            for v in sub.__dict__.values():
                assert isinstance(v, (int, float))
                # No NaN, no inf
                assert v == v  # NaN check
                assert abs(v) < 1e9

    def test_fuel_pressure_stays_in_normal_band(self):
        # Under NORMAL scenario, fuel pressure should not wander out of band
        s = _fresh_state()
        for _ in range(200):
            tick(s, dt=1.0)
        assert 1.5 <= s.propulsion.fuel_pressure <= 3.0
