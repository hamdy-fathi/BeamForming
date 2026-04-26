"""
360° Radar scanning API router.
"""

from fastapi import APIRouter
from models.schemas import (
    RadarScanRequest,
    RadarFullSweepRequest,
    RadarFullSweepResponse,
)
from simulators.radar import RadarSimulator

router = APIRouter(prefix="/api/radar", tags=["Radar"])

_sim = RadarSimulator()


@router.post("/scan")
async def single_scan(req: RadarScanRequest):
    """Single-angle radar scan — returns raw range returns only."""
    targets = [t.model_dump() for t in req.targets]
    return _sim.scan_at_angle(
        scan_angle=req.scan_angle,
        beam_width=req.beam_width,
        targets=targets,
        num_elements=req.num_elements,
        element_spacing=req.element_spacing,
        frequency=req.frequency,
        window_type=req.window_type.value,
        snr=req.snr,
    )


@router.post("/full-sweep", response_model=RadarFullSweepResponse)
async def full_sweep(req: RadarFullSweepRequest):
    """Complete 360° radar sweep with blind detection.

    Returns PPI data, estimated detections, and ground truth for comparison.
    """
    targets = [t.model_dump() for t in req.targets]
    return _sim.full_sweep(
        beam_width=req.beam_width,
        scan_speed_rpm=req.scan_speed,
        targets=targets,
        num_elements=req.num_elements,
        element_spacing=req.element_spacing,
        frequency=req.frequency,
        window_type=req.window_type.value,
        snr=req.snr,
        detection_threshold=req.detection_threshold,
    )
