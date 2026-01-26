"""Shared API schemas for GolfClip."""

from .schemas import (
    # Video and Processing
    VideoInfo,
    DetectedShot,
    ClipBoundary,
    JobError,
    ProcessingStatus,
    ProgressEvent,
    ProcessVideoRequest,
    ProcessVideoResponse,
    # Export
    ExportClipsRequest,
    ExportClipsResponse,
    ExportJobStatus,
    ExportJobResponse,
    # Job Management
    HoleInfo,
    JobSummary,
    JobListResponse,
    # Feedback
    FeedbackType,
    ShotFeedbackItem,
    ShotFeedbackRequest,
    ShotFeedbackResponse,
    FeedbackStats,
    FeedbackExportResponse,
    # Trajectory
    StartingLine,
    ShotShape,
    ShotHeight,
    TrajectoryPoint,
    TrajectoryData,
    TrajectoryUpdateRequest,
    TracerStyle,
    # Batch Upload
    UploadedFile,
    UploadError,
    BatchUploadResponse,
)

__all__ = [
    # Video and Processing
    "VideoInfo",
    "DetectedShot",
    "ClipBoundary",
    "JobError",
    "ProcessingStatus",
    "ProgressEvent",
    "ProcessVideoRequest",
    "ProcessVideoResponse",
    # Export
    "ExportClipsRequest",
    "ExportClipsResponse",
    "ExportJobStatus",
    "ExportJobResponse",
    # Job Management
    "HoleInfo",
    "JobSummary",
    "JobListResponse",
    # Feedback
    "FeedbackType",
    "ShotFeedbackItem",
    "ShotFeedbackRequest",
    "ShotFeedbackResponse",
    "FeedbackStats",
    "FeedbackExportResponse",
    # Trajectory
    "StartingLine",
    "ShotShape",
    "ShotHeight",
    "TrajectoryPoint",
    "TrajectoryData",
    "TrajectoryUpdateRequest",
    "TracerStyle",
    # Batch Upload
    "UploadedFile",
    "UploadError",
    "BatchUploadResponse",
]
