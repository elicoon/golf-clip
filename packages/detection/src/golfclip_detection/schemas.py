"""Data models for detection results.

These are lightweight dataclasses for detection output.
The host application may convert these to Pydantic models for API responses.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DetectedShot:
    """A detected golf shot with timing information."""

    id: int
    strike_time: float  # Timestamp when club contacts ball (seconds)
    landing_time: Optional[float]  # Estimated timestamp when ball lands (seconds)
    clip_start: float  # Recommended clip start time (seconds)
    clip_end: float  # Recommended clip end time (seconds)
    confidence: float  # Detection confidence (0-1)
    confidence_reasons: list[str] = field(default_factory=list)  # Factors affecting confidence
    shot_type: Optional[str] = None  # Detected shot type: drive, iron, chip, putt
    audio_confidence: float = 0.0  # Audio detection confidence (0-1)
    visual_confidence: float = 0.0  # Visual detection confidence (0-1)

    def to_dict(self) -> dict:
        """Convert to dictionary for serialization."""
        return {
            "id": self.id,
            "strike_time": self.strike_time,
            "landing_time": self.landing_time,
            "clip_start": self.clip_start,
            "clip_end": self.clip_end,
            "confidence": self.confidence,
            "confidence_reasons": self.confidence_reasons,
            "shot_type": self.shot_type,
            "audio_confidence": self.audio_confidence,
            "visual_confidence": self.visual_confidence,
        }
