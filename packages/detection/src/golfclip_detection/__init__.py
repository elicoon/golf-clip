"""GolfClip detection algorithms."""

from .audio import AudioStrikeDetector, DetectionConfig
from .origin import BallOriginDetector, OriginDetection
from .tracker import ConstrainedBallTracker
from .pipeline import ShotDetectionPipeline
from .config import settings, configure

__all__ = [
    "AudioStrikeDetector",
    "DetectionConfig",
    "BallOriginDetector",
    "OriginDetection",
    "ConstrainedBallTracker",
    "ShotDetectionPipeline",
    "settings",
    "configure",
]
