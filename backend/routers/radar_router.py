"""
360° Radar scanning API router.
"""

from fastapi import APIRouter
from models.schemas import (
    RadarScanRequest,
    RadarScanSectorRequest,
    RadarDetectRequest,
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
        max_range=req.max_range,
    )


@router.post("/scan-sector")
async def scan_sector(req: RadarScanSectorRequest):
    """Scan over a sector of angles — returns raw range returns only."""
    targets = [t.model_dump() for t in req.targets]
    return _sim.scan_sector(
        start_angle=req.start_angle,
        end_angle=req.end_angle,
        step_angle=req.step_angle,
        beam_width=req.beam_width,
        targets=targets,
        num_elements=req.num_elements,
        element_spacing=req.element_spacing,
        frequency=req.frequency,
        window_type=req.window_type.value,
        snr=req.snr,
        max_range=req.max_range,
    )


@router.post("/detect")
async def detect(req: RadarDetectRequest):
    """Process an accumulated PPI buffer and return matched detections."""
    targets = [t.model_dump() for t in req.targets]
    return _sim.detect_from_buffer(
        ppi_data=req.ppi_data,
        beam_width=req.beam_width,
        frequency=req.frequency,
        targets=targets,
        detection_threshold=req.detection_threshold,
        max_range=req.max_range,
    )
