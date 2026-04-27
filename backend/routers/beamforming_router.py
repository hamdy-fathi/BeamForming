"""
Beamforming core API router.
"""

from fastapi import APIRouter
from models.schemas import BeamformingRequest
from core.beamforming import BeamformingSimulator, SignalType
from core.apodization import WindowType, WINDOW_DESCRIPTIONS

router = APIRouter(prefix="/api/beamforming", tags=["Beamforming"])


@router.post("/compute")
async def compute_beamforming(req: BeamformingRequest):
    """Compute interference map and beam profile for given parameters."""
    sim = BeamformingSimulator(
        num_elements=req.num_elements,
        element_spacing=req.element_spacing,
        frequency=req.frequency,
        steering_angle=req.steering_angle,
        phase_offset=req.phase_offset,
        signal_type=SignalType(req.signal_type),
        snr=req.snr,
        window_type=WindowType(req.window_type),
        medium_speed=req.medium_speed,
    )
    return sim.compute_all(map_resolution=req.map_resolution)


@router.get("/windows")
async def list_windows():
    """Return available window functions with descriptions."""
    return {
        "windows": [
            {"type": k.value, **v}
            for k, v in WINDOW_DESCRIPTIONS.items()
        ]
    }
