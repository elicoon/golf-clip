"""Webapp configuration - cloud mode."""

from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Cloud webapp settings."""

    # Server
    host: str = "0.0.0.0"
    port: int = 8420
    debug: bool = False

    # Temp directory for processing
    temp_dir: Path = Path("/tmp/golfclip")

    # PostgreSQL (required)
    database_url: str = "postgresql://localhost/golfclip"

    # Cloudflare R2 (required)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "golfclip-videos"

    # Processing (shared with desktop)
    confidence_threshold: float = 0.70
    clip_padding_before: float = 2.0
    clip_padding_after: float = 2.0

    # ML (shared)
    yolo_model: str = "yolov8n.pt"
    yolo_confidence: float = 0.03
    audio_sample_rate: int = 44100
    audio_sensitivity: float = 0.5

    # FFmpeg
    ffmpeg_threads: int = 0
    ffmpeg_timeout: int = 600

    # Cloud-specific
    auto_cleanup_after_export: bool = True
    max_video_size_mb: int = 500

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "https://golfclip.vercel.app"]

    class Config:
        env_prefix = "GOLFCLIP_"
        env_file = ".env"


settings = Settings()

# Ensure temp directory exists
settings.temp_dir.mkdir(parents=True, exist_ok=True)
