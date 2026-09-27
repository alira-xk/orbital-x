"""
ORBITAL-X1 Simulator orchestrator.

Glues together `SimClock` (time) + `SpacecraftState` (the model) +
`tick` (the physics). Runs the loop and emits a JSONL file of telemetry
frames. Supports pause/resume/reset and 1x/10x/100x/1000x speed.
Also publishes telemetry to Redis Streams for the Phase 3 pipeline.
"""
from __future__ import annotations

import json
import time
from typing import Optional, Protocol

from src.clock import SimClock
from src.physics import tick
from src.scenarios import create_scenario
from src.state import SpacecraftState


class TelemetryPublisher(Protocol):
    def publish(self, frame: dict) -> bool:
        """Publish a telemetry frame and report whether delivery succeeded."""


class Simulator:
    """Runs the spacecraft simulation loop.

    Parameters
    ----------
    spacecraft_id : str
        The ID stamped on every telemetry frame (default: "ORBITAL-X1").
    output_path : str
        File path to write JSONL telemetry frames.
    speed : int
        Simulation speed multiplier (1, 10, 100, or 1000).
    seed : Optional[int]
        If set, seed the noise RNG for deterministic runs.
    """

    def __init__(
        self,
        spacecraft_id: str = "ORBITAL-X1",
        output_path: str = "telemetry.jsonl",
        speed: int = 1,
        scenario: str = "NORMAL",
        seed: Optional[int] = None,
        real_sleep: bool = True,
        telemetry_publisher: Optional[TelemetryPublisher] = None,
        command_consumer=None,
    ):
        if seed is not None:
            from src.noise import set_seed
            set_seed(seed)

        self._scenario_name = scenario.upper()
        self._scenario = create_scenario(self._scenario_name)
        self.state = SpacecraftState(
            spacecraft_id=spacecraft_id,
            speed=speed,
            scenario=self._scenario.name,
        )
        self.clock = SimClock(speed=speed)
        self.output_path = output_path
        self._is_paused = False
        # real_sleep=False skips wall-clock waits (for fast tests)
        self._real_sleep = real_sleep
        self._telemetry_publisher = telemetry_publisher
        self._command_consumer = command_consumer

    # ----- public control surface -----

    def pause(self) -> None:
        self._is_paused = True
        self.clock.pause()
        self.state.is_paused = True

    def resume(self) -> None:
        self._is_paused = False
        self.clock.resume()
        self.state.is_paused = False

    def reset(self) -> None:
        self.state = SpacecraftState(
            spacecraft_id=self.state.spacecraft_id,
            speed=self.clock.speed,
            scenario=self._scenario_name,
        )
        self.clock = SimClock(speed=self.clock.speed)
        self._scenario = create_scenario(self._scenario_name)
        # Reset the output file
        open(self.output_path, "w").close()

    @property
    def is_paused(self) -> bool:
        return self._is_paused

    @property
    def scenario(self):
        return self._scenario

    # ----- main loop -----

    def run(self, ticks: int, real_dt: float = 1.0) -> None:
        """Run the simulation for `ticks` iterations.

        Each iteration advances the simulation by `real_dt` real-world
        seconds, with the clock's speed multiplier applied. Emits one
        JSONL frame per tick. The first frame in a fresh run reports
        the initial state at sim_time=0; subsequent frames are post-tick.
        """
        # If we're starting fresh (sim_time is exactly 0), truncate the
        # output and emit the t=0 baseline frame so the consumer always
        # sees the starting state.
        if self.clock.sim_time == 0.0:
            with open(self.output_path, "w") as fh:
                pass
            self._emit_and_publish_frame()

        for i in range(ticks):
            if self._command_consumer is not None:
                self._command_consumer.poll(self.state, self._scenario)
            if self._is_paused:
                # Don't advance time, don't emit
                if self._real_sleep:
                    time.sleep(real_dt)
                continue

            # 1) advance the clock by the real-world dt
            self.clock.advance(real_dt)
            # 2) advance physics and faults for every simulated second. Using
            # one-second substeps keeps the integrator stable at high speeds.
            remaining_sim_time = real_dt * self.clock.speed
            while remaining_sim_time > 0:
                step = min(1.0, remaining_sim_time)
                tick(self.state, step)
                self._scenario.update(self.state, step)
                self._apply_recovery_state()
                remaining_sim_time -= step
            # 4) mirror sim_time into the state for telemetry
            self.state.simulation_time = self.clock.sim_time
            # 5) emit and publish one shared frame
            self._emit_and_publish_frame()
            # 6) sleep so the loop matches real_dt wall clock
            if self._real_sleep:
                time.sleep(self.clock.sleep_seconds(real_dt))

    def _emit_and_publish_frame(self) -> None:
        frame = self.current_telemetry()
        with open(self.output_path, "a") as fh:
            fh.write(json.dumps(frame) + "\n")
            fh.flush()
        if self._telemetry_publisher is not None:
            self._telemetry_publisher.publish(frame)

    def current_telemetry(self) -> dict:
        """Return the current telemetry frame, including scenario sensor effects."""
        return self._scenario.transform_telemetry(self.state.to_telemetry())

    def _apply_recovery_state(self) -> None:
        recovery = self.state.recovery
        self.state.propulsion.thrust = min(self.state.propulsion.thrust, recovery.thrust_ceiling)
        if recovery.safe_mode:
            self.state.power.power_consumption = min(self.state.power.power_consumption, 3.5)
        if recovery.flight_computer_restart_ticks > 0:
            self.state.flight_computer.process_health = 20.0
            recovery.flight_computer_restart_ticks -= 1
        elif self.state.flight_computer.process_health < 95.0:
            self.state.flight_computer.process_health = min(100.0, self.state.flight_computer.process_health + 20.0)
