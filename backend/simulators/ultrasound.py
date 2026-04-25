"""
Ultrasound simulator: A-mode, B-mode, Doppler.

Uses the Shepp–Logan phantom as the scanning target.
"""

import numpy as np
from .phantom import PhantomModel
from core.physics import (
    reflection_coefficient,
    attenuation_factor,
    doppler_shift,
    SPEED_OF_SOUND_TISSUE,
)
from core.noise import add_noise_1d
from core.beamforming import BeamformingSimulator
from core.apodization import WindowType


class UltrasoundSimulator:
    """Simulates A-mode, B-mode, and Doppler ultrasound on a Shepp–Logan phantom."""

    DEFAULT_FREQ = 5e6  # 5 MHz

    def __init__(self):
        self.phantom = PhantomModel()
        # Default blood vessel inside the phantom
        self.vessel = {
            "center_x": 0.0,
            "center_y": -0.3,
            "direction_angle": 45.0,   # degrees
            "diameter": 0.02,          # phantom units (~2 mm)
            "blood_velocity": 0.5,     # m/s
        }

    # ── A-Mode ──────────────────────────────────────────────────────────
    def a_mode(
        self,
        probe_x: float,
        probe_y: float,
        beam_angle: float,          # degrees, 0 = straight in
        frequency: float = 5e6,
        snr: float = 200.0,
        num_samples: int = 500,
        max_depth: float = 2.0,
    ) -> dict:
        """Compute A-mode scanline from probe position into phantom.

        Returns amplitudes vs depth (time).
        """
        # ray-cast into phantom
        intersections = self.phantom.ray_intersections(
            origin=(probe_x, probe_y),
            angle_deg=beam_angle,
            max_depth=max_depth,
            num_samples=num_samples,
        )

        # build A-mode signal: amplitude at each depth sample
        scale = self.phantom.SCALE
        depths_m = np.linspace(0, max_depth * scale, num_samples)
        signal = np.zeros(num_samples)

        for isect in intersections:
            d_m = isect["depth"]
            r = isect["reflection_coeff"]
            if r < 1e-6:
                continue

            # find nearest sample index
            idx = int(d_m / (max_depth * scale) * (num_samples - 1))
            idx = np.clip(idx, 0, num_samples - 1)

            # attenuation up to this depth (average tissue)
            atten = attenuation_factor(0.6, frequency, d_m)

            # reflected amplitude
            signal[idx] += r * atten

        # apply TGC (time-gain compensation): linear gain with depth
        tgc = 1.0 + 2.0 * np.linspace(0, 1, num_samples)
        signal *= tgc

        # normalise
        if np.max(np.abs(signal)) > 0:
            signal /= np.max(np.abs(signal))

        # add noise
        signal = add_noise_1d(signal, snr)

        return {
            "depths": depths_m.tolist(),
            "amplitudes": signal.tolist(),
            "intersections": intersections,
        }

    # ── B-Mode ──────────────────────────────────────────────────────────
    def b_mode(
        self,
        scanlines: list[dict],       # [{probe_x, probe_y, beam_angle}]
        frequency: float = 5e6,
        snr: float = 200.0,
        num_samples: int = 300,
        max_depth: float = 2.0,
    ) -> dict:
        """Assemble B-mode image from multiple A-mode scanlines."""
        image_data = []

        for sl in scanlines:
            result = self.a_mode(
                probe_x=sl["probe_x"],
                probe_y=sl["probe_y"],
                beam_angle=sl.get("beam_angle", 0.0),
                frequency=frequency,
                snr=snr,
                num_samples=num_samples,
                max_depth=max_depth,
            )
            # envelope detection: absolute value (simplified)
            env = np.abs(np.array(result["amplitudes"]))
            image_data.append(env.tolist())

        if not image_data:
            return {"image": [], "depths": [], "num_scanlines": 0}

        return {
            "image": image_data,
            "depths": np.linspace(0, max_depth * self.phantom.SCALE, num_samples).tolist(),
            "num_scanlines": len(scanlines),
        }

    # ── Doppler ─────────────────────────────────────────────────────────
    def doppler_mode(
        self,
        probe_x: float,
        probe_y: float,
        beam_angle: float,
        vessel: dict | None = None,
        frequency: float = 5e6,
        snr: float = 200.0,
    ) -> dict:
        """Compute Doppler output for a blood vessel.

        Returns Doppler shift, estimated velocity, and spectral data.
        """
        v = vessel or self.vessel

        # angle between beam direction and vessel direction
        beam_rad = np.deg2rad(beam_angle)
        vessel_rad = np.deg2rad(v["direction_angle"])
        insonation_angle = beam_rad - vessel_rad

        blood_vel = v["blood_velocity"]  # m/s
        c = SPEED_OF_SOUND_TISSUE

        delta_f = doppler_shift(frequency, blood_vel, insonation_angle, c)

        # generate a simulated Doppler spectrum (simplified)
        num_points = 256
        # spectral broadening proportional to vessel diameter
        broadening = v["diameter"] * 500  # Hz spread
        freq_axis = np.linspace(delta_f - broadening * 3, delta_f + broadening * 3, num_points)
        spectrum = np.exp(-0.5 * ((freq_axis - delta_f) / (broadening + 1e-10)) ** 2)
        spectrum /= (np.max(spectrum) + 1e-30)

        # add noise
        spectrum = add_noise_1d(spectrum, snr)
        spectrum = np.clip(spectrum, 0, None)

        # velocity axis
        vel_axis = freq_axis * c / (2 * frequency + 1e-30)

        # direction indicator
        flow_direction = "towards" if delta_f > 0 else "away" if delta_f < 0 else "perpendicular"

        return {
            "doppler_shift_hz": round(float(delta_f), 2),
            "estimated_velocity_ms": round(float(blood_vel * np.cos(insonation_angle)), 4),
            "flow_direction": flow_direction,
            "insonation_angle_deg": round(float(np.rad2deg(insonation_angle)), 2),
            "spectrum": {
                "frequencies": freq_axis.tolist(),
                "magnitudes": spectrum.tolist(),
                "velocities": vel_axis.tolist(),
            },
            "vessel": {
                "center_x": v["center_x"],
                "center_y": v["center_y"],
                "direction_angle": v["direction_angle"],
                "diameter": v["diameter"],
                "blood_velocity": v["blood_velocity"],
            },
        }
