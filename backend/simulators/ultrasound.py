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
        apparent_depths: dict[int, float] = {}  # id(isect) → apparent_depth_m

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
            apparent_depths[id(isect)] = apparent_depth  # save for return
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

        # Noise is added AFTER TGC (see below).
        seed = (int(probe_x * 1e4) ^ int(probe_y * 1e4) ^
                int(beam_angle * 100) ^ int(frequency / 1e3)) & 0xFFFFFFFF
        rng  = np.random.default_rng(seed)

        # -- Physics-accurate TGC (tissue-aware) --------------------------------
        # Build the one-way Beer-Lambert attenuation profile from the *actual*
        # tissue intersections, then use its inverse as TGC.
        #
        # Why: the old formula assumed α=0.1 dB/cm/MHz everywhere (brain tissue).
        # Skull bone has α=3.0 dB/cm/MHz (30× higher).  The old TGC applied
        # too much gain at the far skull depth, making it appear brighter than
        # the near skull entry — physically wrong.
        #
        # With tissue-aware TGC:
        #   TGC(depth) = 1 / (one-way BL amplitude at that depth)²
        # This exactly cancels Beer-Lambert losses so the displayed amplitude
        # equals R × (transmission losses only).  Physically correct ordering:
        #   near skull entry > far skull wall > soft-tissue echoes.
        # Cap at 30 dB (×31.6) to avoid extreme gain in deep acoustic shadow.
        if tgc_gain == 3.0:  # sentinel: auto-compute from actual tissue path
            _sdepths = np.linspace(0, max_depth, num_samples)   # phantom units
            _bl1     = np.ones(num_samples)   # one-way BL amplitude per sample
            _prev_d  = 0.0
            _bl_now  = 1.0
            for _isect in intersections:
                _dp = _isect["depth_phantom"]
                if _dp <= _prev_d + 1e-9:
                    continue
                _mid  = _prev_d + (_dp - _prev_d) * 0.5
                _t    = self.phantom.point_tissue(
                    probe_x + direction[0] * _mid,
                    probe_y + direction[1] * _mid)
                _a    = _t.attenuation if _t else self.phantom.BG_ATTENUATION
                _sm   = (_dp - _prev_d) * scale          # segment length [m]
                _bl_e = _bl_now * 10.0 ** (-_a * freq_mhz * _sm * 100.0 / 20.0)
                _seg  = (_sdepths >= _prev_d) & (_sdepths < _dp)
                if _seg.any():
                    _f = (_sdepths[_seg] - _prev_d) / (_dp - _prev_d)
                    _bl1[_seg] = _bl_now * 10.0 ** (
                        -_a * freq_mhz * _f * _sm * 100.0 / 20.0)
                _prev_d, _bl_now = _dp, _bl_e
            # tail: background medium beyond last boundary
            _tail = _sdepths >= _prev_d
            if _tail.any():
                _ts   = (_sdepths[_tail] - _prev_d) * scale
                _bl1[_tail] = _bl_now * 10.0 ** (
                    -self.phantom.BG_ATTENUATION * freq_mhz * _ts * 100.0 / 20.0)
            # Round-trip TGC = 1 / (one-way)^2, capped at 30 dB
            tgc = np.clip(1.0 / (_bl1 ** 2 + 1e-30), 1.0, 31.6)
        else:
            tgc = np.exp(tgc_gain * np.linspace(0, 1, num_samples))
        signal *= tgc

        # -- Receiver noise (added AFTER TGC) ------------------------------------
        # Adding noise after TGC gives a uniform noise floor across depth and
        # frequency.  Adding it before TGC was wrong: the tissue-aware TGC can
        # apply up to 30 dB (×31.6) gain, which amplified pre-TGC noise by the
        # same factor — making the noise floor skyrocket at high frequencies and
        # making the SNR slider nearly ineffective (5× SNR change → only 6 dB).
        # Post-TGC noise models thermal/receiver electronics noise, which is indeed
        # independent of depth and frequency.
        signal = add_noise_1d(signal, snr, rng=rng)

        if normalize:
            # Log-compress the envelope BEFORE peak normalisation.
            # Same rationale as B-mode: skull reflection (R≈0.64) is 20–60× stronger
            # than soft-tissue interfaces (R≈0.003–0.02) in the linear domain.
            # Normalising first would map inner echoes to <3 % of full scale → invisible.
            # Log-compressing first (60 dB / factor-999 window) maps:
            #   skull  → 0.93,  inner tissue → 0.25–0.50  (ratio ≈ 2.7×, not 60×).
            sign   = np.sign(signal)
            env    = np.abs(signal)
            env    = np.log1p(env * 999.0) / np.log1p(999.0)
            signal = sign * env

            # Per-scanline normalisation (for A-mode display): peak = 1
            peak = np.max(np.abs(signal))
            if peak > 0:
                signal /= peak

        signal = np.clip(signal, -1.0, 1.0)

        depths_m = np.linspace(0, max_depth_m, num_samples)

        # Annotate intersections with their computed apparent depth
        for isect in intersections:
            isect["apparent_depth_m"] = round(apparent_depths.get(id(isect), isect["depth"]), 6)

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
                # tgc_gain=3.0 (default) → physics-accurate tissue-aware TGC
                # computed from actual intersections; correctly handles skull bone.
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

        # ── Log compression FIRST (before any normalisation) ───────────────
        # CRITICAL ORDER: compress dynamic range on the raw amplitudes so that:
        #   skull boundary  (R ≈ 0.64)  → log scale ≈ 0.93
        #   soft tissue     (R ≈ 0.01)  → log scale ≈ 0.35
        # Normalising first and THEN log-compressing is the classic mistake:
        # the skull sets the linear scale → inner echoes land at 0.5–3 % →
        # log(0.01) pushes them to ~0.07 and they get wiped by the noise gate.
        # 60 dB dynamic range (factor 999) matches clinical US displays.
        DR = 999.0
        stack = np.log1p(stack * DR) / np.log1p(DR)

        # ── Global 2D normalisation ────────────────────────────────────────
        # After log compression skull ≈ 0.93 and inner tissue ≈ 0.25–0.50,
        # so a p99 normalisation is now safe — the skull no longer crushes
        # everything below it.
        p99 = float(np.percentile(stack, 99))
        if p99 > 0:
            stack /= p99
        stack = np.clip(stack, 0.0, 1.0)

        # ── Noise gate ─────────────────────────────────────────────────────
        noise_gate = 0.03   # ~30 dB below peak; clean floor without hiding echoes
        stack[stack < noise_gate] = 0.0

        image = stack.tolist()

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
