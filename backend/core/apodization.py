"""
Apodization / Windowing functions for side-lobe reduction.

Each function returns an array of N weights to be applied
to the element amplitudes of a phased array.
"""

import numpy as np
from enum import Enum


class WindowType(str, Enum):
    RECTANGULAR = "rectangular"
    HAMMING = "hamming"
    HANNING = "hanning"
    BLACKMAN = "blackman"
    KAISER = "kaiser"
    TUKEY = "tukey"


def rectangular(n: int) -> np.ndarray:
    """Uniform weights – no apodization. Highest side lobes (~-13 dB)."""
    return np.ones(n)


def hamming(n: int) -> np.ndarray:
    """Hamming window – good first-side-lobe suppression (~-43 dB)."""
    if n == 1:
        return np.ones(1)
    idx = np.arange(n)
    return 0.54 - 0.46 * np.cos(2.0 * np.pi * idx / (n - 1))


def hanning(n: int) -> np.ndarray:
    """Hanning (Hann) window – smooth roll-off, moderate side lobes (~-31 dB)."""
    if n == 1:
        return np.ones(1)
    idx = np.arange(n)
    return 0.5 * (1.0 - np.cos(2.0 * np.pi * idx / (n - 1)))


def blackman(n: int) -> np.ndarray:
    """Blackman window – very low side lobes (~-58 dB), widest main lobe."""
    if n == 1:
        return np.ones(1)
    idx = np.arange(n)
    return (
        0.42
        - 0.5 * np.cos(2.0 * np.pi * idx / (n - 1))
        + 0.08 * np.cos(4.0 * np.pi * idx / (n - 1))
    )


def kaiser(n: int, beta: float = 6.0) -> np.ndarray:
    """Kaiser window – parameterised trade-off via beta (0 = rect, 8.6 ≈ Blackman)."""
    return np.kaiser(n, beta)


def tukey(n: int, alpha: float = 0.5) -> np.ndarray:
    """Tukey (tapered cosine) window – alpha=0 is rect, alpha=1 is Hanning."""
    if n == 1:
        return np.ones(1)
    from scipy.signal.windows import tukey as _tukey
    return _tukey(n, alpha)


# ── Lookup ───────────────────────────────────────────────────────────────
WINDOW_FUNCTIONS = {
    WindowType.RECTANGULAR: rectangular,
    WindowType.HAMMING: hamming,
    WindowType.HANNING: hanning,
    WindowType.BLACKMAN: blackman,
    WindowType.KAISER: kaiser,
    WindowType.TUKEY: tukey,
}

WINDOW_DESCRIPTIONS = {
    WindowType.RECTANGULAR: {
        "name": "Rectangular",
        "description": "No tapering. Narrowest main lobe but highest side lobes (~-13 dB).",
        "side_lobe_level": -13,
    },
    WindowType.HAMMING: {
        "name": "Hamming",
        "description": "Minimises first side lobe. Good general-purpose window (~-43 dB).",
        "side_lobe_level": -43,
    },
    WindowType.HANNING: {
        "name": "Hanning",
        "description": "Smooth raised-cosine taper. Moderate suppression (~-31 dB).",
        "side_lobe_level": -31,
    },
    WindowType.BLACKMAN: {
        "name": "Blackman",
        "description": "Three-term cosine. Very low side lobes (~-58 dB) at the cost of wider main lobe.",
        "side_lobe_level": -58,
    },
    WindowType.KAISER: {
        "name": "Kaiser",
        "description": "Parameterised (β) trade-off between side-lobe level and main-lobe width.",
        "side_lobe_level": -60,
    },
    WindowType.TUKEY: {
        "name": "Tukey",
        "description": "Tapered cosine. α controls taper fraction (0=rect, 1=Hanning).",
        "side_lobe_level": -21,
    },
}


def get_window(window_type: WindowType, n: int, **kwargs) -> np.ndarray:
    """Return the window weights for the given type and element count."""
    fn = WINDOW_FUNCTIONS[window_type]
    if window_type == WindowType.KAISER:
        return fn(n, kwargs.get("beta", 6.0))
    elif window_type == WindowType.TUKEY:
        return fn(n, kwargs.get("alpha", 0.5))
    return fn(n)
