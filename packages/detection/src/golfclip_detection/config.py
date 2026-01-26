"""Detection package configuration with sensible defaults.

This provides default settings for the detection algorithms.
These can be overridden by the host application.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional
import os


@dataclass
class DetectionSettings:
    """Settings for detection algorithms."""

    # Audio
    audio_sample_rate: int = 44100
    audio_sensitivity: float = 0.5

    # ML Models
    models_dir: Path = Path.home() / ".golfclip" / "models"
    yolo_model: str = "yolov8n.pt"
    yolo_confidence: float = 0.03

    # Processing
    confidence_threshold: float = 0.70

    def __post_init__(self):
        """Ensure directories exist."""
        self.models_dir.mkdir(parents=True, exist_ok=True)


# Default settings instance - can be replaced by host application
settings = DetectionSettings()


def configure(
    audio_sample_rate: Optional[int] = None,
    audio_sensitivity: Optional[float] = None,
    models_dir: Optional[Path] = None,
    yolo_model: Optional[str] = None,
    yolo_confidence: Optional[float] = None,
    confidence_threshold: Optional[float] = None,
) -> None:
    """Configure detection settings.

    Call this function to override default settings before using detection.

    Example:
        from golfclip_detection import configure
        configure(audio_sensitivity=0.8, models_dir=Path("/custom/models"))
    """
    global settings

    if audio_sample_rate is not None:
        settings.audio_sample_rate = audio_sample_rate
    if audio_sensitivity is not None:
        settings.audio_sensitivity = audio_sensitivity
    if models_dir is not None:
        settings.models_dir = models_dir
        settings.models_dir.mkdir(parents=True, exist_ok=True)
    if yolo_model is not None:
        settings.yolo_model = yolo_model
    if yolo_confidence is not None:
        settings.yolo_confidence = yolo_confidence
    if confidence_threshold is not None:
        settings.confidence_threshold = confidence_threshold
