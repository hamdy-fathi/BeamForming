"""
Pydantic models (request / response schemas) for all API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Enums ────────────────────────────────────────────────────────────────
class SignalTypeEnum(str, Enum):
    SINE    = "sine"
    COSINE  = "cosine"
    PULSE   = "pulse"


class WindowTypeEnum(str, Enum):
    RECTANGULAR = "rectangular"
    HAMMING     = "hamming"
    HANNING     = "hanning"
    BLACKMAN    = "blackman"
    KAISER      = "kaiser"
    TUKEY       = "tukey"


# ── Beamforming ──────────────────────────────────────────────────────────
class BeamformingRequest(BaseModel):
    num_elements:   int   = Field(16,   ge=2,    le=128)
    element_spacing: float = Field(0.5,  ge=0.1,  le=2.0)
    frequency:      float = Field(1e9,  gt=0)
    steering_angle: float = Field(0.0,  ge=-90,  le=90)
    phase_offset:   float = Field(0.0,  ge=0,    le=6.2832)
    signal_type:    SignalTypeEnum = SignalTypeEnum.SINE
    snr:            float = Field(100.0, ge=0,   le=1000)
    window_type:    WindowTypeEnum = WindowTypeEnum.RECTANGULAR
    medium_speed:   float = Field(3e8,  gt=0)
    map_resolution: int   = Field(400,  ge=50,   le=800)


# ── 5G ───────────────────────────────────────────────────────────────────
class Position(BaseModel):
    x: float
    y: float


class TowerConfig(BaseModel):
    position: Position
    num_elements: int = Field(32, ge=2, le=128)
    frequency: float = Field(28e9, gt=0)
    coverage_radius: float = Field(500.0, gt=0)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    window_type: WindowTypeEnum = WindowTypeEnum.HAMMING
    snr: float = Field(1000.0, ge=0, le=1000)
    steering_angle: float = Field(0.0, ge=-90, le=90)
    power_dbm: float = Field(30.0, ge=0, le=50)
    kaiser_beta: float = Field(6.0, ge=0, le=20)

class FiveGRequest(BaseModel):
    towers: list[TowerConfig] = Field(..., min_length=3, max_length=3)
    users: list[Position] = Field(..., min_length=1, max_length=2)


class UserMoveRequest(BaseModel):
    towers:  list[TowerConfig]
    users:   list[Position]
    user_id: int   = Field(ge=0, le=1)
    dx:      float = 0.0
    dy:      float = 0.0


# ── Ultrasound ───────────────────────────────────────────────────────────

class USBeamParams(BaseModel):
    frequency:       float = Field(1e6,   gt=0)
    num_elements:    int   = Field(64,    ge=2,  le=128)
    element_spacing: float = Field(0.5,   ge=0.1, le=2.0)
    window_type:     WindowTypeEnum = WindowTypeEnum.HAMMING
    snr:             float = Field(631.0, ge=0,  le=1000)


class TissueProperties(BaseModel):
    """Update acoustic properties of a phantom ellipse (0–10)."""
    ellipse_id:  int   = Field(ge=0, le=10)
    tissue_name: str   = ""
    speed:       float = Field(1540.0, gt=0)
    density:     float = Field(1040.0, gt=0)
    attenuation: float = Field(0.6,    ge=0)
    # Optional: when supplied, back-calculates density = Z × 1e6 / speed
    impedance:   Optional[float] = Field(None, gt=0)


class EllipseGeometryUpdate(BaseModel):
    """Update geometric parameters of a phantom ellipse (0–10)."""
    ellipse_id: int   = Field(ge=0, le=10)
    center_x:   Optional[float] = None
    center_y:   Optional[float] = None
    semi_a:     Optional[float] = Field(None, gt=0)
    semi_b:     Optional[float] = Field(None, gt=0)
    theta_deg:  Optional[float] = None


class VesselUpdate(BaseModel):
    """Update blood vessel velocity and/or geometry (ellipse id=10)."""
    vx:        Optional[float] = None   # m/s
    vy:        Optional[float] = None   # m/s
    center_x:  Optional[float] = None
    center_y:  Optional[float] = None
    semi_a:    Optional[float] = Field(None, gt=0)
    semi_b:    Optional[float] = Field(None, gt=0)
    theta_deg: Optional[float] = None


class AModeRequest(BaseModel):
    probe_x:    float
    probe_y:    float
    beam_angle: float = Field(0.0, ge=-90, le=90)
    beam_params: USBeamParams = USBeamParams()


class BModeRequest(BaseModel):
    """Auto-sweep B-mode: backend generates all scanlines."""
    probe_x:          float
    probe_y:          float
    sweep_start_angle: float = Field(-40.0, ge=-180, le=180)
    sweep_end_angle:   float = Field(40.0,  ge=-180, le=180)
    num_scanlines:     int   = Field(128,   ge=16,  le=512)
    beam_params:       USBeamParams = USBeamParams()


class DopplerRequest(BaseModel):
    probe_x:    float
    probe_y:    float
    beam_angle: float = Field(0.0, ge=-90, le=90)
    # Vessel velocity vector — decomposed from direction_angle + blood_velocity on frontend
    vx:         float = Field(0.3)   # m/s  (default: rightward flow)
    vy:         float = Field(0.0)   # m/s
    beam_params: USBeamParams = USBeamParams()


# ── Radar ────────────────────────────────────────────────────────────────
class RadarTarget(BaseModel):
    id:       int
    distance: float = Field(gt=0)
    angle:    float = Field(ge=0, le=360)
    size:     float = Field(10.0, gt=0)


class RadarScanRequest(BaseModel):
    scan_angle:     float = Field(0.0,  ge=0,   le=360)
    beam_width:     float = Field(10.0, ge=1,   le=90)
    num_elements:   int   = Field(32,   ge=2,   le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    frequency:      float = Field(3e9,  gt=0)
    window_type:    WindowTypeEnum = WindowTypeEnum.HAMMING
    snr:            float = Field(200.0, ge=0,  le=1000)
    targets:        list[RadarTarget] = []
    max_range:      float = Field(50000.0, gt=0)


class RadarScanSectorRequest(BaseModel):
    start_angle:     float = Field(0.0,  ge=0,   le=360)
    end_angle:       float = Field(0.0,  ge=0,   le=360)
    step_angle:      float = Field(1.0,  gt=0,   le=90)
    beam_width:      float = Field(10.0, ge=1,   le=90)
    num_elements:   int   = Field(32,   ge=2,   le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    frequency:      float = Field(3e9,  gt=0)
    window_type:    WindowTypeEnum = WindowTypeEnum.HAMMING
    snr:            float = Field(200.0, ge=0,  le=1000)
    targets:        list[RadarTarget] = []
    max_range:      float = Field(50000.0, gt=0)


class RadarDetectRequest(BaseModel):
    ppi_data:        list[dict]
    beam_width:      float = Field(10.0, ge=1,   le=90)
    frequency:       float = Field(3e9,  gt=0)
    detection_threshold: float = Field(12.0, ge=0, le=100)
    targets:         list[RadarTarget] = []
    max_range:       float = Field(50000.0, gt=0)


class RadarDetection(BaseModel):
    det_id: int
    est_range: float
    est_angle: float
    signal_level: float
    est_size: float
    uncertainty_range: float
    uncertainty_angle: float
    uncertainty_size: float
    num_hits: int

