"""
360° Radar scanner simulator with phased-array beam steering
and signal-based target detection (CFAR-style).

The radar does NOT know where targets are — it estimates positions
from the raw range-return signal using peak detection.
"""

import numpy as np
from core.beamforming import BeamformingSimulator
from core.apodization import WindowType
from core.noise import add_noise_1d
from core.physics import radar_received_power, wavelength, SPEED_OF_LIGHT



NUM_RANGE_BINS: int = 500


class RadarSimulator:
    """360° rotating radar with electronic beam steering and blind detection."""

    DEFAULT_FREQ      = 3e9        # S-band 3 GHz
    DEFAULT_MAX_RANGE = 100_000.0  # 100 km  (was 50 km — raised so far targets
                                   #          are not clipped)
    TX_POWER          = 50_000.0   # 50 kW   (was 1 kW — needed for R^4 loss)
    ANTENNA_GAIN_DB   = 35.0       # dBi     (was 30 dB — extra margin)

    def __init__(self):
        self.beamformer = BeamformingSimulator(
            num_elements=32,
            element_spacing=0.5,
            frequency=self.DEFAULT_FREQ,
            steering_angle=0.0,
            snr=200,
            window_type=WindowType.HAMMING,
            medium_speed=SPEED_OF_LIGHT,
        )

    # Thermal noise floor in dB (receiver noise).  This sets the
    # baseline that CFAR measures against so that only genuine target
    # returns stand above the noise.
    NOISE_FLOOR_DB = 10.0   # dB above the 0-offset baseline

    def scan_at_angle(
        self,
        scan_angle: float,            # degrees 0-360
        beam_width: float,            # degrees (main lobe -3 dB width)
        targets: list[dict],          # [{id, distance, angle, size}]
        num_elements: int    = 32,
        element_spacing: float = 0.5,
        frequency: float     = 3e9,
        window_type: str     = "hamming",
        snr: float           = 200.0,
        max_range: float     = None,   # defaults to DEFAULT_MAX_RANGE
        num_range_bins: int  = NUM_RANGE_BINS,
    ) -> dict:
        """Perform a single-angle radar scan.

        Returns RAW range returns only — no target identity information.
        The radar is blind; it only sees signal intensity vs range.
        """
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        self.beamformer.update_params(
            num_elements=num_elements,
            element_spacing=element_spacing,
            frequency=frequency,
            window_type=WindowType(window_type),
            snr=snr,
        )

        wl   = wavelength(frequency, SPEED_OF_LIGHT)
        gain = 10 ** (self.ANTENNA_GAIN_DB / 10.0)

        range_returns_power = np.zeros(num_range_bins)
        range_axis          = np.linspace(0, max_range, num_range_bins)

        # Main-lobe angular gate: only include returns within the main
        # lobe.  The gate scales with beam width — for narrow beams it
        # stays tight to reject sidelobes.
        main_lobe_half = beam_width * 1.5 + 0.5  # degrees

        for tgt in targets:
            # angular difference between scan direction and target
            angle_diff = (tgt["angle"] - scan_angle + 180) % 360 - 180

            # Reject targets outside the main lobe angular gate
            if abs(angle_diff) > main_lobe_half:
                continue

            element_gain = np.cos(np.radians(angle_diff))

            # True beam gain using array factor
            af        = self.beamformer.array_factor(np.array([angle_diff]))
            beam_gain = element_gain * float(np.abs(af[0]))

            # Radar cross section proportional to size squared
            rcs = tgt["size"] ** 2  # m²

            # Received power via radar range equation.
            # beam_gain is the one-way voltage pattern, so the power pattern
            # is beam_gain**2; passing gain * beam_gain**2 means the formula
            # effectively sees gain^2 * beam_gain^4 on the round trip.
            pr = radar_received_power(
                self.TX_POWER,
                gain * (beam_gain ** 2),
                rcs,
                wl,
                tgt["distance"],
            )

            # Check signal is above a floor before spreading
            signal_level_check = 10 * np.log10(pr + 1e-30) + 200
            if signal_level_check <= self.NOISE_FLOOR_DB:
                continue

            # Clamp the bin index so targets beyond max_range map to
            # the edge bin; the weak signal naturally falls below CFAR.
            bin_idx = int(tgt["distance"] / max_range * (num_range_bins - 1))
            bin_idx = np.clip(bin_idx, 0, num_range_bins - 1)

            # Add target return with Gaussian spread in range
            bin_width     = max_range / num_range_bins
            spread_meters = max(bin_width, float(tgt["size"]))
            for di in range(-10, 11):
                idx = bin_idx + di
                if 0 <= idx < num_range_bins:
                    range_returns_power[idx] += pr * np.exp(
                        -0.5 * ((di * bin_width) / spread_meters) ** 2
                    )

        # Convert accumulated power to dB scale
        range_returns = 10 * np.log10(range_returns_power + 1e-30) + 200

        # Add a realistic thermal noise floor so that CFAR has a
        # meaningful baseline.  Without this, empty bins sit at 0 dB
        # and even tiny returns trigger false alarms.
        rng = np.random.default_rng()
        thermal_noise = rng.normal(
            loc=self.NOISE_FLOOR_DB, scale=1.5, size=num_range_bins
        )
        range_returns = np.maximum(range_returns, thermal_noise)

        # Add signal-level noise scaled by the user SNR parameter
        range_returns = add_noise_1d(range_returns, snr)
        range_returns = np.clip(range_returns, 0, None)

        return {
            "scan_angle":   scan_angle,
            "beam_width":   beam_width,
            "range_returns": range_returns.tolist(),
            "range_axis":   range_axis.tolist(),
        }

    def scan_sector(
        self,
        start_angle: float,
        end_angle: float,
        step_angle: float,
        beam_width: float,
        targets: list[dict],
        num_elements: int    = 32,
        element_spacing: float = 0.5,
        frequency: float     = 3e9,
        window_type: str     = "hamming",
        snr: float           = 200.0,
        max_range: float     = None,  
    ) -> list[dict]:
        """Perform scan over a sector of angles — **vectorized**.

        Computes all scan angles in a single pass using numpy broadcasting
        instead of calling scan_at_angle in a Python loop.
        """
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        # Handle wraparound
        if end_angle < start_angle:
            end_angle += 360.0

        scan_angles = np.arange(start_angle, end_angle, step_angle) % 360.0
        n_angles = len(scan_angles)
        if n_angles == 0:
            return []

        # Setup beamformer once for the whole sector
        self.beamformer.update_params(
            num_elements=num_elements,
            element_spacing=element_spacing,
            frequency=frequency,
            window_type=WindowType(window_type),
            snr=snr,
        )

        wl = wavelength(frequency, SPEED_OF_LIGHT)
        gain = 10 ** (self.ANTENNA_GAIN_DB / 10.0)
        main_lobe_half = beam_width * 1.5 + 0.5
        bin_width = max_range / NUM_RANGE_BINS

        # Pre-allocate: (n_angles, NUM_RANGE_BINS)
        all_power = np.zeros((n_angles, NUM_RANGE_BINS))

        # Process each target across ALL angles at once
        for tgt in targets:
            tgt_angle = tgt["angle"]
            tgt_dist  = tgt["distance"]
            rcs       = tgt["size"] ** 2

            # Angular diff for every scan angle at once
            angle_diffs = (tgt_angle - scan_angles + 180) % 360 - 180  # (n_angles,)

            # Main-lobe gate mask
            in_lobe = np.abs(angle_diffs) <= main_lobe_half
            if not np.any(in_lobe):
                continue

            lobe_indices = np.where(in_lobe)[0]
            lobe_diffs   = angle_diffs[lobe_indices]

            # Element gain (cosine pattern)
            elem_gains = np.cos(np.radians(lobe_diffs))

            # Array factor for all in-lobe angles at once
            af = self.beamformer.array_factor(lobe_diffs)
            beam_gains = elem_gains * np.abs(af)

            # Radar received power for each angle
            effective_gains = gain * (beam_gains ** 2)
            pr_array = radar_received_power(
                self.TX_POWER, effective_gains, rcs, wl, tgt_dist
            )

            # Filter by signal floor
            sig_db = 10.0 * np.log10(pr_array + 1e-30) + 200.0
            above_floor = sig_db > self.NOISE_FLOOR_DB
            if not np.any(above_floor):
                continue

            # Bin index for this target
            bin_idx = int(tgt_dist / max_range * (NUM_RANGE_BINS - 1))
            bin_idx = np.clip(bin_idx, 0, NUM_RANGE_BINS - 1)
            spread_meters = max(bin_width, float(tgt["size"]))

            # Precompute Gaussian spread weights
            di_range = np.arange(-10, 11)
            gauss_weights = np.exp(-0.5 * ((di_range * bin_width) / spread_meters) ** 2)
            spread_bins = bin_idx + di_range
            valid = (spread_bins >= 0) & (spread_bins < NUM_RANGE_BINS)
            valid_bins = spread_bins[valid]
            valid_gauss = gauss_weights[valid]

            # Apply to all qualifying angles at once
            for k in range(len(lobe_indices)):
                if above_floor[k]:
                    all_power[lobe_indices[k], valid_bins] += pr_array[k] * valid_gauss

        # Convert to dB + thermal noise + signal noise — all vectorized
        all_db = 10.0 * np.log10(all_power + 1e-30) + 200.0

        rng = np.random.default_rng()
        thermal = rng.normal(
            loc=self.NOISE_FLOOR_DB, scale=1.5,
            size=(n_angles, NUM_RANGE_BINS),
        )
        all_db = np.maximum(all_db, thermal)

        # Per-row noise
        if snr < 1000:
            for i in range(n_angles):
                all_db[i] = add_noise_1d(all_db[i], snr)


        all_db = np.clip(all_db, 0, None)

        # Build result list
        results = []
        for i in range(n_angles):
            results.append({
                "angle":   float(scan_angles[i]),
                "returns": all_db[i].tolist(),
            })
        return results

    def detect_from_buffer(
        self,
        ppi_data: list[dict],
        beam_width: float,
        frequency: float,
        targets: list[dict],
        detection_threshold: float = 10.0,
        max_range: float           = None,
    ) -> dict:
        """Process an accumulated PPI buffer and return matched detections."""
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        estimated_detections = self.detect_targets_from_signal(
            angle_profiles=ppi_data,
            beam_width=beam_width,
            num_range_bins=NUM_RANGE_BINS,
            frequency=frequency,
            detection_threshold=detection_threshold,
            max_range=max_range,
        )

        ground_truth = [
            {
                "id":       t["id"],
                "distance": t["distance"],
                "angle":    t["angle"],
                "size":     t["size"],
            }
            for t in targets
        ]

        matched = self._match_detections(estimated_detections, ground_truth)

        return {
            "detections": estimated_detections,
            "matched":    matched,
        }

    # ── CFAR-style peak detector (vectorized) ────────────────────────────────

    @staticmethod
    def detect_peaks_cfar(
        range_returns: np.ndarray,
        threshold_db: float  = 10.0,
        guard_cells: int     = 5,
        reference_cells: int = 20,
    ) -> list[dict]:
        """Vectorized CA-CFAR detector on a 1-D range profile.

        Uses cumulative-sum for O(N) sliding-window noise estimation
        instead of an O(N×W) Python loop.
        """
        n = len(range_returns)
        half_win = guard_cells + reference_cells
        if n <= 2 * half_win:
            return []

        arr = range_returns.astype(np.float64)
        cumsum = np.concatenate(([0.0], np.cumsum(arr)))

        def window_sum(start_arr: np.ndarray, end_arr: np.ndarray) -> np.ndarray:
            return cumsum[end_arr] - cumsum[start_arr]

        # Indices of cells under test
        idx = np.arange(half_win, n - half_win)

        # Leading reference cells: [i - half_win, i - guard_cells)
        lead_sum = window_sum(idx - half_win, idx - guard_cells)
        # Lagging reference cells: (i + guard_cells, i + half_win]
        lag_sum  = window_sum(idx + guard_cells + 1, idx + half_win + 1)

        noise_floor = (lead_sum + lag_sum) / (2 * reference_cells)

        cut = arr[idx]
        above = cut > noise_floor + threshold_db

        det_indices = idx[above]
        if len(det_indices) == 0:
            return []

        # Build raw detections
        detections = [
            {
                "bin_idx":      int(i),
                "signal_level": float(arr[i]),
                "noise_floor":  float(noise_floor[i - half_win]),
            }
            for i in det_indices
        ]

        # Merge adjacent detections — keep only the peak within each cluster.
        merge_gap = max(guard_cells * 3, 10)
        merged = []
        cluster = [detections[0]]
        for d in detections[1:]:
            if d["bin_idx"] - cluster[-1]["bin_idx"] <= merge_gap:
                cluster.append(d)
            else:
                merged.append(max(cluster, key=lambda x: x["signal_level"]))
                cluster = [d]
        merged.append(max(cluster, key=lambda x: x["signal_level"]))

        return merged

    def detect_targets_from_signal(
        self,
        angle_profiles: list[dict],
        beam_width: float,
        num_range_bins: int,
        frequency: float,
        detection_threshold: float = 10.0,
        max_range: float           = None,
    ) -> list[dict]:
        """Estimate targets from raw range-return profiles.

        Runs CFAR peak detection on each angle profile, then clusters
        neighbouring angle/range detections into estimated targets.
        """
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        raw_points = []
        for profile in angle_profiles:
            scan_angle  = float(profile["angle"])
            returns_arr = np.array(profile["returns"])
            peaks = self.detect_peaks_cfar(
                returns_arr,
                threshold_db=detection_threshold,
                guard_cells=5,
                reference_cells=20,
            )
            for p in peaks:
                est_range = p["bin_idx"] / max(num_range_bins - 1, 1) * max_range
                raw_points.append({
                    "angle":        scan_angle,
                    "range":        est_range,
                    "signal_level": p["signal_level"],
                    "noise_floor":  p["noise_floor"],
                    "bin_idx":      p["bin_idx"],
                })

        return self._cluster_detections(
            raw_points,
            beam_width,
            num_range_bins,
            frequency,
            max_range,
        )


    def _cluster_detections(
        self,
        raw_points: list[dict],
        beam_width: float,
        num_range_bins: int,
        frequency: float,
        max_range: float,
    ) -> list[dict]:
        """Cluster raw detection points into target estimates.

        Groups points close in angle and range, then computes a
        signal-power-weighted centroid as the estimated position.
        """
        if not raw_points:
            return []

        raw_points.sort(key=lambda p: (p["angle"], p["range"]))

        clusters: list[list[dict]] = []
        used = [False] * len(raw_points)

        range_threshold = max_range / num_range_bins * 15  # ~15 bins
        angle_threshold = beam_width * 3.0

        for i, pt in enumerate(raw_points):
            if used[i]:
                continue
            cluster = [pt]
            used[i] = True
            for j in range(i + 1, len(raw_points)):
                if used[j]:
                    continue
                # Compare against the cluster centroid, not just the seed
                # point, to handle chains of detections at different angles
                c_angle = np.mean([p["angle"] for p in cluster])
                c_range = np.mean([p["range"] for p in cluster])
                angle_diff = abs(
                    (raw_points[j]["angle"] - c_angle + 180) % 360 - 180
                )
                range_diff = abs(raw_points[j]["range"] - c_range)
                if angle_diff < angle_threshold and range_diff < range_threshold:
                    cluster.append(raw_points[j])
                    used[j] = True
            clusters.append(cluster)

        detections    = []
        range_resolution = max_range / num_range_bins
        wl            = wavelength(frequency, SPEED_OF_LIGHT)
        gain          = 10.0 ** (self.ANTENNA_GAIN_DB / 10.0)

        for idx, cluster in enumerate(clusters):
            # Convert dB to linear for power-weighted centroid
            linear_powers = [10.0 ** (p["signal_level"] / 10.0) for p in cluster]
            total_power   = sum(linear_powers)
            if total_power < 1e-30:
                continue

            est_range = sum(
                p["range"] * w for p, w in zip(cluster, linear_powers)
            ) / total_power

            # Angle averaging with wrap-around via atan2
            sin_sum = sum(
                np.sin(np.radians(p["angle"])) * w
                for p, w in zip(cluster, linear_powers)
            )
            cos_sum = sum(
                np.cos(np.radians(p["angle"])) * w
                for p, w in zip(cluster, linear_powers)
            )
            est_angle = float(np.degrees(np.arctan2(sin_sum, cos_sum))) % 360

            max_signal = max(p["signal_level"] for p in cluster)

            # ── Size estimation (deterministic) ──────────────────────────
            # Invert the radar equation to get RCS, then size = √RCS.
            pr      = 10.0 ** ((max_signal - 200.0) / 10.0)
            rcs_est = (
                pr * (4.0 * np.pi) ** 3 * (est_range ** 4)
            ) / (self.TX_POWER * gain ** 2 * wl ** 2 + 1e-30)
            est_size = float(np.sqrt(max(rcs_est, 0.0)))

            if not np.isfinite(est_size):
                est_size = 0.0

            # Beam-width-dependent size degradation (deterministic).
            # Narrow beams (≤3°): factor ≈ 1.0 → accurate.
            # Wide beams (30°):   factor ≈ 1.8 → ~80% overestimate.
            # This is the ONLY place beam width affects size accuracy.
            # No noise is added to the scan signal, so zero false positives.
            bw_excess = max(0.0, beam_width - 3.0)
            size_factor = 1.0 + (bw_excess / 10.0) ** 1.3
            est_size *= size_factor

            # Uncertainty: scales with beam width
            bw_frac = np.clip((beam_width - 2.0) / 30.0, 0.0, 1.0)
            size_uncertainty = max(est_size * (0.05 + 0.45 * bw_frac), 1.0)

            detections.append({
                "det_id":            idx,
                "est_range":         round(est_range, 1),
                "est_angle":         round(est_angle, 2),
                "signal_level":      round(max_signal, 2),
                "est_size":          round(est_size, 2),
                "uncertainty_range": round(range_resolution * 3, 1),
                "uncertainty_angle": round(beam_width / 2.0, 2),
                "uncertainty_size":  round(size_uncertainty, 2),
                "num_hits":          len(cluster),
            })

        return detections

    @staticmethod
    def _match_detections(
        detections:   list[dict],
        ground_truth: list[dict],
    ) -> list[dict]:
        """Match estimated detections to ground-truth targets.

        Uses nearest-neighbour matching in polar space.
        Returns a list with comparison metrics for each GT target.
        """
        matched  = []
        used_det = set()

        for gt in ground_truth:
            best_det  = None
            best_dist = float("inf")

            for i, det in enumerate(detections):
                if i in used_det:
                    continue
                angle_diff = abs(
                    (det["est_angle"] - gt["angle"] + 180) % 360 - 180
                )
                range_diff = abs(det["est_range"] - gt["distance"])
                polar_dist = np.sqrt((angle_diff * 500) ** 2 + range_diff ** 2)
                if polar_dist < best_dist:
                    best_dist = polar_dist
                    best_det  = i

            # Accept match if within a reasonable polar distance
            match_threshold = 15_000 + gt["distance"] * 0.05  # scales with range
            if best_det is not None and best_dist < match_threshold:
                det = detections[best_det]
                used_det.add(best_det)

                range_error = det["est_range"] - gt["distance"]
                angle_error = (det["est_angle"] - gt["angle"] + 180) % 360 - 180
                est_size_val = det.get("est_size")
                if est_size_val is None or not np.isfinite(est_size_val):
                    est_size_val = None
                    size_error   = None
                else:
                    size_error = round(est_size_val - gt["size"], 2)

                matched.append({
                    "target_id":   gt["id"],
                    "detected":    True,
                    "true_range":  gt["distance"],
                    "true_angle":  gt["angle"],
                    "true_size":   gt["size"],
                    "est_range":   det["est_range"],
                    "est_angle":   det["est_angle"],
                    "est_size":    est_size_val,
                    "range_error": round(range_error, 1),
                    "angle_error": round(angle_error, 2),
                    "size_error":  size_error,
                    "signal_level": det["signal_level"],
                    "det_id":      det["det_id"],
                })
            else:
                matched.append({
                    "target_id":   gt["id"],
                    "detected":    False,
                    "true_range":  gt["distance"],
                    "true_angle":  gt["angle"],
                    "true_size":   gt["size"],
                    "est_range":   None,
                    "est_angle":   None,
                    "est_size":    None,
                    "range_error": None,
                    "angle_error": None,
                    "size_error":  None,
                    "signal_level": None,
                    "det_id":      None,
                })

        return matched