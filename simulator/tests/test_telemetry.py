"""
End-to-end integration test for the simulator.

Verifies that the full pipeline works:
  state + clock + physics → telemetry frames → JSONL output
  pause/resume/reset/speed all work in the loop
"""
import io
import json
import os
import time
from contextlib import redirect_stdout

import pytest

import main as main_module
from src.simulator import Simulator
from main import parse_args


class RecordingTelemetryPublisher:
    def __init__(self):
        self.frames = []

    def publish(self, frame):
        self.frames.append(dict(frame))
        return True


@pytest.fixture(autouse=True)
def _seed():
    from src.noise import set_seed
    set_seed(2024)
    yield


def _make_sim(tmp_path, **kwargs) -> Simulator:
    out = tmp_path / "telemetry.jsonl"
    defaults = dict(
        spacecraft_id="ORBITAL-X1",
        output_path=str(out),
        speed=1,
        real_sleep=False,  # tests must not block on real time
    )
    defaults.update(kwargs)
    return Simulator(**defaults)


class TestRunBasics:
    def test_publishes_each_jsonl_frame_through_the_injected_publisher(self, tmp_path):
        """Catches Redis publication being detached from the emitted frame sequence."""
        publisher = RecordingTelemetryPublisher()
        sim = _make_sim(tmp_path, telemetry_publisher=publisher)

        sim.run(ticks=2)

        jsonl_frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        assert publisher.frames == jsonl_frames

    def test_jsonl_emission_continues_when_the_publisher_reports_delivery_failure(self, tmp_path):
        """Catches a Redis outage preventing the established JSONL simulator output."""
        class UnavailablePublisher:
            def publish(self, frame):
                return False

        sim = _make_sim(tmp_path, telemetry_publisher=UnavailablePublisher())

        sim.run(ticks=1)

        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        assert len(frames) == 2

    def test_runs_n_ticks(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=5)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        # 1 initial frame (t=0) + 5 post-tick frames
        assert len(frames) == 6

    def test_first_frame_has_baseline_values(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=1)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        f = frames[0]
        # Metadata
        assert f["spacecraft_id"] == "ORBITAL-X1"
        assert f["scenario"] == "NORMAL"
        # The very first frame is the initial state at sim_time=0
        assert f["simulation_time"] == 0.0
        assert "timestamp" in f
        # All six subsystems represented
        assert f["fuel_pressure"] > 0
        assert f["battery_level"] > 0
        assert f["cpu_temperature"] > 0
        assert f["signal_strength"] < 0  # dBm
        assert f["cpu_usage"] > 0
        assert f["position_x"] > 0  # km

    def test_simulation_time_advances_in_frames(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=10)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        times = [f["simulation_time"] for f in frames]
        assert times == sorted(times)
        assert times[-1] == pytest.approx(10.0, abs=0.5)

    def test_fuel_decreases_over_time(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=50)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        assert frames[-1]["fuel_level"] < frames[0]["fuel_level"]

    def test_propulsion_leak_is_applied_to_emitted_telemetry(self, tmp_path):
        sim = _make_sim(tmp_path, scenario="PROPULSION_LEAK")
        sim.run(ticks=60)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]

        assert frames[0]["scenario"] == "PROPULSION_LEAK"
        assert frames[-1]["fuel_pressure"] <= 1.35
        assert frames[-1]["fuel_flow"] > frames[0]["fuel_flow"]
        assert frames[-1]["thrust"] < frames[0]["thrust"]

    def test_sensor_failure_biases_telemetry_without_mutating_state(self, tmp_path):
        sim = _make_sim(tmp_path, scenario="SENSOR_FAILURE")
        sim.run(ticks=30)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]

        assert frames[-1]["fuel_pressure"] > sim.state.propulsion.fuel_pressure

    def test_current_telemetry_matches_sensor_failure_output(self, tmp_path):
        sim = _make_sim(tmp_path, scenario="SENSOR_FAILURE")
        sim.run(ticks=30)

        assert sim.current_telemetry()["fuel_pressure"] > sim.state.propulsion.fuel_pressure

    def test_reset_restarts_the_selected_scenario(self, tmp_path):
        sim = _make_sim(tmp_path, scenario="PROPULSION_LEAK")
        sim.run(ticks=30)
        sim.reset()
        sim.run(ticks=1)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]

        assert frames[0]["scenario"] == "PROPULSION_LEAK"
        assert frames[0]["fuel_pressure"] == pytest.approx(2.45)


class TestSpeed:
    def test_speed_10x_advances_10x(self, tmp_path):
        sim = _make_sim(tmp_path, speed=10)
        sim.run(ticks=10)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        assert frames[-1]["simulation_time"] == pytest.approx(100.0, abs=1.0)

    def test_speed_100x_advances_100x(self, tmp_path):
        sim = _make_sim(tmp_path, speed=100)
        sim.run(ticks=5)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        assert frames[-1]["simulation_time"] == pytest.approx(500.0, abs=1.0)

    def test_failure_progress_matches_simulated_time_at_10x(self, tmp_path):
        sim = _make_sim(tmp_path, speed=10, scenario="PROPULSION_LEAK")
        sim.run(ticks=6)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]

        assert frames[-1]["simulation_time"] == pytest.approx(60.0)
        assert frames[-1]["fuel_pressure"] <= 1.35


class TestCli:
    def test_accepts_a_supported_scenario(self):
        args = parse_args(["--scenario", "PROPULSION_LEAK", "--ticks", "60"])

        assert args.scenario == "PROPULSION_LEAK"
        assert args.ticks == 60

    def test_main_creates_an_environment_configured_telemetry_publisher(self, monkeypatch, tmp_path):
        """Catches the CLI bypassing the sole environment-configured publisher factory."""
        publisher = object()
        captured = {}

        class StubSimulator:
            def __init__(self, **kwargs):
                captured.update(kwargs)
                self.state = type("State", (), {"spacecraft_id": "ORBITAL-X1"})()

        monkeypatch.setattr(main_module, "create_telemetry_publisher_from_env", lambda: publisher)
        monkeypatch.setattr(main_module, "Simulator", StubSimulator)

        assert main_module.main(["--ticks", "0", "--output", str(tmp_path / "telemetry.jsonl")]) == 0
        assert captured["telemetry_publisher"] is publisher


class TestPauseResume:
    def test_real_time_run_sleeps_for_a_single_tick(self, tmp_path, monkeypatch):
        sleeps = []
        monkeypatch.setattr("src.simulator.time.sleep", sleeps.append)
        sim = Simulator(output_path=str(tmp_path / "telemetry.jsonl"), real_sleep=True)

        sim.run(ticks=1, real_dt=0.25)

        assert sleeps == [0.25]

    def test_pause_stops_emitting(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=3)  # 1 initial + 3 = 4
        sim.pause()
        sim.run(ticks=3)  # no new frames while paused
        sim.resume()
        sim.run(ticks=3)  # 3 more
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        # 1 + 3 + 0 + 3 = 7
        assert len(frames) == 7

    def test_reset_returns_to_zero(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=20)
        sim.reset()
        assert sim.state.simulation_time == 0.0
        sim.run(ticks=1)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        # After reset, the very first frame should be the new t=0 baseline
        first_after_reset = None
        for f in frames:
            if f["simulation_time"] == 0.0:
                first_after_reset = f
                break
        assert first_after_reset is not None
        # And then a post-tick frame at sim_time=1
        assert any(abs(f["simulation_time"] - 1.0) < 0.1 for f in frames)


class TestOutput:
    def test_output_is_valid_jsonl(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=5)
        with open(sim.output_path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                # Must parse as JSON
                json.loads(line)

    def test_writes_to_specified_path(self, tmp_path):
        out = tmp_path / "custom.jsonl"
        sim = Simulator(output_path=str(out), speed=1, real_sleep=False)
        sim.run(ticks=2)
        assert out.exists()
        with open(out) as fh:
            lines = [l for l in fh.read().splitlines() if l]
        # 1 initial + 2 = 3
        assert len(lines) == 3


class TestNoiseBounded:
    def test_fuel_pressure_stays_within_normal_band(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=100)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        for f in frames:
            # 2.0-2.8 MPa normal range, allow a small margin for the noise floor
            assert 1.8 <= f["fuel_pressure"] <= 2.9

    def test_battery_stays_in_range(self, tmp_path):
        sim = _make_sim(tmp_path)
        sim.run(ticks=100)
        frames = [json.loads(line) for line in open(sim.output_path) if line.strip()]
        for f in frames:
            assert 0 <= f["battery_level"] <= 100
