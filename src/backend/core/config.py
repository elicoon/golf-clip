"""Application configuration."""

from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Server
    host: str = "127.0.0.1"
    port: int = 8420
    debug: bool = True

    # Paths
    temp_dir: Path = Path.home() / ".golfclip" / "temp"
    models_dir: Path = Path.home() / ".golfclip" / "models"

    # Processing
    confidence_threshold: float = 0.70  # Clips below this require review
    clip_padding_before: float = 2.0  # Seconds before ball strike
    clip_padding_after: float = 2.0  # Seconds after ball lands

    # ML Models
    yolo_model: str = "yolov8n.pt"  # Start with nano for speed, upgrade later
    yolo_confidence: float = 0.5
    audio_sample_rate: int = 44100

    # FFmpeg
    ffmpeg_threads: int = 0  # 0 = auto-detect
    ffmpeg_timeout: int = 600  # Timeout in seconds for ffmpeg operations (0 = no timeout)

    class Config:
        env_prefix = "GOLFCLIP_"
        env_file = ".env"


settings = Settings()

# Ensure directories exist
settings.temp_dir.mkdir(parents=True, exist_ok=True)
settings.models_dir.mkdir(parents=True, exist_ok=True)
