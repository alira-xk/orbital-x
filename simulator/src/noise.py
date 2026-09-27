"""
Controlled noise helper.

The spec wants telemetry that doesn't look perfectly artificial, but never
wild outliers. `bounded_noise` returns `base * (1 + delta)` where delta is
drawn from a Gaussian with stddev = pct, then clipped to ±pct.
"""
from __future__ import annotations

import random
from typing import Optional


_RNG: Optional[random.Random] = None


def set_seed(seed: int) -> None:
    """Seed the noise RNG for reproducible test runs."""
    global _RNG
    _RNG = random.Random(seed)


def _rng() -> random.Random:
    """Lazily create a default RNG; replaced by set_seed() if called."""
    global _RNG
    if _RNG is None:
        _RNG = random.Random()
    return _RNG


def bounded_noise(base: float, pct: float) -> float:
    """
    Return `base` perturbed by Gaussian noise bounded to ±pct of `base`.

    - pct must be in (0, 1] — relative magnitude of the noise
    - result is in [base * (1 - pct), base * (1 + pct)]
    - mean over many samples ≈ base

    Examples
    --------
    >>> set_seed(0)
    >>> 99.0 <= bounded_noise(100.0, 0.01) <= 101.0
    True
    """
    if pct <= 0 or pct > 1.0:
        raise ValueError(f"pct must be in (0, 1], got {pct}")

    if base == 0.0:
        # No signal to scale; the noise floor is the float epsilon.
        return 0.0

    rng = _rng()
    # Gaussian with stddev chosen so the clip rarely binds for reasonable pct.
    # We then hard-clip to the ±pct envelope to guarantee the bound.
    delta = rng.gauss(0.0, pct / 2.0)
    delta = max(-pct, min(pct, delta))
    return base * (1.0 + delta)
