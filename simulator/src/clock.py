"""
Simulation clock.

A small, pure class that tracks simulated time, supports pause/resume,
reset, and the spec's 1x / 10x / 100x / 1000x speed multipliers.
"""
from __future__ import annotations


ALLOWED_SPEEDS = {1, 10, 100, 1000}


class SimClock:
    """Track simulated time with pause/resume/reset and speed multiplier.

    `advance(real_dt)` adds `real_dt * speed` simulated seconds to the clock.
    While paused, `advance` is a no-op.
    `sleep_seconds(sim_dt)` returns the real-world seconds to wait so the
    caller emits one telemetry frame per simulated second.
    """

    def __init__(self, speed: int = 1):
        if speed not in ALLOWED_SPEEDS:
            raise ValueError(f"speed must be one of {sorted(ALLOWED_SPEEDS)}, got {speed}")
        self._sim_time: float = 0.0
        self._is_paused: bool = False
        self._speed: int = speed

    @property
    def sim_time(self) -> float:
        return self._sim_time

    @property
    def is_paused(self) -> bool:
        return self._is_paused

    @property
    def speed(self) -> int:
        return self._speed

    @speed.setter
    def speed(self, value: int) -> None:
        if value not in ALLOWED_SPEEDS:
            raise ValueError(f"speed must be one of {sorted(ALLOWED_SPEEDS)}, got {value}")
        self._speed = value

    def advance(self, real_dt: float) -> None:
        """Add `real_dt * speed` simulated seconds. No-op when paused."""
        if self._is_paused:
            return
        if real_dt <= 0:
            return
        self._sim_time += real_dt * self._speed

    def pause(self) -> None:
        self._is_paused = True

    def resume(self) -> None:
        self._is_paused = False

    def reset(self) -> None:
        """Reset sim time to 0. Does NOT change pause or speed."""
        self._sim_time = 0.0

    def sleep_seconds(self, sim_dt: float = 1.0) -> float:
        """How long to sleep in real seconds so 1 frame ≈ sim_dt simulated seconds."""
        if self._speed <= 0:
            return 0.0
        return sim_dt / self._speed
