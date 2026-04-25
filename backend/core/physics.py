"""
Wave-propagation & acoustic physics helpers shared across all simulators.
"""

import numpy as np


# ── Constants ────────────────────────────────────────────────────────────
SPEED_OF_LIGHT = 3.0e8          # m/s  (electromagnetic)
SPEED_OF_SOUND_TISSUE = 1540.0  # m/s  (average soft tissue)
SPEED_OF_SOUND_WATER = 1480.0   # m/s  (coupling gel / water)


# ── Wave helpers ─────────────────────────────────────────────────────────

def wavelength(frequency: float, speed: float) -> float:
    """λ = c / f"""
    return speed / frequency


def wavenumber(frequency: float, speed: float) -> float:
    """k = 2π / λ = 2πf / c"""
    return 2.0 * np.pi * frequency / speed


# ── Reflection / Transmission ────────────────────────────────────────────

def reflection_coefficient(z1: float, z2: float) -> float:
    """Amplitude reflection coefficient at a planar interface.

    R = (Z₂ − Z₁) / (Z₂ + Z₁)
    """
    return (z2 - z1) / (z2 + z1 + 1e-30)


def transmission_coefficient(z1: float, z2: float) -> float:
    """Amplitude transmission coefficient at a planar interface.

    T = 2·Z₂ / (Z₂ + Z₁)
    """
    return 2.0 * z2 / (z2 + z1 + 1e-30)


def intensity_reflection(z1: float, z2: float) -> float:
    """Intensity (power) reflection coefficient  R_I = R²."""
    r = reflection_coefficient(z1, z2)
    return r * r


# ── Attenuation ──────────────────────────────────────────────────────────

def attenuation_factor(alpha_db_per_cm_mhz: float, frequency_hz: float, depth_m: float) -> float:
    """Return the *linear* attenuation factor (0–1) for a given depth.

    Parameters
    ----------
    alpha_db_per_cm_mhz : tissue attenuation coefficient  [dB / (cm · MHz)]
    frequency_hz        : operating frequency  [Hz]
    depth_m             : one-way propagation depth  [m]

    Returns
    -------
    factor : multiplicative amplitude factor (< 1)
    """
    freq_mhz = frequency_hz / 1e6
    depth_cm = depth_m * 100.0
    atten_db = alpha_db_per_cm_mhz * freq_mhz * depth_cm * 2.0  # round-trip
    return 10.0 ** (-atten_db / 20.0)


# ── Doppler ──────────────────────────────────────────────────────────────

def doppler_shift(f0: float, velocity: float, angle_rad: float,
                  c: float = SPEED_OF_SOUND_TISSUE) -> float:
    """Doppler frequency shift for moving reflector.

    Δf = 2 · f₀ · v · cos(θ) / c

    Parameters
    ----------
    f0        : transmitted frequency [Hz]
    velocity  : reflector velocity [m/s] (positive = towards transducer)
    angle_rad : angle between beam and flow direction [rad]
    c         : speed of sound in medium [m/s]

    Returns
    -------
    delta_f : Doppler shift [Hz]
    """
    return 2.0 * f0 * velocity * np.cos(angle_rad) / c


def velocity_from_doppler(delta_f: float, f0: float, angle_rad: float,
                          c: float = SPEED_OF_SOUND_TISSUE) -> float:
    """Estimate velocity from measured Doppler shift.

    v = Δf · c / (2 · f₀ · cos(θ))
    """
    cos_a = np.cos(angle_rad)
    if abs(cos_a) < 1e-10:
        return 0.0
    return delta_f * c / (2.0 * f0 * cos_a)


# ── Radar helpers ────────────────────────────────────────────────────────

def radar_received_power(pt: float, g: float, rcs: float,
                         wavelength_m: float, distance: float) -> float:
    """Simplified radar range equation (monostatic).

    Pr = (Pt · G² · λ² · σ) / ((4π)³ · R⁴)
    """
    if distance < 1e-6:
        return pt
    numerator = pt * g**2 * wavelength_m**2 * rcs
    denominator = (4.0 * np.pi)**3 * distance**4
    return numerator / (denominator + 1e-30)


def free_space_path_loss(distance: float, frequency: float) -> float:
    """Free-space path loss in dB for 5G / wireless.

    FSPL(dB) = 20·log₁₀(d) + 20·log₁₀(f) + 20·log₁₀(4π/c)
    """
    if distance < 1e-6:
        return 0.0
    return (
        20.0 * np.log10(distance)
        + 20.0 * np.log10(frequency)
        + 20.0 * np.log10(4.0 * np.pi / SPEED_OF_LIGHT)
    )
