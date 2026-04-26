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


class RadarSimulator:
    """360° rotating radar with electronic beam steering and blind detection."""

    DEFAULT_FREQ = 3e9       # S-band 3 GHz
    MAX_RANGE = 50_000.0     # 50 km
    TX_POWER = 1000.0        # Watts
    ANTENNA_GAIN_DB = 30.0

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
        scan_angle: float,           # degrees 0-360
        beam_width: float,           # degrees (main lobe -3dB width)
        targets: list[dict],         # [{id, distance, angle, size}]
        num_elements: int = 32,
        element_spacing: float = 0.5,
        frequency: float = 3e9,
        window_type: str = "hamming",
        snr: float = 200.0,
        num_range_bins: int = 500,
    ) -> dict:
        """Perform a single-angle radar scan.

        Returns RAW range returns only — no target identity information.
        The radar is blind; it only sees signal intensity vs range.
        """
        self.beamformer.update_params(
            num_elements=num_elements,
            element_spacing=element_spacing,
            frequency=frequency,
            window_type=WindowType(window_type),
            snr=snr,
        )

        wl = wavelength(frequency, SPEED_OF_LIGHT)
        gain = 10 ** (self.ANTENNA_GAIN_DB / 10.0)
        half_bw = beam_width / 2.0

        range_returns = np.zeros(num_range_bins)
        range_axis = np.linspace(0, self.MAX_RANGE, num_range_bins)

        for tgt in targets:
            # angular difference between scan direction and target
            angle_diff = (tgt["angle"] - scan_angle + 180) % 360 - 180

            # is target within the beam width (including sidelobes)?
            if abs(angle_diff) > half_bw * 2:
                continue

            # beam gain at target angle (approximate Gaussian main lobe)
            beam_gain = np.exp(-2.77 * (angle_diff / half_bw) ** 2)

            # radar cross section proportional to size squared
            rcs = tgt["size"] ** 2  # m²

            # received power via radar range equation
            pr = radar_received_power(
                self.TX_POWER, gain * beam_gain, rcs, wl, tgt["distance"]
            )

            # convert to signal level (dB scale, shifted to positive range)
            # pr is very small at km ranges, so shift by +200 dB
            signal_level = 10 * np.log10(pr + 1e-30) + 200

            if signal_level > 1:
                # find range bin for this target
                bin_idx = int(tgt["distance"] / self.MAX_RANGE * (num_range_bins - 1))
                bin_idx = np.clip(bin_idx, 0, num_range_bins - 1)

                # add target return with Gaussian spread in range
                spread = max(3, int(tgt["size"] / self.MAX_RANGE * num_range_bins))
                for di in range(-spread, spread + 1):
                    idx = bin_idx + di
                    if 0 <= idx < num_range_bins:
                        range_returns[idx] += signal_level * np.exp(
                            -0.5 * (di / max(spread / 2, 1)) ** 2
                        )

        # add noise to range returns
        range_returns = add_noise_1d(range_returns, snr)
        range_returns = np.clip(range_returns, 0, None)

        return {
            "scan_angle": scan_angle,
            "beam_width": beam_width,
            "range_returns": range_returns.tolist(),
            "range_axis": range_axis.tolist(),
        }

    # ── CFAR-style detection on raw signal ──────────────────────────────

    @staticmethod
    def detect_peaks_cfar(
        range_returns: np.ndarray,
        threshold_db: float = 12.0,
        guard_cells: int = 4,
        reference_cells: int = 16,
    ) -> list[dict]:
        """Cell-Averaging CFAR detector on a 1-D range profile.

        For each cell under test (CUT), the noise floor is estimated
        from surrounding reference cells (excluding guard cells).
        A detection is declared if CUT exceeds noise_floor + threshold_db.

        Returns list of {bin_idx, signal_level, noise_floor}.
        """
        n = len(range_returns)
        detections = []
        half_win = guard_cells + reference_cells

        for i in range(half_win, n - half_win):
            cut = range_returns[i]

            # leading reference cells
            lead = range_returns[i - half_win: i - guard_cells]
            # lagging reference cells
            lag = range_returns[i + guard_cells + 1: i + half_win + 1]

            noise_floor = np.mean(np.concatenate([lead, lag]))

            if cut > noise_floor + threshold_db:
                detections.append({
                    "bin_idx": i,
                    "signal_level": float(cut),
                    "noise_floor": float(noise_floor),
                })

        # merge adjacent detections — keep only the peak within each cluster
        merged = []
        if detections:
            cluster = [detections[0]]
            for d in detections[1:]:
                if d["bin_idx"] - cluster[-1]["bin_idx"] <= guard_cells * 2:
                    cluster.append(d)
                else:
                    # keep the strongest in this cluster
                    best = max(cluster, key=lambda x: x["signal_level"])
                    merged.append(best)
                    cluster = [d]
            best = max(cluster, key=lambda x: x["signal_level"])
            merged.append(best)

        return merged

    def detect_targets_from_signal(
        self,
        angle_profiles: list[dict],
        beam_width: float,
        num_range_bins: int,
        frequency: float,
        detection_threshold: float = 12.0,
    ) -> list[dict]:
        """Estimate targets from raw range-return profiles.

        The estimator runs CFAR-style peak detection on each angle profile,
        then clusters neighboring angle/range detections into estimated targets.
        """
        raw_points = []
        for profile in angle_profiles:
            scan_angle = float(profile["angle"])
            returns_arr = np.array(profile["returns"])
            peaks = self.detect_peaks_cfar(
                returns_arr,
                threshold_db=detection_threshold,
                guard_cells=3,
                reference_cells=12,
            )
            for p in peaks:
                est_range = p["bin_idx"] / max(num_range_bins - 1, 1) * self.MAX_RANGE
                raw_points.append({
                    "angle": scan_angle,
                    "range": est_range,
                    "signal_level": p["signal_level"],
                    "noise_floor": p["noise_floor"],
                    "bin_idx": p["bin_idx"],
                })

        return self._cluster_detections(
            raw_points,
            beam_width,
            num_range_bins,
            frequency,
        )

    # ── Full 360° sweep with detection ──────────────────────────────────

    def full_sweep(
        self,
        beam_width: float,
        scan_speed_rpm: float,
        targets: list[dict],
        num_elements: int = 32,
        element_spacing: float = 0.5,
        frequency: float = 3e9,
        window_type: str = "hamming",
        snr: float = 200.0,
        detection_threshold: float = 12.0,
    ) -> dict:
        """Perform a complete 360° sweep with blind detection.

        Returns:
        - ppi_data: raw scan returns for rendering
        - detections: estimated target positions from signal processing
        - ground_truth: actual target positions for comparison
        """
        num_range_bins = 200
        num_steps = max(int(360 / beam_width * 2), 36)
        angles = np.linspace(0, 360, num_steps, endpoint=False)

        ppi_data = []

        for angle in angles:
            result = self.scan_at_angle(
                scan_angle=angle,
                beam_width=beam_width,
                targets=targets,
                num_elements=num_elements,
                element_spacing=element_spacing,
                frequency=frequency,
                window_type=window_type,
                snr=snr,
                num_range_bins=num_range_bins,
            )
            ppi_data.append({
                "angle": float(angle),
                "returns": result["range_returns"],
            })

        estimated_detections = self.detect_targets_from_signal(
            angle_profiles=ppi_data,
            beam_width=beam_width,
            num_range_bins=num_range_bins,
            frequency=frequency,
            detection_threshold=detection_threshold,
        )

        # ── Ground truth ──
        ground_truth = [
            {
                "id": t["id"],
                "distance": t["distance"],
                "angle": t["angle"],
                "size": t["size"],
            }
            for t in targets
        ]

        # ── Match detections to ground truth for comparison ──
        matched = self._match_detections(estimated_detections, ground_truth)

        return {
            "beam_width": beam_width,
            "scan_speed_rpm": scan_speed_rpm,
            "num_steps": num_steps,
            "scan_time_seconds": round(60.0 / scan_speed_rpm, 2),
            "ppi_data": ppi_data,
            "range_max": self.MAX_RANGE,
            "detections": estimated_detections,
            "ground_truth": ground_truth,
            "matched": matched,
        }

    def _cluster_detections(
        self,
        raw_points: list[dict],
        beam_width: float,
        num_range_bins: int,
        frequency: float,
    ) -> list[dict]:
        """Cluster raw detection points into target estimates.

        Groups points that are close in angle and range, then computes
        the centroid as the estimated position. Signal-weighted averaging
        gives better accuracy.
        """
        if not raw_points:
            return []

        # Sort by angle then range
        raw_points.sort(key=lambda p: (p["angle"], p["range"]))

        clusters: list[list[dict]] = []
        used = [False] * len(raw_points)

        range_threshold = self.MAX_RANGE / num_range_bins * 10  # ~10 bins
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

        # Compute weighted centroid for each cluster
        detections = []
        for idx, cluster in enumerate(clusters):
            total_signal = sum(p["signal_level"] for p in cluster)
            if total_signal < 1e-10:
                continue

            # Signal-weighted average for position
            est_range = sum(
                p["range"] * p["signal_level"] for p in cluster
            ) / total_signal

            # For angle averaging, handle wrap-around using atan2
            sin_sum = sum(
                np.sin(np.radians(p["angle"])) * p["signal_level"]
                for p in cluster
            )
            cos_sum = sum(
                np.cos(np.radians(p["angle"])) * p["signal_level"]
                for p in cluster
            )
            est_angle = float(np.degrees(np.arctan2(sin_sum, cos_sum))) % 360

            max_signal = max(p["signal_level"] for p in cluster)
            # Robust size estimator:
            # - use SNR-like contrast above local CFAR noise floor
            # - include range-bin span (unresolved overlap widens return)
            # This avoids unstable inverse-physics blowups when returns overlap.
            signal_samples = np.array([p["signal_level"] for p in cluster], dtype=float)
            size_signal_db = float(np.percentile(signal_samples, 75))
            noise_floor_db = float(np.median([p["noise_floor"] for p in cluster]))
            snr_db = max(size_signal_db - noise_floor_db, 0.0)
            size_from_signal = 2.8 * np.sqrt(snr_db)

            bin_span = max(p["bin_idx"] for p in cluster) - min(p["bin_idx"] for p in cluster) + 1
            range_resolution = self.MAX_RANGE / num_range_bins
            size_from_spread = max(1.0, bin_span * range_resolution / 120.0)

            est_size = float(0.75 * size_from_signal + 0.25 * size_from_spread)
            if not np.isfinite(est_size):
                est_size = 0.0

            # Uncertainty estimates
            # Range uncertainty: based on range bin resolution
            uncertainty_range = range_resolution * 3  # ~3 bins

            # Angle uncertainty: based on beam width
            uncertainty_angle = beam_width / 2.0

            detections.append({
                "det_id": idx,
                "est_range": round(est_range, 1),
                "est_angle": round(est_angle, 2),
                "signal_level": round(max_signal, 2),
                "est_size": round(est_size, 2),
                "uncertainty_range": round(uncertainty_range, 1),
                "uncertainty_angle": round(uncertainty_angle, 2),
                "uncertainty_size": round(max(est_size * 0.35, 2.0), 2),
                "num_hits": len(cluster),
            })

        return detections

    @staticmethod
    def _match_detections(
        detections: list[dict],
        ground_truth: list[dict],
    ) -> list[dict]:
        """Match estimated detections to ground-truth targets.

        Uses nearest-neighbor matching in polar space.
        Returns a list with comparison metrics for each GT target.
        """
        matched = []
        used_det = set()

        for gt in ground_truth:
            best_det = None
            best_dist = float("inf")

            for i, det in enumerate(detections):
                if i in used_det:
                    continue
                # Distance metric in polar space
                angle_diff = abs(
                    (det["est_angle"] - gt["angle"] + 180) % 360 - 180
                )
                range_diff = abs(det["est_range"] - gt["distance"])
                # Normalize: angle in degrees, range in meters
                polar_dist = np.sqrt(
                    (angle_diff * 500) ** 2 + range_diff ** 2
                )
                if polar_dist < best_dist:
                    best_dist = polar_dist
                    best_det = i

            if best_det is not None and best_dist < 15000:
                det = detections[best_det]
                used_det.add(best_det)
                range_error = det["est_range"] - gt["distance"]
                angle_error = (det["est_angle"] - gt["angle"] + 180) % 360 - 180
                est_size_val = det.get("est_size")
                if est_size_val is None or not np.isfinite(est_size_val):
                    est_size_val = None
                    size_error = None
                else:
                    size_error = round(est_size_val - gt["size"], 2)

                matched.append({
                    "target_id": gt["id"],
                    "detected": True,
                    "true_range": gt["distance"],
                    "true_angle": gt["angle"],
                    "true_size": gt["size"],
                    "est_range": det["est_range"],
                    "est_angle": det["est_angle"],
                    "est_size": est_size_val,
                    "range_error": round(range_error, 1),
                    "angle_error": round(angle_error, 2),
                    "size_error": size_error,
                    "signal_level": det["signal_level"],
                    "det_id": det["det_id"],
                })
            else:
                matched.append({
                    "target_id": gt["id"],
                    "detected": False,
                    "true_range": gt["distance"],
                    "true_angle": gt["angle"],
                    "true_size": gt["size"],
                    "est_range": None,
                    "est_angle": None,
                    "est_size": None,
                    "range_error": None,
                    "angle_error": None,
                    "size_error": None,
                    "signal_level": None,
                    "det_id": None,
                })

        return matched
