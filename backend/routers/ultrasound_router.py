"""
Ultrasound (A-mode, B-mode, Doppler) API router.
"""

from fastapi import APIRouter
from models.schemas import AModeRequest, BModeRequest, DopplerRequest, TissueProperties
from simulators.ultrasound import UltrasoundSimulator

router = APIRouter(prefix="/api/ultrasound", tags=["Ultrasound"])

_sim = UltrasoundSimulator()


@router.get("/phantom")
async def get_phantom():
    """Return the Shepp–Logan phantom definition with acoustic properties."""
    phantom_data = _sim.phantom.to_dict()
    # also include the phantom image
    img = _sim.phantom.generate_image(size=256)
    phantom_data["image"] = img.tolist()
    return phantom_data


@router.post("/a-mode")
async def a_mode_scan(req: AModeRequest):
    """Compute A-mode scanline from probe into phantom."""
    return _sim.a_mode(
        probe_x=req.probe_x,
        probe_y=req.probe_y,
        beam_angle=req.beam_angle,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )


@router.post("/b-mode")
async def b_mode_scan(req: BModeRequest):
    """Assemble B-mode image from multiple scanlines."""
    return _sim.b_mode(
        scanlines=req.scanlines,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )


@router.post("/doppler")
async def doppler_scan(req: DopplerRequest):
    """Compute Doppler output for blood vessel."""
    vessel = req.vessel.model_dump()
    return _sim.doppler_mode(
        probe_x=req.probe_x,
        probe_y=req.probe_y,
        beam_angle=req.beam_angle,
        vessel=vessel,
        frequency=req.beam_params.frequency,
        snr=req.beam_params.snr,
    )


@router.put("/phantom/tissue")
async def update_tissue(req: TissueProperties):
    """Update acoustic properties for a specific phantom ellipse."""
    _sim.phantom.update_tissue(
        eid=req.ellipse_id,
        speed=req.speed,
        density=req.density,
        attenuation=req.attenuation,
        tissue_name=req.tissue_name or None,
    )
    return {"status": "updated", "ellipse": _sim.phantom.ellipses[req.ellipse_id].to_dict()}
