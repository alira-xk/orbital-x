"""
Tests for the noise helper.

The spec says: small controlled noise so telemetry does not look perfectly
artificial, but never wild outliers. This module gives the physics layer a
bounded Gaussian perturbation it can apply per metric.
"""
import random

import pytest

from src.noise import bounded_noise, set_seed


class TestBoundedNoise:
    def test_returns_within_pct(self):
        # 1000 samples at 1% — must never exceed the bound
        for _ in range(1000):
            v = bounded_noise(100.0, pct=0.01)
            assert 99.0 <= v <= 101.0

    def test_centered_on_base_value(self):
        # Mean of 1000 samples should be close to base
        samples = [bounded_noise(50.0, pct=0.05) for _ in range(1000)]
        mean = sum(samples) / len(samples)
        assert abs(mean - 50.0) < 0.5  # within 1% of base

    def test_different_pct_changes_spread(self):
        # A larger pct should produce a larger standard deviation
        small = [bounded_noise(100.0, pct=0.001) for _ in range(500)]
        large = [bounded_noise(100.0, pct=0.10) for _ in range(500)]
        s_small = (sum((x - 100.0) ** 2 for x in small) / len(small)) ** 0.5
        s_large = (sum((x - 100.0) ** 2 for x in large) / len(large)) ** 0.5
        assert s_large > s_small * 5

    def test_deterministic_with_seed(self):
        # Same seed → same sequence
        set_seed(42)
        a = [bounded_noise(10.0, pct=0.05) for _ in range(5)]
        set_seed(42)
        b = [bounded_noise(10.0, pct=0.05) for _ in range(5)]
        assert a == b

    def test_different_seeds_diverge(self):
        set_seed(1)
        a = [bounded_noise(10.0, pct=0.05) for _ in range(5)]
        set_seed(2)
        b = [bounded_noise(10.0, pct=0.05) for _ in range(5)]
        assert a != b

    def test_negative_values_supported(self):
        # Should work with negative base (e.g. signal_strength in dBm)
        v = bounded_noise(-50.0, pct=0.01)
        assert -50.5 <= v <= -49.5

    def test_zero_base(self):
        v = bounded_noise(0.0, pct=0.05)
        # bounded around zero — at most 5% of zero = zero, so result is tiny
        # but bounded by absolute 1e-9 to avoid floating-point deadlocks
        assert -1e-9 <= v <= 1e-9

    def test_invalid_pct_raises(self):
        with pytest.raises(ValueError):
            bounded_noise(10.0, pct=0)
        with pytest.raises(ValueError):
            bounded_noise(10.0, pct=-0.01)
        with pytest.raises(ValueError):
            bounded_noise(10.0, pct=1.5)
