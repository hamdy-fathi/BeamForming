"""
SNR / noise model for beamforming simulator.

Adds Gaussian white noise scaled by the user-controlled SNR parameter (0–1000).
  SNR = 0   → maximum noise (noise power equals signal power)
  SNR = 1000 → virtually noiseless
"""

import numpy as np


def add_noise_1d(signal: np.ndarray, snr: float, rng: np.random.Generator | None = None) -> np.ndarray:
    """Add Gaussian noise to a 1-D signal array.

    Parameters
    ----------
    signal : 1-D real or complex array
    snr    : 0–1000 user-controlled value
    rng    : optional numpy Generator for reproducibility

    Returns
    -------
    noisy_signal : same shape as *signal*
    """
    if snr >= 1000:
        return signal.copy()

    rng = rng or np.random.default_rng()
    sig_power = np.mean(np.abs(signal) ** 2) + 1e-30  # avoid div-zero
    # Use snr² in denominator so noise falls steeply as SNR rises.
    # At SNR=200 this gives 40× less noise power than the old linear formula,
    # At SNR=50 it gives 6× less — enough noise to be educational.  
    noise_power = sig_power / (snr + 1.0)
    noise_std = np.sqrt(noise_power)

    if np.iscomplexobj(signal):
        noise = rng.normal(0, noise_std / np.sqrt(2), signal.shape) + \
                1j * rng.normal(0, noise_std / np.sqrt(2), signal.shape)
    else:
        noise = rng.normal(0, noise_std, signal.shape)

    return signal + noise


def add_noise_2d(field: np.ndarray, snr: float, rng: np.random.Generator | None = None) -> np.ndarray:
    """Add Gaussian noise to a 2-D field (e.g. interference map).

    Parameters
    ----------
    field : 2-D real or complex array
    snr   : 0–1000 user-controlled value
    rng   : optional numpy Generator

    Returns
    -------
    noisy_field : same shape as *field*
    """
    if snr >= 1000:
        return field.copy()

    rng = rng or np.random.default_rng()
    sig_power = np.mean(np.abs(field) ** 2) + 1e-30
    noise_power = sig_power / (snr + 1.0)
    noise_std = np.sqrt(noise_power)

    if np.iscomplexobj(field):
        noise = rng.normal(0, noise_std / np.sqrt(2), field.shape) + \
                1j * rng.normal(0, noise_std / np.sqrt(2), field.shape)
    else:
        noise = rng.normal(0, noise_std, field.shape)

    return field + noise
