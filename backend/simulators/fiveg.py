"""
5G tower connectivity simulator — physics-accurate beamforming
with multi-path propagation and obstacle scattering.

Signal model (per path):
  P_path = P_tx + G_array(θ_departure) - FSPL(d_total, f) + reflection_loss
  P_total = 10·log10(Σ 10^(P_path_i / 10))   (incoherent power sum)

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


# ── Ray-Rectangle intersection ───────────────────────────────────────────
def _segment_intersects_rect(p1: tuple, p2: tuple, obs: dict) -> bool:
    """Check if line segment p1→p2 intersects the axis-aligned rectangle."""
    cx, cy = obs["x"], obs["y"]
    hw, hh = obs["width"] / 2, obs["height"] / 2
    x_min, x_max = cx - hw, cx + hw
    y_min, y_max = cy - hh, cy + hh

    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]

    # Parametric clipping (Liang-Barsky)
    p = [-dx, dx, -dy, dy]
    q = [p1[0] - x_min, x_max - p1[0], p1[1] - y_min, y_max - p1[1]]

    t_enter = 0.0
    t_exit = 1.0

    for i in range(4):
        if abs(p[i]) < 1e-10:
            if q[i] < 0:
                return False  # parallel and outside
        else:
            t = q[i] / p[i]
            if p[i] < 0:
                t_enter = max(t_enter, t)
            else:
                t_exit = min(t_exit, t)
            if t_enter > t_exit:
                return False

    return t_enter <= t_exit


def _is_los_blocked(p1: tuple, p2: tuple, obstacles: list[dict]) -> bool:
    """Check if any obstacle blocks the line-of-sight from p1 to p2."""
    for obs in obstacles:
        if _segment_intersects_rect(p1, p2, obs):
            return True
    return False


# ── Single-bounce specular reflection ────────────────────────────────────
def _reflect_point_on_segment(p: tuple, seg_start: tuple, seg_end: tuple) -> tuple | None:
    """Reflect point p across the line defined by seg_start→seg_end.
    Returns the mirror point, or None if the segment is degenerate.
    """
    sx, sy = seg_start
    ex, ey = seg_end
    dx, dy = ex - sx, ey - sy
    len_sq = dx * dx + dy * dy
    if len_sq < 1e-10:
        return None
    t = ((p[0] - sx) * dx + (p[1] - sy) * dy) / len_sq
    # Foot of perpendicular
    fx = sx + t * dx
    fy = sy + t * dy
    # Mirror
    return (2 * fx - p[0], 2 * fy - p[1])


def _find_reflection_paths(tower_pos: tuple, user_pos: tuple,
                            obstacles: list[dict]) -> list[dict]:
    """Find single-bounce specular reflection paths off obstacle edges.

    For each of the 4 edges of each obstacle:
      1. Mirror the user across the edge
      2. Check if tower→mirror line intersects the edge (reflection point exists)
      3. Check if neither leg is blocked by other obstacles
      4. If valid, record the reflection path

    Returns list of {via, total_distance, angle_at_tower, reflection_loss_db, obstacle_id}
    """
    paths = []

    for obs in obstacles:
        cx, cy = obs["x"], obs["y"]
        hw, hh = obs["width"] / 2, obs["height"] / 2
        refl_loss = obs.get("reflection_loss_db", 6.0)

        # 4 edges: top, bottom, left, right
        edges = [
            ((cx - hw, cy - hh), (cx + hw, cy - hh)),  # top edge
            ((cx - hw, cy + hh), (cx + hw, cy + hh)),  # bottom edge
            ((cx - hw, cy - hh), (cx - hw, cy + hh)),  # left edge
            ((cx + hw, cy - hh), (cx + hw, cy + hh)),  # right edge
        ]

        for seg_start, seg_end in edges:
            # Mirror user across this edge
            mirror = _reflect_point_on_segment(user_pos, seg_start, seg_end)
            if mirror is None:
                continue

            # Find where tower→mirror intersects the edge line
            # The reflection point is the intersection of tower→mirror with the edge
            tx, ty = tower_pos
            mx, my = mirror

            dx_tm = mx - tx
            dy_tm = my - ty

            # Parametric intersection with the edge segment
            ex, ey = seg_start
            edx = seg_end[0] - ex
            edy = seg_end[1] - ey

            denom = dx_tm * edy - dy_tm * edx
            if abs(denom) < 1e-10:
                continue  # parallel

            t_ray = ((ex - tx) * edy - (ey - ty) * edx) / denom
            t_edge = ((ex - tx) * dy_tm - (ey - ty) * dx_tm) / denom

            if t_ray < 0.01 or t_edge < 0 or t_edge > 1:
                continue  # reflection point not on edge or behind tower

            # Reflection point
            rx = tx + t_ray * dx_tm
            ry = ty + t_ray * dy_tm
            refl_point = (rx, ry)

            # Check neither leg is blocked by OTHER obstacles
            other_obs = [o for o in obstacles if o["id"] != obs["id"]]
            if _is_los_blocked(tower_pos, refl_point, other_obs):
                continue
            if _is_los_blocked(refl_point, user_pos, other_obs):
                continue

            # Also check the reflection point → user isn't blocked by THIS obstacle
            # Use a generous offset (5 sim units) to avoid edge-touching false positives
            offset_start = (
                refl_point[0] + (user_pos[0] - refl_point[0]) * 0.05,
                refl_point[1] + (user_pos[1] - refl_point[1]) * 0.05,
            )
            if _segment_intersects_rect(offset_start, user_pos, obs):
                continue

            # Valid reflection path
            d1 = _distance(tower_pos, refl_point)
            d2 = _distance(refl_point, user_pos)
            total_dist = d1 + d2
            angle_at_tower = _canvas_angle_to_user(tower_pos, refl_point)

            paths.append({
                "via": refl_point,
                "total_distance": total_dist,
                "angle_at_tower": angle_at_tower,
                "reflection_loss_db": refl_loss,
                "obstacle_id": obs["id"],
            })

    return paths


def _find_diffraction_paths(tower_pos: tuple, user_pos: tuple,
                             obstacles: list[dict]) -> list[dict]:
    """Find knife-edge diffraction paths around obstacle corners.

    When LOS is blocked, the signal can bend around obstacle corners.
    For each corner of each obstacle:
      1. Offset the corner slightly outward (to clear the obstacle surface)
      2. Check if tower→corner and corner→user are both clear
      3. If valid, record the diffraction path with loss penalty

    Returns list of {via, total_distance, angle_at_tower, reflection_loss_db, obstacle_id}
    """
    paths = []
    CORNER_OFFSET = 5.0  # offset from corner to clear the surface

    for obs in obstacles:
        cx, cy = obs["x"], obs["y"]
        hw, hh = obs["width"] / 2, obs["height"] / 2
        diff_loss = obs.get("reflection_loss_db", 6.0)  # reuse reflection loss

        # 4 corners with slight outward offset to clear the obstacle body
        corners = [
            (cx - hw - CORNER_OFFSET, cy - hh - CORNER_OFFSET),  # top-left
            (cx + hw + CORNER_OFFSET, cy - hh - CORNER_OFFSET),  # top-right
            (cx - hw - CORNER_OFFSET, cy + hh + CORNER_OFFSET),  # bottom-left
            (cx + hw + CORNER_OFFSET, cy + hh + CORNER_OFFSET),  # bottom-right
        ]

        for corner in corners:
            # Check if tower→corner is clear of ALL obstacles
            if _is_los_blocked(tower_pos, corner, obstacles):
                continue
            # Check if corner→user is clear of ALL obstacles
            if _is_los_blocked(corner, user_pos, obstacles):
                continue

            d1 = _distance(tower_pos, corner)
            d2 = _distance(corner, user_pos)
            total_dist = d1 + d2
            angle_at_tower = _canvas_angle_to_user(tower_pos, corner)

            paths.append({
                "via": corner,
                "total_distance": total_dist,
                "angle_at_tower": angle_at_tower,
                "reflection_loss_db": diff_loss,
                "obstacle_id": obs["id"],
            })

    # Return only the best 2 diffraction paths (shortest total distance)
    paths.sort(key=lambda p: p["total_distance"])
    return paths[:2]


class FiveGSimulator:
    """
    3 towers, 2 users, up to 5 obstacles.

    Physics:
    - Each tower has a ULA phased array with user-controlled steering
    - Direct (LOS) and reflected (NLOS) signal paths
    - Signal per path = Ptx + G(θ) - FSPL(d, f) - reflection_loss
    - Multi-path: incoherent power sum of all paths
    - Connectivity requires: within coverage radius AND total signal > -100 dBm
    """

    MEDIUM_SPEED = SPEED_OF_LIGHT

    def __init__(self):
        self.towers: list[dict] = []
        self.users: list[dict] = []
        self.obstacles: list[dict] = []

    def setup(self, towers: list[dict], users: list[dict],
              obstacles: list[dict] | None = None):
        self.towers = []
        for i, t in enumerate(towers):
            pos = (t["position"]["x"], t["position"]["y"])
            freq = t.get("frequency", 28e9)
            power_dbm = t.get("power_dbm", 30.0)
            steering_angle = t.get("steering_angle", 0.0)
            snr = t.get("snr", 1000)
            window_type_str = t.get("window_type", "hamming")
            kaiser_beta = t.get("kaiser_beta", 6.0)

            sim = BeamformingSimulator(
                num_elements=t.get("num_elements", 32),
                element_spacing=t.get("element_spacing", 0.5),
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
        self.obstacles = obstacles or []

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

    def _compute_multipath_signal(self, sim, power_dbm, tower_pos, user_pos):
        """Compute signal via all available paths (LOS + NLOS reflections).

        Returns (total_signal_dbm, paths_info_list)
        """
        freq = sim.frequency
        paths_info = []
        path_powers_linear = []

        # ── Direct path (LOS) ──
        los_blocked = _is_los_blocked(tower_pos, user_pos, self.obstacles)
        dist = _distance(tower_pos, user_pos)
        angle_to_user = _canvas_angle_to_user(tower_pos, user_pos)

        if not los_blocked:
            array_gain = self._peak_gain_db(sim)
            fspl = free_space_path_loss(max(dist, 1.0), freq)
            signal_dbm = power_dbm + array_gain - fspl
            path_powers_linear.append(10 ** (signal_dbm / 10))
            paths_info.append({
                "type": "LOS",
                "from": tower_pos,
                "to": user_pos,
                "via": None,
                "distance": round(dist, 1),
                "signal_dbm": round(signal_dbm, 1),
                "array_gain_db": round(array_gain, 1),
                "fspl_db": round(free_space_path_loss(max(dist, 1.0), freq), 1),
                "reflection_loss_db": 0,
            })

        # ── Reflection paths (NLOS) ──
        refl_paths = _find_reflection_paths(tower_pos, user_pos, self.obstacles)
        for rp in refl_paths:
            angle_at_tower = rp["angle_at_tower"]
            array_gain = self._peak_gain_db(sim)
            fspl = free_space_path_loss(max(rp["total_distance"], 1.0), freq)
            signal_dbm = power_dbm + array_gain - fspl - rp["reflection_loss_db"]
            path_powers_linear.append(10 ** (signal_dbm / 10))
            paths_info.append({
                "type": "NLOS",
                "from": tower_pos,
                "to": user_pos,
                "via": {"x": round(rp["via"][0], 1), "y": round(rp["via"][1], 1)},
                "distance": round(rp["total_distance"], 1),
                "signal_dbm": round(signal_dbm, 1),
                "array_gain_db": round(array_gain, 1),
                "fspl_db": round(fspl, 1),
                "reflection_loss_db": round(rp["reflection_loss_db"], 1),
                "obstacle_id": rp["obstacle_id"],
            })

        # ── Diffraction paths (around corners) ──
        diff_paths = _find_diffraction_paths(tower_pos, user_pos, self.obstacles)
        for dp in diff_paths:
            angle_at_tower = dp["angle_at_tower"]
            array_gain = self._peak_gain_db(sim)
            fspl = free_space_path_loss(max(dp["total_distance"], 1.0), freq)
            signal_dbm = power_dbm + array_gain - fspl - dp["reflection_loss_db"]
            path_powers_linear.append(10 ** (signal_dbm / 10))
            paths_info.append({
                "type": "NLOS",
                "from": tower_pos,
                "to": user_pos,
                "via": {"x": round(dp["via"][0], 1), "y": round(dp["via"][1], 1)},
                "distance": round(dp["total_distance"], 1),
                "signal_dbm": round(signal_dbm, 1),
                "array_gain_db": round(array_gain, 1),
                "fspl_db": round(fspl, 1),
                "reflection_loss_db": round(dp["reflection_loss_db"], 1),
                "obstacle_id": dp["obstacle_id"],
            })

        # ── Total received power (incoherent sum) ──
        if path_powers_linear:
            total_linear = sum(path_powers_linear)
            total_dbm = 10 * np.log10(total_linear + 1e-30)
        else:
            total_dbm = -200  # no path at all

        return total_dbm, paths_info, los_blocked

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

                total_signal, _, _ = self._compute_multipath_signal(
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

                # Multi-path signal computation
                total_signal, paths_info, los_blocked = self._compute_multipath_signal(
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
                    "los_blocked": los_blocked,
                    "paths": paths_info,
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
            "obstacles": self.obstacles,
        }

