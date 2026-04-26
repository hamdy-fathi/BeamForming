"""
Ultrasound simulator: A-mode, B-mode, Doppler.

Uses the Shepp-Logan phantom as the scanning target.
Physics:
  - Gaussian-spread spikes at each tissue boundary (A-mode)
  - Acoustic shadowing via cumulative transmission loss
  - Auto-sweep scanline generation (B-mode)
  - Doppler shift via dot-product (correctly zero at 90 degrees to flow)
"""

import numpy as np
from .phantom import PhantomModel
from core.physics import SPEED_OF_SOUND_TISSUE
from core.noise import add_noise_1d


# Ultrasound machines assume this constant for depth display
C_ASSUMED = SPEED_OF_SOUND_TISSUE   # 1540 m/s


class UltrasoundSimulator:
    """Simulates A-mode, B-mode, and Doppler ultrasound on a Shepp-Logan phantom."""

    def __init__(self):
        self.phantom = PhantomModel()

    # ── Beam direction helper ─────────────────────────────────────────────
    @staticmethod
    def _beam_direction(probe_x: float, probe_y: float,
                        beam_angle_deg: float) -> tuple[float, float]:
        """Compute world-space beam unit vector from probe position + steering angle.

        Primary direction = inward normal at probe position (toward phantom centre).
        Steering angle rotates it in the probe's local frame:
          right  =  90 deg clockwise from inward normal.

        Examples (probe at bottom, y = -0.95):
          inward = (0, +1)  right = (+1, 0)
          angle=0    -> beam = (0,   1)     straight in
          angle=+30  -> beam = (0.5, 0.866) tilted right
          angle=-30  -> beam = (-0.5, 0.866) tilted left
        """
        # Inward direction: from probe toward (0,0)
        r = np.sqrt(probe_x**2 + probe_y**2) + 1e-12
        nx = -probe_x / r
        ny = -probe_y / r
        # Right vector in probe frame (90 deg clockwise from inward)
        rx =  ny
        ry = -nx
        # Apply steering
        a  = np.deg2rad(beam_angle_deg)
        dx = nx * np.cos(a) + rx * np.sin(a)
        dy = ny * np.cos(a) + ry * np.sin(a)
        return (float(dx), float(dy))

    # ═══════════════════════════════════════════════════════════════════════
    # A-Mode
    # ═══════════════════════════════════════════════════════════════════════
    def a_mode(
        self,
        probe_x:     float,
        probe_y:     float,
        beam_angle:  float,        # degrees; 0 = straight in, + = right
        frequency:   float = 5e6,
        snr:         float = 200.0,
        num_samples: int   = 512,
        max_depth:   float = 2.5,  # phantom units (~25 cm)
        normalize:   bool  = True, # False = return raw energy amplitudes (for B-mode)
        tgc_gain:    float = 3.0,  # TGC exponent; 3.0 for A-mode display, 1.5 for B-mode
    ) -> dict:
        """Compute A-mode scanline.

        Returns amplitudes vs apparent depth (time-of-flight display assuming
        constant c = 1540 m/s, as real ultrasound machines do).
        """
        direction = self._beam_direction(probe_x, probe_y, beam_angle)

        intersections = self.phantom.ray_intersections(
            origin=(probe_x, probe_y),
            direction=direction,
            max_depth=max_depth,
        )

        scale        = self.phantom.SCALE           # m per phantom-unit
        freq_mhz     = frequency / 1e6
        max_depth_m  = max_depth * scale            # real-world metres
        sample_spacing = max_depth_m / (num_samples - 1)

        # Gaussian spike half-width: ~2 cycles at operating frequency
        pulse_len_m = 2.0 * C_ASSUMED / frequency   # ~0.62 mm at 5 MHz
        spike_sigma = pulse_len_m / 2.355            # FWHM → sigma

        signal = np.zeros(num_samples)

        current_t  = 0.0  # one-way travel time [s]
        current_d  = 0.0  # phantom units traversed so far
        energy     = 1.0  # cumulative amplitude factor

        for isect in intersections:
            d_ph = isect["depth_phantom"]
            if d_ph <= current_d:
                continue

            # -- Propagation through the segment preceding this boundary --
            segment_m = (d_ph - current_d) * scale

            # Tissue in the middle of this segment
            mid_d = current_d + (d_ph - current_d) * 0.5
            mx = probe_x + direction[0] * mid_d
            my = probe_y + direction[1] * mid_d
            tissue = self.phantom.point_tissue(mx, my)

            true_c = tissue.speed       if tissue else self.phantom.BG_SPEED
            alpha  = tissue.attenuation if tissue else self.phantom.BG_ATTENUATION

            # One-way travel time through segment
            current_t += segment_m / true_c

            # Round-trip attenuation (Beer-Lambert, factor 2 for echo)
            atten_db = alpha * freq_mhz * (segment_m * 100.0) * 2.0
            energy  *= 10.0 ** (-atten_db / 20.0)

            current_d = d_ph

            # -- Reflection spike at this boundary --
            r_amp   = isect["reflection_coeff"]    # |amplitude reflection|
            r_power = isect["reflection_power"]     # R squared

            if r_power < 1e-12:
                energy *= np.sqrt(isect["transmission_factor"])
                continue

            # Apparent depth as the machine displays (assuming c_assumed)
            apparent_depth = current_t * C_ASSUMED
            centre_idx = apparent_depth / sample_spacing

            sigma_samples = spike_sigma / sample_spacing
            i_lo = max(0, int(centre_idx - 4 * sigma_samples))
            i_hi = min(num_samples - 1, int(centre_idx + 4 * sigma_samples + 1))
            if i_lo > i_hi:
                continue

            indices = np.arange(i_lo, i_hi + 1, dtype=float)
            gauss   = np.exp(-0.5 * ((indices - centre_idx) / (sigma_samples + 1e-10)) ** 2)
            signal[i_lo:i_hi+1] += r_amp * energy * gauss

            # Acoustic shadowing: reduce forward energy by transmission factor
            energy *= np.sqrt(isect["transmission_factor"])

        # -- Noise (added BEFORE TGC so TGC does not amplify noise floor) --
        signal = add_noise_1d(signal, snr)

        # -- Time-Gain Compensation (TGC) --
        # exp(tgc_gain): at max depth gain = e^gain
        # A-mode: gain=3.0 → ≈20x (26 dB) — compensates ~0.5 dB/cm/MHz at 5 MHz over 20 cm
        # B-mode: gain=1.5 → ≈4.5x (13 dB) — gentler so tissue reflectivity differences remain
        tgc = np.exp(tgc_gain * np.linspace(0, 1, num_samples))
        signal *= tgc

        if normalize:
            # Per-scanline normalisation (for A-mode display): peak = 1
            peak = np.max(np.abs(signal))
            if peak > 0:
                signal /= peak

        signal = np.clip(signal, -1.0, 1.0)

        depths_m = np.linspace(0, max_depth_m, num_samples)

        return {
            "depths":        depths_m.tolist(),
            "amplitudes":    signal.tolist(),
            "intersections": intersections,
            "num_samples":   num_samples,
        }

    # ═══════════════════════════════════════════════════════════════════════
    # B-Mode
    # ═══════════════════════════════════════════════════════════════════════
    def b_mode(
        self,
        probe_x:           float,
        probe_y:           float,
        sweep_start_angle: float = -40.0,
        sweep_end_angle:   float =  40.0,
        num_scanlines:     int   = 128,
        frequency:         float = 5e6,
        snr:               float = 200.0,
        num_samples:       int   = 400,
        max_depth:         float = 2.0,   # phantom units; 2.0 = 20 cm covers full phantom
    ) -> dict:
        """Assemble B-mode image by sweeping the beam angle from probe position.

        Returns a 2-D array [scanline][sample] of log-compressed amplitude
        values (0–1) for frontend canvas rendering.

        Global 2D normalization is applied so no single bright surface
        reflection drowns out the deeper, weaker echoes.
        """
        angles  = np.linspace(sweep_start_angle, sweep_end_angle, num_scanlines)
        raw_env = []   # collect un-normalised envelope per scanline

        for angle in angles:
            result = self.a_mode(
                probe_x=probe_x,
                probe_y=probe_y,
                beam_angle=float(angle),
                frequency=frequency,
                snr=snr,
                num_samples=num_samples,
                max_depth=max_depth,
                normalize=False,   # preserve raw energy so global 2D norm works correctly
                tgc_gain=0.0,      # NO TGC: let Beer-Lambert attenuation be physically visible.
                                   # TGC would compensate depth losses and hide:
                                   #   (a) acoustic shadowing (far skull must be darker)
                                   #   (b) frequency-dependent penetration (10 MHz dies out
                                   #       5× faster per cm than 2 MHz — must be visible)
            )
            env = np.abs(np.array(result["amplitudes"]))
            raw_env.append(env)

        # ── Lateral scanline smoothing ─────────────────────────────────────
        # Average each depth sample across 5 adjacent scanlines (weighted kernel).
        # Tissue boundaries are spatially coherent (same depth ±few scanlines)
        # → preserved.  Random noise is incoherent → reduced by ~√3 ≈ 1.73×.
        # This is equivalent to spatial compounding in real ultrasound hardware.
        stack = np.stack(raw_env, axis=0)          # (num_scanlines, num_samples)
        lateral_kernel  = np.array([1, 2, 3, 2, 1], dtype=float) / 9.0
        stack = np.apply_along_axis(
            lambda col: np.convolve(col, lateral_kernel, mode="same"),
            axis=0,   # smooth across scanlines for each depth sample
            arr=stack,
        )

        # ── Global 2D normalisation ────────────────────────────────────────
        p99   = float(np.percentile(stack, 99))
        if p99 > 0:
            stack /= p99
        stack = np.clip(stack, 0.0, 1.0)

        # ── Noise gate ─────────────────────────────────────────────────────
        # At SNR=200: raw noise/p99 ≈ 0.008; after lateral smoothing ≈ 0.005.
        # Gate at 0.004 catches most residual noise while tissue echoes
        # at 2–5 MHz (≈0.002 of skull) remain visible after log compression.
        noise_gate = 0.004
        stack[stack < noise_gate] = 0.0

        # ── Log compression ────────────────────────────────────────────────
        # 60 dB range (999×): lifts inner tissue echoes (0.15–0.4 % of skull)
        # to 2–5 % gray before depth fade, making them faintly visible at 2–5 MHz
        # while they disappear naturally at 10 MHz (correct frequency behaviour).
        image = (np.log1p(stack * 999.0) / np.log1p(999.0)).tolist()

        max_depth_m = max_depth * self.phantom.SCALE
        depths_m    = np.linspace(0, max_depth_m, num_samples)

        return {
            "image":         image,
            "depths":        depths_m.tolist(),
            "angles":        angles.tolist(),
            "num_scanlines": num_scanlines,
            "num_samples":   num_samples,
            "probe_x":       probe_x,
            "probe_y":       probe_y,
        }

    # ═══════════════════════════════════════════════════════════════════════
    # Doppler
    # ═══════════════════════════════════════════════════════════════════════
    def doppler_mode(
        self,
        probe_x:    float,
        probe_y:    float,
        beam_angle: float,
        vx:         float = 0.3,
        vy:         float = 0.0,
        frequency:  float = 5e6,
        snr:        float = 200.0,
    ) -> dict:
        """Compute Doppler output.

        Doppler equation:  delta_f = 2 * f0 * v * cos(theta) / c
        where theta is the angle between the beam axis and the flow vector.

        Implemented via dot product -- naturally gives 0 Hz when beam is
        perpendicular to flow, regardless of flow speed.
        """
        c = SPEED_OF_SOUND_TISSUE

        dx, dy = self._beam_direction(probe_x, probe_y, beam_angle)
        beam_unit = np.array([dx, dy])

        vessel_vec = np.array([vx, vy])
        blood_vel  = float(np.linalg.norm(vessel_vec))

        # Component of flow toward the transducer = -dot(beam, vessel)
        # (beam points away; flow toward probe is opposite beam direction)
        if blood_vel > 1e-6:
            effective_vel = float(-np.dot(beam_unit, vessel_vec))
            cos_theta     = -effective_vel / blood_vel
            cos_theta     = float(np.clip(cos_theta, -1.0, 1.0))
            theta_deg     = float(np.rad2deg(np.arccos(abs(cos_theta))))
        else:
            effective_vel = 0.0
            cos_theta     = 0.0
            theta_deg     = 90.0

        # Doppler shift
        delta_f = 2.0 * frequency * effective_vel / c

        # Simulated spectrum
        num_pts = 256
        vessel  = self.phantom.ellipses[10]
        broadening_hz = vessel.semi_a * 600.0

        f_min = delta_f - broadening_hz * 3.5
        f_max = delta_f + broadening_hz * 3.5
        freq_axis = np.linspace(f_min, f_max, num_pts)

        sigma    = max(broadening_hz, 10.0)
        spectrum = np.exp(-0.5 * ((freq_axis - delta_f) / sigma) ** 2)
        spectrum = np.clip(spectrum / (spectrum.max() + 1e-30), 0.0, 1.0)

        spectrum = add_noise_1d(spectrum, snr)
        spectrum = np.clip(spectrum, 0.0, 1.0)

        vel_axis = freq_axis * c / (2.0 * frequency + 1e-30)

        if abs(delta_f) < 1.0:
            flow_direction = "perpendicular"
        elif delta_f > 0:
            flow_direction = "towards"
        else:
            flow_direction = "away"

        return {
            "doppler_shift_hz":      round(delta_f, 2),
            "estimated_velocity_ms": round(effective_vel, 4),
            "flow_direction":        flow_direction,
            "insonation_angle_deg":  round(theta_deg, 2),
            "cos_theta":             round(cos_theta, 4),
            "spectrum": {
                "frequencies": freq_axis.tolist(),
                "magnitudes":  spectrum.tolist(),
                "velocities":  vel_axis.tolist(),
            },
            "vessel": {
                "vx":       vx,
                "vy":       vy,
                "center_x": vessel.center_x,
                "center_y": vessel.center_y,
                "semi_a":   vessel.semi_a,
                "semi_b":   vessel.semi_b,
                "theta_deg": vessel.theta_deg,
            },
        }
