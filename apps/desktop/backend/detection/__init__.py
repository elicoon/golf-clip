"""Shot detection modules."""

from backend.detection.classifier import ShotClassifier
from backend.detection.pipeline import ShotDetectionPipeline
from backend.detection.visual import (
    ensure_model_downloaded,
    get_model_status,
    is_model_ready,
)

__all__ = [
    "ShotClassifier",
    "ShotDetectionPipeline",
    "ensure_model_downloaded",
    "get_model_status",
    "is_model_ready",
]
