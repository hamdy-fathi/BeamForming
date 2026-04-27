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
        # normalise by the theoretical maximum (which is the sum of the weights)
        af /= (np.sum(self.weights) + 1e-30)
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
        # ── Grid extent ──────────────────────────────────────────────────
        # Use a FIXED reference wavelength (at 1 GHz for the current medium)
        # so the grid does NOT rescale when frequency changes.  This makes
        # frequency changes visible as changes in fringe density.
        ref_wavelength = self.medium_speed / 1e9          # e.g. 0.3 m for EM
        ref_d = self.element_spacing * ref_wavelength
        ref_aperture = ref_d * self.num_elements
        # Current aperture (may differ if freq ≠ 1 GHz)
        cur_aperture = self.d * self.num_elements
        # Grid must be large enough for the reference aperture AND
        # at least 10 current wavelengths so fringes are always resolved.
        half_x = max(ref_aperture * 3,
                     cur_aperture * 3,
                     self.wavelength * 10)
        half_x = np.clip(half_x, 0.01, 200.0)
        y_max = half_x

        x = np.linspace(-half_x, half_x, resolution)
        y = np.linspace(half_x * 0.001, y_max, resolution)
        X, Y = np.meshgrid(x, y)

         # element positions along x-axis centred at origin
        elem_x = (np.arange(self.num_elements) - (self.num_elements - 1) / 2.0) * self.d

        # Excitation phase per element for steering:
        # The array factor (far-field/receiving) uses -n*k*d*sin(θ₀),
        # but for outgoing spherical waves exp(+jkr) the sign flips:
        # we need +n*k*d*sin(θ₀) to steer the radiated field to +θ₀.
        n_indices = np.arange(self.num_elements)
        excitation_phases = self.k * self.d * n_indices * np.sin(self.steering_angle_rad)

        # complex field at every point
        field = np.zeros_like(X, dtype=complex)
        for i, ex in enumerate(elem_x):
            dx = X - ex
            dy = Y
            r = np.sqrt(dx**2 + dy**2) + 1e-30
            # Progressive phase offset per element – negated for outgoing
            # wave convention (same sign flip as steering)
            elem_phase_offset = -i * self.phase_offset
            # Point source with applied excitation phase for steering
            field += self.weights[i] * np.exp(1j * (self.k * r + excitation_phases[i] + elem_phase_offset)) / np.sqrt(r)

        # Apply signal type modulation
        if self.signal_type == SignalType.COSINE:
            # cosine → 90° phase-shifted version of the wave
            modulated = -np.imag(field)
        elif self.signal_type == SignalType.PULSE:
            # pulse → use amplitude envelope (magnitude)
            modulated = np.abs(field)
        else:
            # sine (default) → real part of the field (standard convention)
            modulated = np.real(field)

        # Normalise to [-1, 1]
        peak = np.max(np.abs(modulated)) + 1e-30
        modulated /= peak

        # apply noise – use log-scaled SNR so mid-range slider values
        # produce visible noise (raw SNR 0-1000 → effective 0-60 dB)
        effective_snr = self.snr  # default pass-through
        if self.snr < 1000:
            # Map slider 0-1000 → effective SNR 0-1000 with more visible
            # noise at mid-range: use quadratic curve so SNR=500→125
            effective_snr = (self.snr / 1000.0) ** 2 * 1000.0
        modulated = add_noise_2d(modulated, effective_snr)
        modulated = np.clip(modulated, -1, 1)

        return {
            "map": modulated.tolist(),
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

        # Compute noise-free beamwidth
        angles = np.linspace(-90, 90, 361)
        af = self.array_factor(angles)
        mag_db_clean = 20.0 * np.log10(np.abs(af) + 1e-30)
        peak_idx = np.argmax(mag_db_clean)
        peak_db = mag_db_clean[peak_idx]
        
        left_idx = peak_idx
        while left_idx > 0 and mag_db_clean[left_idx - 1] >= peak_db - 3:
            left_idx -= 1
        right_idx = peak_idx
        while right_idx < len(mag_db_clean) - 1 and mag_db_clean[right_idx + 1] >= peak_db - 3:
            right_idx += 1
            
        beamwidth_deg = float(angles[right_idx] - angles[left_idx])

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
                "beamwidth_deg": max(1.0, beamwidth_deg),
            },
        }
