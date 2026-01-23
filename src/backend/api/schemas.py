"""Pydantic schemas for API request/response models."""

from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field


class VideoInfo(BaseModel):
    """Video file metadata."""

    path: str
    duration: float
    width: int
    height: int
    fps: float
    codec: str
    has_audio: bool
    audio_sample_rate: Optional[int] = None
    file_size: int


class DetectedShot(BaseModel):
    """A detected golf shot with timing information."""

    id: int
    strike_time: float = Field(..., description="Timestamp when club contacts ball (seconds)")
    landing_time: Optional[float] = Field(
        None, description="Estimated timestamp when ball lands (seconds)"
    )
    clip_start: float = Field(..., description="Recommended clip start time (seconds)")
    clip_end: float = Field(..., description="Recommended clip end time (seconds)")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence (0-1)")
    confidence_reasons: list[str] = Field(
        default_factory=list, description="Factors affecting confidence"
    )
    shot_type: Optional[str] = Field(
        None, description="Detected shot type: drive, iron, chip, putt"
    )
    audio_confidence: float = Field(..., ge=0, le=1, description="Audio detection confidence")
    visual_confidence: float = Field(..., ge=0, le=1, description="Visual detection confidence")


class ClipBoundary(BaseModel):
    """User-confirmed or adjusted clip boundaries."""

    shot_id: int
    start_time: float
    end_time: float
    approved: bool = False


class ProcessingStatus(BaseModel):
    """Current status of video processing."""

    video_path: str
    status: str = Field(..., description="pending, processing, review, complete, error")
    progress: float = Field(0, ge=0, le=100, description="Processing progress percentage")
    current_step: str = ""
    total_shots_detected: int = 0
    shots_needing_review: int = 0
    error_message: Optional[str] = None


class ProcessVideoRequest(BaseModel):
    """Request to process a video file."""

    video_path: str
    output_dir: Optional[str] = None
    auto_approve_high_confidence: bool = True


class ProcessVideoResponse(BaseModel):
    """Response after initiating video processing."""

    job_id: str
    status: ProcessingStatus
    video_info: VideoInfo


class ExportClipsRequest(BaseModel):
    """Request to export confirmed clips."""

    job_id: str
    clips: list[ClipBoundary]
    output_dir: str
    filename_pattern: str = "shot_{shot_id}"


class HoleInfo(BaseModel):
    """Information about the golf hole for overlay."""

    hole_number: int = Field(..., ge=1, le=18)
    yardage: int = Field(..., ge=0)
    par: Optional[int] = Field(None, ge=3, le=5)
    shot_number: int = Field(1, ge=1)
