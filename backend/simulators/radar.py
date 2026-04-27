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

        for tgt in targets:
            # angular difference between scan direction and target
            angle_diff = (tgt["angle"] - scan_angle + 180) % 360 - 180

            # Single-element pattern (cosine over front hemisphere)
            if abs(angle_diff) > 90:
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
            if signal_level_check <= 1:
                continue

            # Instead, clamp the bin index so they map to the edge bin.
            # This avoids silent misses while still placing them at the
            # boundary; the weak signal will naturally fall below CFAR.
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

        # Add noise then clip negative values
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
        """Perform scan over a sector of angles.

        Returns a list of raw range return profiles.
        """
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        # Handle wraparound
        if end_angle < start_angle:
            end_angle += 360.0

        angles  = np.arange(start_angle, end_angle, step_angle)
        results = []
        for a in angles:
            actual_angle = a % 360.0
            res = self.scan_at_angle(
                scan_angle=actual_angle,
                beam_width=beam_width,
                targets=targets,
                num_elements=num_elements,
                element_spacing=element_spacing,
                frequency=frequency,
                window_type=window_type,
                snr=snr,
                max_range=max_range,
                num_range_bins=NUM_RANGE_BINS,  # FIX 3: consistent bin count
            )
            results.append({
                "angle":   actual_angle,
                "returns": res["range_returns"],
            })

        return results

    def detect_from_buffer(
        self,
        ppi_data: list[dict],
        beam_width: float,
        frequency: float,
        targets: list[dict],
        detection_threshold: float = 10.0,   # FIX 4: lowered from 12 → 10 dB
        max_range: float           = None,
    ) -> dict:
        """Process an accumulated PPI buffer and return matched detections."""
        if max_range is None:
            max_range = self.DEFAULT_MAX_RANGE

        estimated_detections = self.detect_targets_from_signal(
            angle_profiles=ppi_data,
            beam_width=beam_width,
            num_range_bins=NUM_RANGE_BINS,    # FIX 3: consistent bin count
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

    # ── CFAR-style peak detector ─────────────────────────────────────────────

    @staticmethod
    def detect_peaks_cfar(
        range_returns: np.ndarray,
        threshold_db: float  = 10.0,   # FIX 4: default lowered
        guard_cells: int     = 4,
        reference_cells: int = 16,
    ) -> list[dict]:
        """Cell-Averaging CFAR detector on a 1-D range profile.

        For each cell under test (CUT), the noise floor is estimated
        from surrounding reference cells (excluding guard cells).
        A detection is declared if CUT > noise_floor + threshold_db.

        Returns list of {bin_idx, signal_level, noise_floor}.
        """
        n          = len(range_returns)
        detections = []
        half_win   = guard_cells + reference_cells

        for i in range(half_win, n - half_win):
            cut  = range_returns[i]
            lead = range_returns[i - half_win: i - guard_cells]
            lag  = range_returns[i + guard_cells + 1: i + half_win + 1]

            noise_floor = np.mean(np.concatenate([lead, lag]))

            if cut > noise_floor + threshold_db:
                detections.append({
                    "bin_idx":      i,
                    "signal_level": float(cut),
                    "noise_floor":  float(noise_floor),
                })

        # Merge adjacent detections — keep only the peak within each cluster
        merged = []
        if detections:
            cluster = [detections[0]]
            for d in detections[1:]:
                if d["bin_idx"] - cluster[-1]["bin_idx"] <= guard_cells * 2:
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
                guard_cells=3,
                reference_cells=12,
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

        range_threshold = max_range / num_range_bins * 10  # ~10 bins
        angle_threshold = beam_width * 2.5

        for i, pt in enumerate(raw_points):
            if used[i]:
                continue
            cluster = [pt]
            used[i] = True
            for j in range(i + 1, len(raw_points)):
                if used[j]:
                    continue
                angle_diff = abs(
                    (raw_points[j]["angle"] - pt["angle"] + 180) % 360 - 180
                )
                range_diff = abs(raw_points[j]["range"] - pt["range"])
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

            # Physics-based size estimator: invert radar equation to get RCS
            pr      = 10.0 ** ((max_signal - 200.0) / 10.0)
            rcs_est = (
                pr * (4.0 * np.pi) ** 3 * (est_range ** 4)
            ) / (self.TX_POWER * gain ** 2 * wl ** 2 + 1e-30)
            est_size = float(np.sqrt(max(rcs_est, 0.0)))

            if not np.isfinite(est_size):
                est_size = 0.0

            detections.append({
                "det_id":            idx,
                "est_range":         round(est_range, 1),
                "est_angle":         round(est_angle, 2),
                "signal_level":      round(max_signal, 2),
                "est_size":          round(est_size, 2),
                "uncertainty_range": round(range_resolution * 3, 1),
                "uncertainty_angle": round(beam_width / 2.0, 2),
                "uncertainty_size":  round(max(est_size * 0.35, 2.0), 2),
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