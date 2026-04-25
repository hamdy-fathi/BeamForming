"""
5G tower connectivity simulator.

3 towers (base stations) with independent phased arrays,
2 mobile users that can be moved via keyboard.
"""

import numpy as np
from core.beamforming import BeamformingSimulator
from core.apodization import WindowType
from core.physics import free_space_path_loss, SPEED_OF_LIGHT


def _angle_between(tower_pos: tuple, user_pos: tuple) -> float:
    """Steering angle (degrees) from tower to user, measured from broadside."""
    dx = user_pos[0] - tower_pos[0]
    dy = user_pos[1] - tower_pos[1]
    angle = np.rad2deg(np.arctan2(dx, dy))  # 0° = north (broadside)
    return np.clip(angle, -89.9, 89.9)


def _distance(a: tuple, b: tuple) -> float:
    return np.sqrt((a[0] - b[0])**2 + (a[1] - b[1])**2)


class FiveGSimulator:
    """
    Manages 3 towers and up to 2 users.

    Each tower auto-adjusts its beamforming parameters based on
    connected user positions.
    """

    FREQUENCY = 28e9          # 28 GHz mmWave
    MEDIUM_SPEED = SPEED_OF_LIGHT

    def __init__(self):
        self.towers: list[dict] = []
        self.users: list[dict] = []

    def setup(self, towers: list[dict], users: list[dict]):
        """Initialise tower and user positions.

        towers: [{position: {x, y}, num_elements, frequency, coverage_radius,
                  element_spacing, window_type, snr}]
        users:  [{x, y}]
        """
        self.towers = []
        for i, t in enumerate(towers):
            pos = (t["position"]["x"], t["position"]["y"])
            sim = BeamformingSimulator(
                num_elements=t.get("num_elements", 32),
                element_spacing=t.get("element_spacing", 0.5),
                frequency=t.get("frequency", self.FREQUENCY),
                steering_angle=0.0,
                snr=t.get("snr", 200),
                window_type=WindowType(t.get("window_type", "hamming")),
                medium_speed=self.MEDIUM_SPEED,
            )
            self.towers.append({
                "id": i,
                "position": pos,
                "coverage_radius": t.get("coverage_radius", 500),
                "simulator": sim,
                "connected_users": [],
            })

        self.users = [{"id": i, "position": (u["x"], u["y"])} for i, u in enumerate(users)]

    def simulate(self) -> dict:
        """Run full simulation and return state for all towers and users."""
        # reset connections
        for t in self.towers:
            t["connected_users"] = []

        user_signals: list[dict] = [{
            "id": u["id"],
            "position": u["position"],
            "connected_towers": [],
            "signal_strengths": {},
        } for u in self.users]

        # ── determine connectivity ──────────────────────────────────────
        for t in self.towers:
            for u in self.users:
                dist = _distance(t["position"], u["position"])
                if dist <= t["coverage_radius"]:
                    t["connected_users"].append(u["id"])

        # ── steer beams ────────────────────────────────────────────────
        tower_results = []
        for t in self.towers:
            sim: BeamformingSimulator = t["simulator"]
            connected = t["connected_users"]

            if len(connected) == 0:
                # no user in range → default broadside
                sim.update_params(steering_angle=0.0)
            elif len(connected) == 1:
                uid = connected[0]
                upos = self.users[uid]["position"]
                angle = _angle_between(t["position"], upos)
                dist = _distance(t["position"], upos)
                # auto-adjust parameters
                sim.update_params(steering_angle=angle)
            else:
                # two users → steer to midpoint (simplified MU-MIMO)
                positions = [self.users[uid]["position"] for uid in connected]
                mid_x = np.mean([p[0] for p in positions])
                mid_y = np.mean([p[1] for p in positions])
                angle = _angle_between(t["position"], (mid_x, mid_y))
                sim.update_params(steering_angle=angle)

            # get beam profile
            profile = sim.beam_profile(num_points=181)

            # compute signal strength to each connected user
            connections = []
            for uid in connected:
                upos = self.users[uid]["position"]
                dist = _distance(t["position"], upos)
                angle = _angle_between(t["position"], upos)
                # simple path loss model
                fspl = free_space_path_loss(max(dist, 1.0), sim.frequency)
                signal_dbm = 30.0 - fspl  # assume 30 dBm transmit
                signal_strength = max(0, min(100, 100 - fspl / 2))
                connections.append({
                    "user_id": uid,
                    "distance": round(dist, 1),
                    "steering_angle": round(angle, 2),
                    "signal_dbm": round(signal_dbm, 1),
                    "signal_strength": round(signal_strength, 1),
                })
                user_signals[uid]["connected_towers"].append(t["id"])
                user_signals[uid]["signal_strengths"][str(t["id"])] = round(signal_strength, 1)

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
                    "wavelength": sim.wavelength,
                },
                "beam_profile": profile,
                "connections": connections,
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
