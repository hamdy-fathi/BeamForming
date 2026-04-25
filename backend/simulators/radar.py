"""
360° Radar scanner simulator with phased-array beam steering.

Supports up to 5 solid-body targets with variable size, position, and distance.
Demonstrates wide-beam vs narrow-beam scanning trade-off.
"""

import numpy as np
from core.beamforming import BeamformingSimulator
from core.apodization import WindowType
from core.noise import add_noise_1d
from core.physics import radar_received_power, wavelength, SPEED_OF_LIGHT


class RadarSimulator:
    """360° rotating radar with electronic beam steering."""

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

        Returns detection results for all targets visible within this beam direction.
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

        detections = []
        range_returns = np.zeros(num_range_bins)
        range_axis = np.linspace(0, self.MAX_RANGE, num_range_bins)

        for tgt in targets:
            # angular difference between scan direction and target
            angle_diff = (tgt["angle"] - scan_angle + 180) % 360 - 180  # [-180, 180]

            # is target within the beam width?
            if abs(angle_diff) > half_bw * 2:
                continue  # outside even the side lobes

            # beam gain at target angle (approximate Gaussian main lobe)
            beam_gain = np.exp(-2.77 * (angle_diff / half_bw) ** 2)  # -3dB at half_bw

            # radar cross section proportional to size squared
            rcs = tgt["size"] ** 2  # m²

            # received power
            pr = radar_received_power(
                self.TX_POWER, gain * beam_gain, rcs, wl, tgt["distance"]
            )

            # convert to signal level
            signal_level = 10 * np.log10(pr + 1e-30) + 100  # shift to positive

            if signal_level > 10:  # detection threshold
                # find range bin
                bin_idx = int(tgt["distance"] / self.MAX_RANGE * (num_range_bins - 1))
                bin_idx = np.clip(bin_idx, 0, num_range_bins - 1)

                # add target return (Gaussian spread in range)
                spread = max(3, int(tgt["size"] / self.MAX_RANGE * num_range_bins))
                for di in range(-spread, spread + 1):
                    idx = bin_idx + di
                    if 0 <= idx < num_range_bins:
                        range_returns[idx] += signal_level * np.exp(-0.5 * (di / max(spread / 2, 1)) ** 2)

                detections.append({
                    "target_id": tgt["id"],
                    "distance": tgt["distance"],
                    "angle": tgt["angle"],
                    "size": tgt["size"],
                    "angle_diff": round(angle_diff, 2),
                    "signal_level": round(signal_level, 2),
                    "beam_gain": round(beam_gain, 4),
                    "estimated_size": round(tgt["size"] * (beam_width / 5.0), 1),
                })

        # add noise to range returns
        range_returns = add_noise_1d(range_returns, snr)
        range_returns = np.clip(range_returns, 0, None)

        return {
            "scan_angle": scan_angle,
            "beam_width": beam_width,
            "detections": detections,
            "range_returns": range_returns.tolist(),
            "range_axis": range_axis.tolist(),
        }

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
    ) -> dict:
        """Perform a complete 360° sweep.

        Returns PPI data and all detected targets.
        """
        # number of angular steps depends on beam width
        # narrower beam → more steps → slower but more precise
        num_steps = max(int(360 / beam_width * 2), 36)
        angles = np.linspace(0, 360, num_steps, endpoint=False)

        all_detections = []
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
                num_range_bins=200,
            )
            ppi_data.append({
                "angle": float(angle),
                "returns": result["range_returns"],
            })
            all_detections.extend(result["detections"])

        # deduplicate detections
        seen_ids = set()
        unique_detections = []
        for d in sorted(all_detections, key=lambda x: x["signal_level"], reverse=True):
            if d["target_id"] not in seen_ids:
                seen_ids.add(d["target_id"])
                unique_detections.append(d)

        return {
            "beam_width": beam_width,
            "scan_speed_rpm": scan_speed_rpm,
            "num_steps": num_steps,
            "scan_time_seconds": round(60.0 / scan_speed_rpm, 2),
            "detected_targets": unique_detections,
            "ppi_data": ppi_data,
            "range_max": self.MAX_RANGE,
        }
