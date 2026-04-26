"""
Pydantic models (request / response schemas) for all API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ── Enums ────────────────────────────────────────────────────────────────
class SignalTypeEnum(str, Enum):
    SINE = "sine"
    COSINE = "cosine"
    PULSE = "pulse"


class WindowTypeEnum(str, Enum):
    RECTANGULAR = "rectangular"
    HAMMING = "hamming"
    HANNING = "hanning"
    BLACKMAN = "blackman"
    KAISER = "kaiser"
    TUKEY = "tukey"


# ── Beamforming ──────────────────────────────────────────────────────────
class BeamformingRequest(BaseModel):
    num_elements: int = Field(16, ge=2, le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    frequency: float = Field(1e9, gt=0)
    steering_angle: float = Field(0.0, ge=-90, le=90)
    phase_offset: float = Field(0.0, ge=0, le=6.2832)
    signal_type: SignalTypeEnum = SignalTypeEnum.SINE
    snr: float = Field(100.0, ge=0, le=1000)
    window_type: WindowTypeEnum = WindowTypeEnum.RECTANGULAR
    medium_speed: float = Field(3e8, gt=0)
    map_resolution: int = Field(400, ge=50, le=800)


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


class ObstacleConfig(BaseModel):
    """A rectangular obstacle that blocks LOS and produces reflections."""
    id: int = Field(ge=0)
    x: float  # center x
    y: float  # center y
    width: float = Field(60.0, ge=20, le=200)
    height: float = Field(60.0, ge=20, le=200)
    reflection_loss_db: float = Field(6.0, ge=0, le=20)  # loss per bounce


class FiveGRequest(BaseModel):
    towers: list[TowerConfig] = Field(..., min_length=3, max_length=3)
    users: list[Position] = Field(..., min_length=1, max_length=2)
    obstacles: list[ObstacleConfig] = Field(default_factory=list, max_length=5)


class UserMoveRequest(BaseModel):
    towers: list[TowerConfig]
    users: list[Position]
    user_id: int = Field(ge=0, le=1)
    dx: float = 0.0
    dy: float = 0.0


# ── Ultrasound ───────────────────────────────────────────────────────────
class TissueProperties(BaseModel):
    ellipse_id: int = Field(ge=0, le=9)
    tissue_name: str = ""
    speed: float = Field(1540.0, gt=0)
    density: float = Field(1040.0, gt=0)
    attenuation: float = Field(0.6, ge=0)


class VesselConfig(BaseModel):
    center_x: float = 0.0
    center_y: float = -0.3
    direction_angle: float = Field(45.0, ge=0, le=360)
    diameter: float = Field(0.02, gt=0)
    blood_velocity: float = Field(0.5, ge=-5.0, le=5.0)  # m/s


class USBeamParams(BaseModel):
    frequency: float = Field(5e6, gt=0)
    num_elements: int = Field(64, ge=2, le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    window_type: WindowTypeEnum = WindowTypeEnum.HAMMING
    snr: float = Field(200.0, ge=0, le=1000)


class AModeRequest(BaseModel):
    probe_x: float
    probe_y: float
    beam_angle: float = Field(0.0, ge=-90, le=90)
    beam_params: USBeamParams = USBeamParams()


class BModeRequest(BaseModel):
    scanlines: list[dict]  # [{probe_x, probe_y, beam_angle}]
    beam_params: USBeamParams = USBeamParams()


class DopplerRequest(BaseModel):
    probe_x: float
    probe_y: float
    beam_angle: float = Field(0.0, ge=-90, le=90)
    vessel: VesselConfig = VesselConfig()
    beam_params: USBeamParams = USBeamParams()


# ── Radar ────────────────────────────────────────────────────────────────
class RadarTarget(BaseModel):
    id: int
    distance: float = Field(gt=0)
    angle: float = Field(ge=0, le=360)
    size: float = Field(10.0, gt=0)


class RadarScanRequest(BaseModel):
    scan_angle: float = Field(0.0, ge=0, le=360)
    beam_width: float = Field(10.0, ge=1, le=90)
    num_elements: int = Field(32, ge=2, le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    frequency: float = Field(3e9, gt=0)
    window_type: WindowTypeEnum = WindowTypeEnum.HAMMING
    snr: float = Field(200.0, ge=0, le=1000)
    targets: list[RadarTarget] = []


class RadarFullSweepRequest(BaseModel):
    beam_width: float = Field(10.0, ge=1, le=90)
    scan_speed: float = Field(30.0, ge=1, le=120)  # RPM
    num_elements: int = Field(32, ge=2, le=128)
    element_spacing: float = Field(0.5, ge=0.1, le=2.0)
    frequency: float = Field(3e9, gt=0)
    window_type: WindowTypeEnum = WindowTypeEnum.HAMMING
    snr: float = Field(200.0, ge=0, le=1000)
    targets: list[RadarTarget] = []
