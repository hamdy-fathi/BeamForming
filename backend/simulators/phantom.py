"""
Shepp–Logan phantom with acoustic tissue properties for ultrasound simulation.

The standard 10-ellipse model mapped to realistic tissue parameters:
  speed of sound, density, acoustic impedance, attenuation coefficient.
"""

import numpy as np
from dataclasses import dataclass, field


@dataclass
class Ellipse:
    """One ellipse in the Shepp–Logan phantom."""
    id: int
    name: str
    center_x: float
    center_y: float
    semi_a: float          # horizontal semi-axis
    semi_b: float          # vertical semi-axis
    theta_deg: float       # rotation angle [deg]
    gray_level: float      # original CT attenuation
    # acoustic properties
    tissue_name: str = ""
    speed: float = 1540.0         # m/s
    density: float = 1040.0       # kg/m³
    attenuation: float = 0.6      # dB/(cm·MHz)

    @property
    def impedance(self) -> float:
        """Acoustic impedance Z = ρ·c  [MRayl]."""
        return self.density * self.speed / 1e6

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "center_x": self.center_x,
            "center_y": self.center_y,
            "semi_a": self.semi_a,
            "semi_b": self.semi_b,
            "theta_deg": self.theta_deg,
            "gray_level": self.gray_level,
            "tissue_name": self.tissue_name,
            "speed": self.speed,
            "density": self.density,
            "impedance": round(self.impedance, 3),
            "attenuation": self.attenuation,
        }


# ── Standard definition ─────────────────────────────────────────────────
# Phantom sits in a coordinate system from roughly (-1, -1) to (1, 1).
# Physical scale: 1 unit ≈ 10 cm  →  phantom diameter ≈ 18.4 cm.

SHEPP_LOGAN_ELLIPSES: list[Ellipse] = [
    Ellipse(0, "Outer skull",    0.0,    0.0,     0.69,  0.92,    0,   2.0,
            "Skull bone",       4080, 1912,  20.0),
    Ellipse(1, "Brain",          0.0,   -0.0184,  0.6624, 0.874,  0,  -0.98,
            "Brain tissue",     1560, 1040,   0.6),
    Ellipse(2, "Right ventricle", 0.22,  0.0,     0.11,  0.31,  -18,  -0.02,
            "White matter",     1552, 1043,   0.7),
    Ellipse(3, "Left ventricle", -0.22,  0.0,     0.16,  0.41,   18,  -0.02,
            "Gray matter",      1541, 1038,   0.6),
    Ellipse(4, "Top structure",   0.0,   0.35,    0.21,  0.25,    0,   0.01,
            "CSF fluid",        1515, 1007,   0.002),
    Ellipse(5, "Small lesion A",  0.0,   0.1,     0.046, 0.046,   0,   0.01,
            "Tumor / lesion",   1580, 1060,   1.0),
    Ellipse(6, "Small lesion B",  0.0,  -0.1,     0.046, 0.046,   0,   0.01,
            "Tumor / lesion",   1580, 1060,   1.0),
    Ellipse(7, "Small lesion C", -0.08, -0.605,   0.046, 0.023,   0,   0.01,
            "Tumor / lesion",   1580, 1060,   1.0),
    Ellipse(8, "Small lesion D",  0.0,  -0.605,   0.023, 0.023,   0,   0.01,
            "Tumor / lesion",   1580, 1060,   1.0),
    Ellipse(9, "Small lesion E",  0.06, -0.605,   0.023, 0.046,   0,   0.01,
            "Tumor / lesion",   1580, 1060,   1.0),
]


class PhantomModel:
    """Shepp–Logan phantom with per-ellipse acoustic properties."""

    # Background medium (water / coupling gel)
    BG_SPEED = 1480.0
    BG_DENSITY = 1000.0
    BG_ATTENUATION = 0.002
    SCALE = 0.1  # 1 phantom-unit = 10 cm

    def __init__(self):
        self.ellipses = [Ellipse(**e.__dict__) for e in SHEPP_LOGAN_ELLIPSES]

    def update_tissue(self, eid: int, speed: float | None = None,
                      density: float | None = None, attenuation: float | None = None,
                      tissue_name: str | None = None):
        """Update properties of a single ellipse."""
        e = self.ellipses[eid]
        if speed is not None:
            e.speed = speed
        if density is not None:
            e.density = density
        if attenuation is not None:
            e.attenuation = attenuation
        if tissue_name is not None:
            e.tissue_name = tissue_name

    # ── Image generation ────────────────────────────────────────────────
    def generate_image(self, size: int = 256) -> np.ndarray:
        """Produce the Shepp–Logan intensity image (2-D float array)."""
        img = np.zeros((size, size), dtype=float)
        x = np.linspace(-1, 1, size)
        y = np.linspace(-1, 1, size)
        X, Y = np.meshgrid(x, y)

        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            cos_t, sin_t = np.cos(theta), np.sin(theta)
            Xr = cos_t * (X - e.center_x) + sin_t * (Y - e.center_y)
            Yr = -sin_t * (X - e.center_x) + cos_t * (Y - e.center_y)
            mask = (Xr / e.semi_a) ** 2 + (Yr / e.semi_b) ** 2 <= 1.0
            img[mask] += e.gray_level

        return img

    def generate_impedance_map(self, size: int = 256) -> np.ndarray:
        """Produce an acoustic impedance map for US simulation."""
        zmap = np.full((size, size), self.BG_DENSITY * self.BG_SPEED / 1e6)
        x = np.linspace(-1, 1, size)
        y = np.linspace(-1, 1, size)
        X, Y = np.meshgrid(x, y)

        for e in self.ellipses:
            theta = np.deg2rad(e.theta_deg)
            cos_t, sin_t = np.cos(theta), np.sin(theta)
            Xr = cos_t * (X - e.center_x) + sin_t * (Y - e.center_y)
            Yr = -sin_t * (X - e.center_x) + cos_t * (Y - e.center_y)
            mask = (Xr / e.semi_a) ** 2 + (Yr / e.semi_b) ** 2 <= 1.0
            zmap[mask] = e.impedance

        return zmap

    def point_tissue(self, px: float, py: float) -> Ellipse | None:
        """Return the innermost ellipse containing (px, py), or None."""
        # check from smallest (last) to largest (first) — inner wins
        for e in reversed(self.ellipses):
            theta = np.deg2rad(e.theta_deg)
            cos_t, sin_t = np.cos(theta), np.sin(theta)
            xr = cos_t * (px - e.center_x) + sin_t * (py - e.center_y)
            yr = -sin_t * (px - e.center_x) + cos_t * (py - e.center_y)
            if (xr / e.semi_a) ** 2 + (yr / e.semi_b) ** 2 <= 1.0:
                return e
        return None

    def ray_intersections(self, origin: tuple[float, float], angle_deg: float,
                          max_depth: float = 2.0, num_samples: int = 500) -> list[dict]:
        """Cast a ray from *origin* at *angle_deg* and find all tissue boundaries.

        Returns list of {depth, tissue_entering, impedance_before, impedance_after,
                         reflection_coeff, attenuation_at_depth}.
        """
        angle = np.deg2rad(angle_deg)
        dx = np.sin(angle)
        dy = -np.cos(angle)  # "down" into phantom from surface

        depths = np.linspace(0, max_depth, num_samples)
        results = []
        prev_tissue = None

        for d in depths:
            px = origin[0] + dx * d
            py = origin[1] + dy * d
            tissue = self.point_tissue(px, py)

            if tissue is not prev_tissue:
                z_before = (prev_tissue.impedance if prev_tissue
                            else self.BG_DENSITY * self.BG_SPEED / 1e6)
                z_after = (tissue.impedance if tissue
                           else self.BG_DENSITY * self.BG_SPEED / 1e6)
                r = (z_after - z_before) / (z_after + z_before + 1e-30)
                results.append({
                    "depth": round(d * self.SCALE, 6),  # in metres
                    "depth_phantom": round(d, 6),
                    "tissue_before": prev_tissue.tissue_name if prev_tissue else "Water/Gel",
                    "tissue_after": tissue.tissue_name if tissue else "Water/Gel",
                    "impedance_before": round(z_before, 4),
                    "impedance_after": round(z_after, 4),
                    "reflection_coeff": round(abs(r), 6),
                    "x": round(px, 4),
                    "y": round(py, 4),
                })
                prev_tissue = tissue

        return results

    def to_dict(self) -> dict:
        return {
            "ellipses": [e.to_dict() for e in self.ellipses],
            "background": {
                "speed": self.BG_SPEED,
                "density": self.BG_DENSITY,
                "impedance": round(self.BG_DENSITY * self.BG_SPEED / 1e6, 3),
                "attenuation": self.BG_ATTENUATION,
            },
            "scale": self.SCALE,
        }
