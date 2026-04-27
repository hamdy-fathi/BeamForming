"""
Shepp-Logan phantom with acoustic tissue properties for ultrasound simulation.

Standard 10-ellipse model mapped to realistic tissue parameters:
  speed of sound, density, acoustic impedance, attenuation coefficient.

Probe is constrained to the outer-ellipse boundary.
A dedicated blood vessel ellipse (#10) carries a velocity vector (vx, vy).
"""

import numpy as np
from dataclasses import dataclass, field


@dataclass
class Ellipse:
    """One ellipse in the Shepp-Logan phantom."""
    id: int
    name: str
    center_x: float
    center_y: float
    semi_a: float           # horizontal semi-axis
    semi_b: float           # vertical semi-axis
    theta_deg: float        # rotation angle [deg]
    gray_level: float       # original CT value
    # acoustic properties
    tissue_name: str = ""
    speed: float = 1540.0        # m/s
    density: float = 1040.0      # kg/m³
    attenuation: float = 0.6     # dB/(cm·MHz)
    # velocity (only used for blood vessel)
    vx: float = 0.0              # m/s
    vy: float = 0.0              # m/s

    @property
    def impedance(self) -> float:
        """Acoustic impedance Z = ρ·c  [MRayl]."""
        return self.density * self.speed / 1e6

    def to_dict(self) -> dict:
        return {
            "id":           self.id,
            "name":         self.name,
            "center_x":     self.center_x,
            "center_y":     self.center_y,
            "semi_a":       self.semi_a,
            "semi_b":       self.semi_b,
            "theta_deg":    self.theta_deg,
            "gray_level":   self.gray_level,
            "tissue_name":  self.tissue_name,
            "speed":        self.speed,
            "density":      self.density,
            "impedance":    round(self.impedance, 4),
            "attenuation":  self.attenuation,
            "vx":           self.vx,
            "vy":           self.vy,
        }


# ── Standard Shepp-Logan definition ─────────────────────────────────────────
# Phantom coordinate system: roughly (-1, -1) to (1, 1).
# Physical scale: 1 unit ≈ 10 cm  →  phantom diameter ≈ 18.4 cm.

_SL: list[dict] = [
    # id              name                  cx                cy                a             b             θ           gray                tissue_name                 c            ρ             α
    dict(id=0, name="Outer skull",      center_x=0.0,   center_y=0.0,     semi_a=0.69,  semi_b=0.92,  theta_deg=0,   gray_level=2.0,  tissue_name="Skull bone",    speed=3500, density=1900, attenuation=3.0),
    dict(id=1, name="Brain",            center_x=0.0,   center_y=-0.0184, semi_a=0.6624,semi_b=0.874, theta_deg=0,   gray_level=-0.98,tissue_name="Brain tissue",  speed=1560, density=1040, attenuation=0.1),
    dict(id=2, name="Right ventricle",  center_x=0.22,  center_y=0.0,     semi_a=0.11,  semi_b=0.31,  theta_deg=-18, gray_level=-0.02,tissue_name="White matter",  speed=1552, density=1043, attenuation=0.15),
    dict(id=3, name="Left ventricle",   center_x=-0.22, center_y=0.0,     semi_a=0.16,  semi_b=0.41,  theta_deg=18,  gray_level=-0.02,tissue_name="Gray matter",   speed=1541, density=1038, attenuation=0.1),
    dict(id=4, name="Top structure",    center_x=0.0,   center_y=0.35,    semi_a=0.21,  semi_b=0.25,  theta_deg=0,   gray_level=0.01, tissue_name="CSF fluid",     speed=1515, density=1007, attenuation=0.002),
    dict(id=5, name="Small lesion A",   center_x=0.0,   center_y=0.1,     semi_a=0.046, semi_b=0.046, theta_deg=0,   gray_level=0.01, tissue_name="Tumor/lesion",  speed=1580, density=1060, attenuation=1.0),
    dict(id=6, name="Small lesion B",   center_x=0.0,   center_y=-0.1,    semi_a=0.046, semi_b=0.046, theta_deg=0,   gray_level=0.01, tissue_name="Tumor/lesion",  speed=1580, density=1060, attenuation=1.0),
    dict(id=7, name="Small lesion C",   center_x=-0.08, center_y=-0.605,  semi_a=0.046, semi_b=0.023, theta_deg=0,   gray_level=0.01, tissue_name="Tumor/lesion",  speed=1580, density=1060, attenuation=1.0),
    dict(id=8, name="Small lesion D",   center_x=0.0,   center_y=-0.605,  semi_a=0.023, semi_b=0.023, theta_deg=0,   gray_level=0.01, tissue_name="Tumor/lesion",  speed=1580, density=1060, attenuation=1.0),
    dict(id=9, name="Small lesion E",   center_x=0.06,  center_y=-0.605,  semi_a=0.023, semi_b=0.046, theta_deg=0,   gray_level=0.01, tissue_name="Tumor/lesion",  speed=1580, density=1060, attenuation=1.0),
    # Blood vessel (id=10) — lower-left region, visible but inside brain
    dict(id=10, name="Blood vessel",    center_x=-0.3,  center_y=-0.2,    semi_a=0.06,  semi_b=0.025, theta_deg=30,  gray_level=0.02, tissue_name="Blood",         speed=1575, density=1055, attenuation=0.2, vx=0.3, vy=0.0),
]

SHEPP_LOGAN_ELLIPSES: list[Ellipse] = [Ellipse(**d) for d in _SL]


class PhantomModel:
    """Shepp-Logan phantom with per-ellipse acoustic properties."""

    # Background medium (water / coupling gel)
    BG_SPEED      = 1480.0
    BG_DENSITY    = 1000.0
    BG_ATTENUATION = 0.002
    SCALE         = 0.1    # 1 phantom-unit = 10 cm → 0.1 m

    def __init__(self):
        import copy
        self.ellipses: list[Ellipse] = [copy.copy(e) for e in SHEPP_LOGAN_ELLIPSES]

    # ── Property update ──────────────────────────────────────────────────
    def update_tissue(self, eid: int,
                      speed: float | None = None,
                      density: float | None = None,
                      attenuation: float | None = None,
                      tissue_name: str | None = None,
                      impedance: float | None = None):
        """Update acoustic properties of a single ellipse."""
        e = self.ellipses[eid]
        if speed       is not None: e.speed       = speed
        if density     is not None: e.density     = density
        if attenuation is not None: e.attenuation = attenuation
        if tissue_name is not None: e.tissue_name = tissue_name
        # Impedance is a derived quantity Z = ρ·c  [MRayl].
        # When the user explicitly sets Z, back-calculate density so that
        # Z_new = e.density × e.speed / 1e6.  Speed is kept unchanged.
        # This MUST run after the speed update (if any) so ρ = Z/c is correct.
        if impedance is not None:
            e.density = max(1.0, impedance * 1e6 / e.speed)

    def update_geometry(self, eid: int,
                        center_x: float | None = None,
                        center_y: float | None = None,
                        semi_a:   float | None = None,
                        semi_b:   float | None = None,
                        theta_deg: float | None = None):
        """Update geometric parameters of a single ellipse."""
        e = self.ellipses[eid]
        if center_x  is not None: e.center_x  = center_x
        if center_y  is not None: e.center_y  = center_y
        if semi_a    is not None: e.semi_a    = semi_a
        if semi_b    is not None: e.semi_b    = semi_b
        if theta_deg is not None: e.theta_deg = theta_deg

    def update_vessel(self, vx: float | None = None, vy: float | None = None,
                      center_x: float | None = None, center_y: float | None = None,
                      semi_a: float | None = None, semi_b: float | None = None,
                      theta_deg: float | None = None):
        """Update velocity and/or geometry of the blood vessel ellipse (id=10)."""
        vessel = self.ellipses[10]
        if vx       is not None: vessel.vx       = vx
        if vy       is not None: vessel.vy       = vy
        if center_x is not None: vessel.center_x = center_x
        if center_y is not None: vessel.center_y = center_y
        if semi_a   is not None: vessel.semi_a   = semi_a
        if semi_b   is not None: vessel.semi_b   = semi_b
        if theta_deg is not None: vessel.theta_deg = theta_deg

    # ── Image generation ─────────────────────────────────────────────────
    def generate_image(self, size: int = 256) -> np.ndarray:
        """Produce Shepp-Logan intensity image (2-D float array, CT values)."""
        img = np.zeros((size, size), dtype=float)
        x = np.linspace(-1, 1, size)
        y = np.linspace(-1, 1, size)
        X, Y = np.meshgrid(x, y)
        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            ct, st = np.cos(theta), np.sin(theta)
            Xr =  ct * (X - e.center_x) + st * (Y - e.center_y)
            Yr = -st * (X - e.center_x) + ct * (Y - e.center_y)
            mask = (Xr / e.semi_a) ** 2 + (Yr / e.semi_b) ** 2 <= 1.0
            img[mask] += e.gray_level
        return img

    def generate_impedance_map(self, size: int = 256) -> np.ndarray:
        """Produce an acoustic impedance map [MRayl] for visualization."""
        zmap = np.full((size, size), self.BG_DENSITY * self.BG_SPEED / 1e6)
        x = np.linspace(-1, 1, size)
        y = np.linspace(-1, 1, size)
        X, Y = np.meshgrid(x, y)
        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            ct, st = np.cos(theta), np.sin(theta)
            Xr =  ct * (X - e.center_x) + st * (Y - e.center_y)
            Yr = -st * (X - e.center_x) + ct * (Y - e.center_y)
            mask = (Xr / e.semi_a) ** 2 + (Yr / e.semi_b) ** 2 <= 1.0
            zmap[mask] = e.impedance
        return zmap

    # ── Point query ──────────────────────────────────────────────────────
    def point_tissue(self, px: float, py: float) -> Ellipse | None:
        """Return the innermost (highest-id) ellipse containing (px, py), or None."""
        result = None
        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            ct, st = np.cos(theta), np.sin(theta)
            xr =  ct * (px - e.center_x) + st * (py - e.center_y)
            yr = -st * (px - e.center_x) + ct * (py - e.center_y)
            if (xr / e.semi_a) ** 2 + (yr / e.semi_b) ** 2 <= 1.0:
                result = e  # last (highest id) wins
        return result

    # ── Ray intersection ─────────────────────────────────────────────────
    def ray_intersections(
        self,
        origin: tuple[float, float],
        direction: tuple[float, float],
        max_depth: float = 2.0,
    ) -> list[dict]:
        """Cast a ray from *origin* in *direction* (world-space unit vector).

        Each entry:
          depth           – one-way distance in **metres** (SCALE applied)
          depth_phantom   – distance in phantom units
          tissue_before / tissue_after  – tissue_name strings
          impedance_before / impedance_after – MRayl
          reflection_coeff  – |R_amplitude| = |(Z2-Z1)/(Z2+Z1)|
          transmission_factor – energy fraction that continues = 1 - R²  (power)
          x, y            – intersection point in phantom coords
        """
        dx, dy = direction[0], direction[1]
        # Normalise direction (safety)
        dnorm = np.sqrt(dx*dx + dy*dy) + 1e-12
        dx /= dnorm; dy /= dnorm

        raw: list[dict] = []

        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            ct, st = np.cos(theta), np.sin(theta)

            # Origin relative to ellipse centre, rotated into ellipse frame
            ox = origin[0] - e.center_x
            oy = origin[1] - e.center_y
            ox_r =  ct * ox + st * oy
            oy_r = -st * ox + ct * oy

            dx_r =  ct * dx + st * dy
            dy_r = -st * dx + ct * dy

            # Scale to unit circle
            v0x = ox_r / e.semi_a;  v0y = oy_r / e.semi_b
            vdx = dx_r / e.semi_a;  vdy = dy_r / e.semi_b

            A = vdx*vdx + vdy*vdy
            B = v0x*vdx + v0y*vdy
            C = v0x*v0x + v0y*v0y - 1.0

            if A < 1e-12:
                continue

            disc = B*B - A*C
            if disc > 0:
                sq = np.sqrt(disc)
                for t in ((-B - sq) / A, (-B + sq) / A):
                    if 1e-6 < t < max_depth:
                        raw.append({"t": t, "ellipse": e,
                                    "type": "enter" if t == (-B - sq) / A else "exit"})

        raw.sort(key=lambda r: r["t"])

        # ── Walk through events to find tissue-change boundaries ──────────
        active: list[Ellipse] = []

        # Seed: which ellipses contain the origin?
        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            ct, st = np.cos(theta), np.sin(theta)
            xr =  ct * (origin[0] - e.center_x) + st * (origin[1] - e.center_y)
            yr = -st * (origin[0] - e.center_x) + ct * (origin[1] - e.center_y)
            if (xr / e.semi_a) ** 2 + (yr / e.semi_b) ** 2 <= 1.0:
                active.append(e)

        def dominant(lst: list[Ellipse]) -> Ellipse | None:
            return max(lst, key=lambda e: e.id) if lst else None

        prev_tissue = dominant(active)
        results: list[dict] = []

        for i, ev in enumerate(raw):
            e = ev["ellipse"]
            if ev["type"] == "enter":
                if e not in active:
                    active.append(e)
            else:
                if e in active:
                    active.remove(e)

            cur_tissue = dominant(active)
            if cur_tissue is prev_tissue:
                continue

            # Skip near-duplicate depths (tangent-point artefacts)
            if i + 1 < len(raw) and abs(raw[i + 1]["t"] - ev["t"]) < 1e-6:
                continue

            z1 = (prev_tissue.impedance if prev_tissue
                  else self.BG_DENSITY * self.BG_SPEED / 1e6)
            z2 = (cur_tissue.impedance  if cur_tissue
                  else self.BG_DENSITY * self.BG_SPEED / 1e6)

            r_amp = (z2 - z1) / (z2 + z1 + 1e-30)
            r_pow = r_amp ** 2          # intensity reflection
            t_pow = 1.0 - r_pow         # intensity transmission

            xp = origin[0] + dx * ev["t"]
            yp = origin[1] + dy * ev["t"]

            results.append({
                "depth":             round(ev["t"] * self.SCALE, 6),   # metres
                "depth_phantom":     round(ev["t"], 6),
                "tissue_before":     prev_tissue.tissue_name if prev_tissue else "Water/Gel",
                "tissue_after":      cur_tissue.tissue_name  if cur_tissue  else "Water/Gel",
                "impedance_before":  round(z1, 4),
                "impedance_after":   round(z2, 4),
                "reflection_coeff":  round(abs(r_amp), 6),
                "reflection_power":  round(r_pow, 6),
                "transmission_factor": round(t_pow, 6),
                "x":                 round(xp, 4),
                "y":                 round(yp, 4),
            })
            prev_tissue = cur_tissue

        return results

    def to_dict(self) -> dict:
        return {
            "ellipses":   [e.to_dict() for e in self.ellipses],
            "background": {
                "speed":      self.BG_SPEED,
                "density":    self.BG_DENSITY,
                "impedance":  round(self.BG_DENSITY * self.BG_SPEED / 1e6, 4),
                "attenuation": self.BG_ATTENUATION,
            },
            "scale": self.SCALE,
        }
