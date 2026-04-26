"""
Core 2-D beamforming engine.

Computes:
  • Array Factor  AF(θ)
  • 2-D constructive / destructive interference map
  • Beam profile (gain vs angle in dB)
"""

import numpy as np
from enum import Enum
from .apodization import WindowType, get_window
from .noise import add_noise_1d, add_noise_2d
from .physics import wavenumber


class SignalType(str, Enum):
    SINE = "sine"
    COSINE = "cosine"
    PULSE = "pulse"


# ─────────────────────────────────────────────────────────────────────────
class BeamformingSimulator:
    """Uniform Linear Array (ULA) beamforming simulator."""

    def __init__(
        self,
        num_elements: int = 16,
        element_spacing: float = 0.5,      # in wavelengths (d/λ)
        frequency: float = 1e9,            # Hz
        steering_angle: float = 0.0,       # degrees
        phase_offset: float = 0.0,         # radians
        signal_type: SignalType = SignalType.SINE,
        snr: float = 100.0,
        window_type: WindowType = WindowType.RECTANGULAR,
        medium_speed: float = 3e8,         # m/s (EM default)
    ):
        self.num_elements = num_elements
        self.element_spacing = element_spacing
        self.frequency = frequency
        self.steering_angle_deg = steering_angle
        self.phase_offset = phase_offset
        self.signal_type = signal_type
        self.snr = snr
        self.window_type = window_type
        self.medium_speed = medium_speed

        # derived
        self._update_derived()

    # ── internal ─────────────────────────────────────────────────────────
    def _update_derived(self):
        self.wavelength = self.medium_speed / self.frequency
        self.d = self.element_spacing * self.wavelength  # physical spacing [m]
        self.k = wavenumber(self.frequency, self.medium_speed)
        self.steering_angle_rad = np.deg2rad(self.steering_angle_deg)
        self.weights = get_window(self.window_type, self.num_elements)

    def update_params(self, **kwargs):
        """Bulk-update parameters and recompute derived values."""
        for key, val in kwargs.items():
            if key == "steering_angle":
                self.steering_angle_deg = val
            elif hasattr(self, key):
                setattr(self, key, val)
        self._update_derived()

    # ── Array Factor ─────────────────────────────────────────────────────
    def array_factor(self, theta_deg: np.ndarray) -> np.ndarray:
        """Compute normalised array factor AF(θ) for given angle array.

        Parameters
        ----------
        theta_deg : 1-D array of observation angles [degrees]

        Returns
        -------
        af : complex array – normalised array factor
        """
        theta = np.deg2rad(theta_deg)
        n = np.arange(self.num_elements)
        # progressive phase shift for steering
        psi = self.k * self.d * (
            np.sin(theta[:, None]) - np.sin(self.steering_angle_rad)
        ) + self.phase_offset  # (angles, elements)

        # weighted sum
        af = np.sum(self.weights[None, :] * np.exp(1j * n[None, :] * psi), axis=1)
        # normalise
        af /= (np.max(np.abs(af)) + 1e-30)
        return af

    def beam_profile(self, num_points: int = 361) -> dict:
        """Return beam profile: angles (deg) and gain (dB).

        Returns dict with keys 'angles' and 'magnitudes_db'.
        """
        angles = np.linspace(-90, 90, num_points)
        af = self.array_factor(angles)
        mag = np.abs(af)
        mag_db = 20.0 * np.log10(mag + 1e-30)

        # apply noise
        mag_db = add_noise_1d(mag_db, self.snr)

        return {
            "angles": angles.tolist(),
            "magnitudes_db": np.clip(mag_db, -60, 0).tolist(),
        }

    # ── 2-D Interference Map ────────────────────────────────────────────
    def interference_map(
        self,
        resolution: int = 200,
    ) -> dict:
        """Compute 2-D constructive/destructive interference map.

        Array is placed along x-axis at y=0.
        Returns the real part of the superposed field normalised to [-1, 1]
        so that positive values represent constructive interference and
        negative values represent destructive interference.
        """
        # Scale spatial range to ~30 wavelengths so fringes are visible
        half_x = max(self.wavelength * 15, self.d * self.num_elements * 2)
        y_max = max(self.wavelength * 15, half_x)

        x = np.linspace(-half_x, half_x, resolution)
        y = np.linspace(0.01 * self.wavelength, y_max, resolution)
        X, Y = np.meshgrid(x, y)

        # element positions along x-axis centred at origin
        elem_x = (np.arange(self.num_elements) - (self.num_elements - 1) / 2.0) * self.d

        # complex field at every point
        field = np.zeros_like(X, dtype=complex)
        for i, ex in enumerate(elem_x):
            dx = X - ex
            dy = Y
            r = np.sqrt(dx**2 + dy**2) + 1e-30
            # steering phase for each element
            steer_phase = self.k * ex * np.sin(self.steering_angle_rad)
            field += self.weights[i] * np.exp(1j * (self.k * r + steer_phase + self.phase_offset)) / np.sqrt(r)

        # Take the real part to show the oscillating wave pattern
        real_field = np.real(field)

        # Normalise to [-1, 1]
        peak = np.max(np.abs(real_field)) + 1e-30
        real_field /= peak

        # apply noise
        real_field = add_noise_2d(real_field, self.snr)
        real_field = np.clip(real_field, -1, 1)

        return {
            "map": real_field.tolist(),
            "x": x.tolist(),
            "y": y.tolist(),
            "x_range": [-half_x, half_x],
            "y_range": [0, y_max],
        }

    # ── Convenience: get all outputs ─────────────────────────────────────
    def compute_all(self, map_resolution: int = 150) -> dict:
        """Return beam profile + interference map in one call."""
        profile = self.beam_profile()
        imap = self.interference_map(resolution=map_resolution)
        window_weights = self.weights.tolist()

        return {
            "beam_profile": profile,
            "interference_map": imap,
            "window_weights": window_weights,
            "parameters": {
                "num_elements": self.num_elements,
                "element_spacing": self.element_spacing,
                "frequency": self.frequency,
                "steering_angle": self.steering_angle_deg,
                "phase_offset": self.phase_offset,
                "signal_type": self.signal_type.value,
                "snr": self.snr,
                "window_type": self.window_type.value,
                "wavelength": self.wavelength,
                "medium_speed": self.medium_speed,
            },
        }
