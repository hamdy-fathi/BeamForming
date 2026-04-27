"""
5G tower connectivity simulator — physics-accurate beamforming.

Signal model:
  P_rx = P_tx + G_peak - FSPL(d, f)

Multi-user: power is split equally (-3 dB per additional user).
"""

import numpy as np
from core.beamforming import BeamformingSimulator
from core.apodization import WindowType
from core.physics import free_space_path_loss, SPEED_OF_LIGHT


def _canvas_angle_to_user(tower_pos: tuple, user_pos: tuple) -> float:
    """Steering angle (degrees) from tower to user, measured from broadside.
    Convention: arctan2(dx, dy) where 0° = positive-y direction.
    """
    dx = user_pos[0] - tower_pos[0]
    dy = user_pos[1] - tower_pos[1]
    angle = np.rad2deg(np.arctan2(dx, dy))
    return np.clip(angle, -89.0, 89.0)


def _distance(a: tuple, b: tuple) -> float:
    return np.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)



class FiveGSimulator:
    """
    3 towers, 2 users.

    Physics:
    - Each tower has a ULA phased array with user-controlled steering
    - Direct (LOS) signal path
    - Signal = Ptx + G_peak - FSPL(d, f)
    - Connectivity requires: within coverage radius AND total signal > -100 dBm
    """

    MEDIUM_SPEED = SPEED_OF_LIGHT

    def __init__(self):
        self.towers: list[dict] = []
        self.users: list[dict] = []

    def setup(self, towers: list[dict], users: list[dict]):
        self.towers = []
        for i, t in enumerate(towers):
            pos = (t["position"]["x"], t["position"]["y"])
            freq = t.get("frequency", 28e9)
            power_dbm = t.get("power_dbm", 30.0)
            steering_angle = t.get("steering_angle", 0.0)
            snr = t.get("snr", 1000)
            window_type_str = t.get("window_type", "hamming")
            kaiser_beta = t.get("kaiser_beta", 6.0)

            # Spacing slider is d/λ at 28 GHz reference.
            # Changing frequency scales effective d/λ: higher f → narrower beam.
            ref_freq = 28e9
            nominal_spacing = t.get("element_spacing", 0.5)
            effective_spacing = nominal_spacing * (freq / ref_freq)

            sim = BeamformingSimulator(
                num_elements=t.get("num_elements", 32),
                element_spacing=effective_spacing,
                frequency=freq,
                steering_angle=steering_angle,
                snr=snr,
                window_type=WindowType(window_type_str),
                medium_speed=self.MEDIUM_SPEED,
            )
            if window_type_str == "kaiser":
                from core.apodization import get_window
                sim.weights = get_window(WindowType.KAISER, sim.num_elements, beta=kaiser_beta)

            self.towers.append({
                "id": i,
                "position": pos,
                "coverage_radius": t.get("coverage_radius", 500),
                "simulator": sim,
                "power_dbm": power_dbm,
                "connected_users": [],
            })

        self.users = [{"id": i, "position": (u["x"], u["y"])} for i, u in enumerate(users)]

    def _array_gain_db(self, sim: BeamformingSimulator, theta_deg: float) -> float:
        """Compute array gain at a specific angle in dB: 20*log10(|AF(θ)|)."""
        af = sim.array_factor(np.array([theta_deg]))
        mag = np.abs(af[0])
        return 20.0 * np.log10(max(mag, 1e-30))

    def _peak_gain_db(self, sim: BeamformingSimulator) -> float:
        """Peak array gain (as if auto-steered to user). Uses steering angle = peak."""
        af = sim.array_factor(np.array([sim.steering_angle_deg]))
        mag = np.abs(af[0])
        return 20.0 * np.log10(max(mag, 1e-30))

    def _compute_beamwidth_deg(self, sim: BeamformingSimulator) -> float:
        """Compute the -3dB beamwidth from the beam profile."""
        profile = sim.beam_profile(num_points=361)
        mags = np.array(profile["magnitudes_db"])
        angles = np.array(profile["angles"])
        peak = np.max(mags)
        threshold = peak - 3.0
        above = np.where(mags >= threshold)[0]
        if len(above) < 2:
            return 10.0
        return float(angles[above[-1]] - angles[above[0]])

    def _compute_signal(self, sim, power_dbm, tower_pos, user_pos):
        """Compute LOS signal strength.

        Returns (signal_dbm, path_info)
        """
        freq = sim.frequency
        dist = _distance(tower_pos, user_pos)

        array_gain = self._peak_gain_db(sim)
        fspl = free_space_path_loss(max(dist, 1.0), freq)
        signal_dbm = power_dbm + array_gain - fspl

        path_info = {
            "type": "LOS",
            "from": tower_pos,
            "to": user_pos,
            "distance": round(dist, 1),
            "signal_dbm": round(signal_dbm, 1),
            "array_gain_db": round(array_gain, 1),
            "fspl_db": round(free_space_path_loss(max(dist, 1.0), freq), 1),
        }

        return signal_dbm, path_info

    def simulate(self) -> dict:
        # Reset connections
        for t in self.towers:
            t["connected_users"] = []

        user_signals: list[dict] = [{
            "id": u["id"],
            "position": u["position"],
            "connected_towers": [],
            "signal_strengths": {},
        } for u in self.users]

        # ── Phase 1: Compute signal for all tower-user pairs ──
        # user_best[uid] = (best_signal_dbm, best_tower_id)
        user_best: dict[int, tuple[float, int]] = {}

        for t in self.towers:
            sim = t["simulator"]
            power_dbm = t["power_dbm"]
            for u in self.users:
                dist = _distance(t["position"], u["position"])
                if dist > t["coverage_radius"]:
                    continue

                total_signal, _ = self._compute_signal(
                    sim, power_dbm, t["position"], u["position"])

                if total_signal > -100:
                    uid = u["id"]
                    if uid not in user_best or total_signal > user_best[uid][0]:
                        user_best[uid] = (total_signal, t["id"])

        # ── Phase 2: Assign each user to their single best tower ──
        for uid, (_, best_tid) in user_best.items():
            self.towers[best_tid]["connected_users"].append(uid)

        # ── Compute per-tower results ──
        tower_results = []
        for t in self.towers:
            sim: BeamformingSimulator = t["simulator"]
            power_dbm = t["power_dbm"]
            connected = t["connected_users"]
            num_connected = len(connected)

            split_penalty_db = 0.0
            if num_connected > 1:
                split_penalty_db = 10.0 * np.log10(1.0 / num_connected)

            user_beams = []
            connections = []

            for uid in connected:
                upos = self.users[uid]["position"]
                angle_to_user = _canvas_angle_to_user(t["position"], upos)
                dist = _distance(t["position"], upos)

                # Signal computation
                total_signal, path_info = self._compute_signal(
                    sim, power_dbm, t["position"], upos)
                total_signal += split_penalty_db

                # Create a beam steered to this user for visualization
                beam_sim = BeamformingSimulator(
                    num_elements=sim.num_elements,
                    element_spacing=sim.element_spacing,
                    frequency=sim.frequency,
                    steering_angle=angle_to_user,
                    snr=sim.snr,
                    window_type=sim.window_type,
                    medium_speed=self.MEDIUM_SPEED,
                )
                beam_sim.weights = sim.weights.copy()
                profile = beam_sim.beam_profile(num_points=361)
                beamwidth = self._compute_beamwidth_deg(beam_sim)

                signal_pct = max(0, min(100, (total_signal + 120) / 1.2))

                connections.append({
                    "user_id": uid,
                    "distance": round(dist, 1),
                    "steering_angle": round(angle_to_user, 2),
                    "signal_dbm": round(total_signal, 1),
                    "signal_strength": round(signal_pct, 1),
                    "path": path_info,
                    "split_penalty_db": round(split_penalty_db, 1),
                })

                user_beams.append({
                    "user_id": uid,
                    "steering_angle": round(angle_to_user, 2),
                    "beam_profile": profile,
                    "beamwidth_deg": round(beamwidth, 2),
                })

                user_signals[uid]["connected_towers"].append(t["id"])
                user_signals[uid]["signal_strengths"][str(t["id"])] = round(signal_pct, 1)

            # Primary beam profile
            primary_profile = sim.beam_profile(num_points=361)
            primary_beamwidth = self._compute_beamwidth_deg(sim)

            tower_results.append({
                "id": t["id"],
                "position": {"x": t["position"][0], "y": t["position"][1]},
                "coverage_radius": t["coverage_radius"],
                "parameters": {
                    "num_elements": sim.num_elements,
                    "element_spacing": sim.element_spacing,
                    "frequency": sim.frequency,
                    "steering_angle": round(sim.steering_angle_deg, 2),
                    "window_type": sim.window_type.value,
                    "snr": sim.snr,
                    "power_dbm": power_dbm,
                    "wavelength": sim.wavelength,
                    "beamwidth_deg": round(primary_beamwidth, 2),
                },
                "beam_profile": primary_profile,
                "user_beams": user_beams,
                "connections": connections,
                "num_connected": num_connected,
                "split_penalty_db": round(split_penalty_db, 1),
            })

        return {
            "towers": tower_results,
            "users": [
                {
                    "id": us["id"],
                    "position": {"x": us["position"][0], "y": us["position"][1]},
                    "connected_towers": us["connected_towers"],
                    "signal_strengths": us["signal_strengths"],
                }
                for us in user_signals
            ],

        }

