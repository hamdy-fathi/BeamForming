"""
Ultrasound (A-mode, B-mode, Doppler) API router.
"""

from fastapi import APIRouter
from models.schemas import (
    AModeRequest,
    BModeRequest,
    DopplerRequest,
    TissueProperties,
    EllipseGeometryUpdate,
    VesselUpdate,
)
from simulators.ultrasound import UltrasoundSimulator

router = APIRouter(prefix="/api/ultrasound", tags=["Ultrasound"])

_sim = UltrasoundSimulator()


# ── Phantom ──────────────────────────────────────────────────────────────
@router.get("/phantom")
async def get_phantom():
    """Return the Shepp-Logan phantom definition with acoustic properties."""
    phantom_data = _sim.phantom.to_dict()
    img = _sim.phantom.generate_image(size=256)
    phantom_data["image"] = img.tolist()
    return phantom_data


@router.put("/phantom/tissue")
async def update_tissue(req: TissueProperties):
    """Update acoustic properties for a specific phantom ellipse."""
    _sim.phantom.update_tissue(
        eid=req.ellipse_id,
        speed=req.speed,
        density=req.density,
        attenuation=req.attenuation,
        tissue_name=req.tissue_name or None,
        impedance=req.impedance,
    )
    return {
        "status":  "updated",
        "ellipse": _sim.phantom.ellipses[req.ellipse_id].to_dict(),
    }


@router.put("/phantom/geometry")
async def update_geometry(req: EllipseGeometryUpdate):
    """Update geometric parameters (centre, axes, rotation) of a phantom ellipse."""
    _sim.phantom.update_geometry(
        eid=req.ellipse_id,
        center_x=req.center_x,
        center_y=req.center_y,
        semi_a=req.semi_a,
        semi_b=req.semi_b,
        theta_deg=req.theta_deg,
    )
    return {
        "status":  "updated",
        "ellipse": _sim.phantom.ellipses[req.ellipse_id].to_dict(),
    }


@router.put("/phantom/vessel")
async def update_vessel(req: VesselUpdate):
    """Update blood vessel velocity vector and/or geometry (ellipse id=10)."""
    _sim.phantom.update_vessel(
        vx=req.vx,
        vy=req.vy,
        center_x=req.center_x,
        center_y=req.center_y,
        semi_a=req.semi_a,
        semi_b=req.semi_b,
        theta_deg=req.theta_deg,
    )
    return {
        "status": "updated",
        "vessel": _sim.phantom.ellipses[10].to_dict(),
    }


# ── Scans ─────────────────────────────────────────────────────────────────
@router.post("/a-mode")
async def a_mode_scan(req: AModeRequest):
    """Compute A-mode scanline from probe position into phantom."""
    return _sim.a_mode(
        probe_x=req.probe_x,
        probe_y=req.probe_y,
        beam_angle=req.beam_angle,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )


@router.post("/b-mode")
async def b_mode_scan(req: BModeRequest):
    """Generate B-mode image by sweeping beam angle from probe position."""
    return _sim.b_mode(
        probe_x=req.probe_x,
        probe_y=req.probe_y,
        sweep_start_angle=req.sweep_start_angle,
        sweep_end_angle=req.sweep_end_angle,
        num_scanlines=req.num_scanlines,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )


@router.post("/doppler")
async def doppler_scan(req: DopplerRequest):
    """Compute Doppler output for blood vessel."""
    return _sim.doppler_mode(
        probe_x=req.probe_x,
        probe_y=req.probe_y,
        beam_angle=req.beam_angle,
        vx=req.vx,
        vy=req.vy,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )
