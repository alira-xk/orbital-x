"""
Tests for the simulation clock.

The clock is a small, pure class that:
- tracks simulated time (advances by real_dt * speed each call)
- supports pause/resume (no time accrues while paused)
- supports reset (time back to 0)
- supports speed multiplier (1, 10, 100, 1000)
"""
import time

import pytest

from src.clock import SimClock, ALLOWED_SPEEDS


class TestSimClockBasics:
    def test_starts_at_zero(self):
        c = SimClock()
        assert c.sim_time == 0.0
        assert not c.is_paused
        assert c.speed == 1

    def test_allowed_speed_set(self):
        # Spec section 8: 1x, 10x, 100x, 1000x
        assert ALLOWED_SPEEDS == {1, 10, 100, 1000}

    def test_invalid_speed_rejected(self):
        with pytest.raises(ValueError):
            SimClock(speed=2)
        with pytest.raises(ValueError):
            SimClock(speed=0)


class TestAdvance:
    def test_advance_by_real_dt(self):
        c = SimClock()
        c.advance(2.0)
        assert c.sim_time == pytest.approx(2.0)

    def test_advance_accumulates(self):
        c = SimClock()
        for _ in range(5):
            c.advance(1.0)
        assert c.sim_time == pytest.approx(5.0)

    def test_advance_negative_dt_ignored(self):
        c = SimClock()
        c.advance(-1.0)
        assert c.sim_time == 0.0


class TestSpeed:
    def test_speed_1x(self):
        c = SimClock(speed=1)
        c.advance(10.0)
        assert c.sim_time == pytest.approx(10.0)

    def test_speed_10x(self):
        c = SimClock(speed=10)
        c.advance(1.0)
        assert c.sim_time == pytest.approx(10.0)

    def test_speed_100x(self):
        c = SimClock(speed=100)
        c.advance(0.5)
        assert c.sim_time == pytest.approx(50.0)

    def test_speed_1000x(self):
        c = SimClock(speed=1000)
        c.advance(0.1)
        assert c.sim_time == pytest.approx(100.0)

    def test_change_speed_mid_run(self):
        c = SimClock(speed=1)
        c.advance(2.0)  # +2s
        c.speed = 10
        c.advance(1.0)  # +10s
        assert c.sim_time == pytest.approx(12.0)

    def test_set_invalid_speed_raises(self):
        c = SimClock()
        with pytest.raises(ValueError):
            c.speed = 7


class TestPause:
    def test_pause_stops_time(self):
        c = SimClock()
        c.pause()
        c.advance(5.0)
        assert c.sim_time == 0.0

    def test_resume_continues(self):
        c = SimClock()
        c.advance(2.0)
        c.pause()
        c.advance(5.0)  # ignored
        assert c.sim_time == pytest.approx(2.0)
        c.resume()
        c.advance(3.0)
        assert c.sim_time == pytest.approx(5.0)

    def test_pause_is_idempotent(self):
        c = SimClock()
        c.pause()
        c.pause()
        assert c.is_paused is True

    def test_resume_when_not_paused_is_noop(self):
        c = SimClock()
        c.resume()  # already not paused
        assert not c.is_paused


class TestReset:
    def test_reset_zeroes_time(self):
        c = SimClock()
        c.advance(42.0)
        c.reset()
        assert c.sim_time == 0.0

    def test_reset_preserves_pause_state(self):
        c = SimClock()
        c.pause()
        c.reset()
        # Per spec: reset is independent of pause; user controls pause explicitly
        assert c.is_paused is True

    def test_reset_preserves_speed(self):
        c = SimClock(speed=100)
        c.reset()
        assert c.speed == 100

    def test_after_reset_advance_works(self):
        c = SimClock()
        c.advance(5.0)
        c.reset()
        c.advance(3.0)
        assert c.sim_time == pytest.approx(3.0)


class TestSleepHint:
    def test_sleep_seconds_returns_real_dt_per_speed(self):
        # At 1x, sleep_seconds(1.0) should be ~1.0s
        # At 10x, sleep_seconds(1.0) should be ~0.1s
        c = SimClock(speed=10)
        assert c.sleep_seconds(1.0) == pytest.approx(0.1)
        c2 = SimClock(speed=1000)
        assert c2.sleep_seconds(1.0) == pytest.approx(0.001)
