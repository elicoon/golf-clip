"""Pydantic schemas for API request/response models."""

from enum import Enum
from typing import Any, Optional

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


class JobError(BaseModel):
    """Structured error information for failed jobs."""

    code: str = Field(..., description="Error code for programmatic handling")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[dict[str, Any]] = Field(
        default=None, description="Additional error context"
    )


class ProcessingStatus(BaseModel):
    """Current status of video processing."""

    video_path: str
    status: str = Field(
        ...,
        description="Job status: pending, processing, review, complete, error, cancelled, cancelling"
    )
    progress: float = Field(0, ge=0, le=100, description="Processing progress percentage")
    current_step: str = ""
    total_shots_detected: int = 0
    shots_needing_review: int = 0
    error_message: Optional[str] = None


class ProgressEvent(BaseModel):
    """Real-time progress event for SSE streaming."""

    job_id: str
    step: str = Field(..., description="Current processing step name")
    progress: float = Field(..., ge=0, le=100, description="Progress percentage")
    details: Optional[str] = Field(None, description="Additional details or error message")
    timestamp: str = Field(..., description="ISO 8601 timestamp of this event")
    # Populated on completion events for the frontend to determine next view
    total_shots_detected: int = Field(0, description="Total shots found (on completion)")
    shots_needing_review: int = Field(0, description="Shots needing review (on completion)")


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
    render_tracer: bool = Field(False, description="Whether to render shot tracer overlay")
    tracer_style: Optional["TracerStyle"] = Field(None, description="Tracer styling options")


class ExportClipsResponse(BaseModel):
    """Response after exporting clips."""

    exported: list[str] = Field(..., description="List of exported file paths")
    count: int = Field(..., description="Number of clips exported")
    errors: list[dict[str, Any]] = Field(
        default_factory=list, description="Export errors if any"
    )
    has_errors: bool = Field(False, description="Whether any exports failed")


class HoleInfo(BaseModel):
    """Information about the golf hole for overlay."""

    hole_number: int = Field(..., ge=1, le=18)
    yardage: int = Field(..., ge=0)
    par: Optional[int] = Field(None, ge=3, le=5)
    shot_number: int = Field(1, ge=1)


class JobSummary(BaseModel):
    """Summary of a job for listing."""

    job_id: str
    video_path: str
    status: str
    progress: float
    current_step: str
    total_shots_detected: int = 0
    created_at: Optional[str] = None
    completed_at: Optional[str] = None


class JobListResponse(BaseModel):
    """Response for job listing endpoint."""

    jobs: list[JobSummary]
    count: int


class ExportJobStatus(BaseModel):
    """Status of an export job."""

    export_job_id: str
    status: str = Field(
        ...,
        description="Export status: pending, exporting, complete, error"
    )
    total_clips: int = Field(0, description="Total number of clips to export")
    exported_count: int = Field(0, description="Number of clips exported so far")
    current_clip: Optional[int] = Field(None, description="Shot ID of clip currently being exported")
    progress: float = Field(0, ge=0, le=100, description="Export progress percentage")
    output_dir: str = Field("", description="Output directory for exported clips")
    exported: list[str] = Field(default_factory=list, description="List of exported file paths")
    errors: list[dict[str, Any]] = Field(default_factory=list, description="Export errors if any")
    has_errors: bool = Field(False, description="Whether any exports failed")


class ExportJobResponse(BaseModel):
    """Response after initiating clip export."""

    export_job_id: str
    status: str = Field("pending", description="Initial export status")
    total_clips: int = Field(..., description="Number of clips to export")


# ============================================================================
# Shot Feedback Schemas
# ============================================================================


class FeedbackType(str, Enum):
    """Type of feedback on a detected shot."""

    TRUE_POSITIVE = "true_positive"
    FALSE_POSITIVE = "false_positive"


class StartingLine(str, Enum):
    """Starting line direction relative to target."""

    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class ShotShape(str, Enum):
    """Shot shape (curve direction)."""

    HOOK = "hook"
    DRAW = "draw"
    STRAIGHT = "straight"
    FADE = "fade"
    SLICE = "slice"


class ShotHeight(str, Enum):
    """Shot height (apex level)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ShotFeedbackItem(BaseModel):
    """Feedback for a single shot."""

    shot_id: int
    feedback_type: FeedbackType
    notes: Optional[str] = Field(None, max_length=500, description="Optional user notes")


class ShotFeedbackRequest(BaseModel):
    """Request to submit feedback for multiple shots."""

    feedback: list[ShotFeedbackItem]


class ShotFeedbackResponse(BaseModel):
    """Response for a single feedback record."""

    id: int
    job_id: str
    shot_id: int
    feedback_type: str
    notes: Optional[str]
    confidence_snapshot: Optional[float]
    audio_confidence_snapshot: Optional[float]
    visual_confidence_snapshot: Optional[float]
    created_at: str
    environment: str = Field("prod", description="Environment tag: 'prod' or 'dev'")


class FeedbackStats(BaseModel):
    """Aggregate statistics on collected feedback."""

    total_feedback: int
    true_positives: int
    false_positives: int
    precision: float = Field(..., description="TP / (TP + FP), 0 if no data")


class FeedbackExportResponse(BaseModel):
    """Response for exporting all feedback data."""

    exported_at: str
    total_records: int
    records: list[dict[str, Any]]


# === TRAJECTORY SCHEMAS (Phase 2) ===

class TrajectoryPoint(BaseModel):
    """A point in the ball's trajectory (normalized coordinates)."""
    timestamp: float = Field(..., description="Time in seconds from video start")
    x: float = Field(..., ge=0, le=1, description="X position as fraction of frame width (0-1)")
    y: float = Field(..., ge=0, le=1, description="Y position as fraction of frame height (0-1)")
    confidence: float = Field(0, ge=0, le=1, description="Detection confidence")
    interpolated: bool = Field(False, description="Whether this point was interpolated")


class TrajectoryData(BaseModel):
    """Complete trajectory data for a shot."""
    shot_id: int
    points: list[TrajectoryPoint]
    confidence: float = Field(..., ge=0, le=1)
    smoothness_score: Optional[float] = None
    physics_plausibility: Optional[float] = None
    apex_point: Optional[TrajectoryPoint] = None
    launch_angle: Optional[float] = Field(None, description="Launch angle in degrees")
    flight_duration: Optional[float] = Field(None, description="Flight time in seconds")
    has_gaps: bool = False
    gap_count: int = 0
    is_manual_override: bool = False
    frame_width: int = Field(..., description="Source video width for coordinate scaling")
    frame_height: int = Field(..., description="Source video height for coordinate scaling")


class TrajectoryUpdateRequest(BaseModel):
    """Request to update trajectory with manual edits."""
    points: list[TrajectoryPoint]


class TracerStyle(BaseModel):
    """Styling options for shot tracer rendering."""
    color: str = Field("#FFFFFF", description="Tracer line color (hex)")
    line_width: int = Field(3, ge=1, le=10, description="Line width in pixels")
    glow_enabled: bool = Field(True, description="Whether to add glow effect")
    glow_color: str = Field("#FFFFFF", description="Glow color (hex)")
    glow_radius: int = Field(8, ge=0, le=20, description="Glow blur radius")
    show_apex_marker: bool = Field(True, description="Show marker at apex point")
    show_landing_marker: bool = Field(True, description="Show marker at landing point")
    animation_speed: float = Field(1.0, ge=0.5, le=3.0, description="Animation speed multiplier")


# ============================================================================
# Batch Upload Schemas
# ============================================================================


class UploadedFile(BaseModel):
    """Information about a successfully uploaded file."""
    filename: str = Field(..., description="Original filename")
    path: str = Field(..., description="Server path where file was saved")
    size: int = Field(..., description="File size in bytes")


class UploadError(BaseModel):
    """Error information for a failed upload."""
    filename: str = Field(..., description="Original filename that failed")
    error: str = Field(..., description="Error message describing the failure")


class BatchUploadResponse(BaseModel):
    """Response for batch file upload."""
    uploaded: list[UploadedFile] = Field(
        default_factory=list,
        description="List of successfully uploaded files"
    )
    errors: list[UploadError] = Field(
        default_factory=list,
        description="List of files that failed to upload"
    )
