"""Pytest fixtures for backend integration tests."""

import asyncio
import os
import shutil
import struct
import tempfile
import wave
from pathlib import Path
from typing import Generator

import numpy as np
import pytest
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

# Add src directory to Python path
import sys
src_path = Path(__file__).parent.parent.parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))


def _find_ffmpeg_bin_dir() -> str | None:
    """Find ffmpeg bin directory from common installation locations."""
    # Check winget installation path (Windows)
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        for pkg_dir in winget_path.iterdir():
            if "FFmpeg" in pkg_dir.name:
                # Find the bin directory
                for bin_dir in pkg_dir.rglob("bin"):
                    if (bin_dir / "ffprobe.exe").exists():
                        return str(bin_dir)

    # Check common Windows paths
    common_paths = [
        Path("C:/ffmpeg/bin"),
        Path("C:/Program Files/ffmpeg/bin"),
        Path("C:/Program Files (x86)/ffmpeg/bin"),
    ]
    for path in common_paths:
        if (path / "ffprobe.exe").exists():
            return str(path)

    return None


# Add ffmpeg to PATH if not already present
_ffmpeg_bin = _find_ffmpeg_bin_dir()
if _ffmpeg_bin and _ffmpeg_bin not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _ffmpeg_bin + os.pathsep + os.environ.get("PATH", "")

from unittest.mock import patch

# Set up test database path before importing app
TEST_DB_DIR = Path(tempfile.gettempdir()) / "golfclip_integration_test"
TEST_DB_PATH = TEST_DB_DIR / "test.db"


@pytest.fixture(scope="function")
def client() -> Generator[TestClient, None, None]:
    """Create a FastAPI TestClient for synchronous tests with isolated database."""
    # Ensure test directory exists and clean up any existing test database
    TEST_DB_DIR.mkdir(parents=True, exist_ok=True)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    # Clean up WAL files
    for ext in ["-wal", "-shm"]:
        wal_file = Path(str(TEST_DB_PATH) + ext)
        if wal_file.exists():
            wal_file.unlink()

    # Patch DB_PATH before importing app to use test database
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        # Import app after patching
        from backend.main import app
        from backend.api.routes import _job_cache, _progress_queues

        # Clear any existing jobs before each test
        _job_cache.clear()
        _progress_queues.clear()

        with TestClient(app) as test_client:
            yield test_client

        # Cleanup after test
        _job_cache.clear()
        _progress_queues.clear()

    # Clean up test database files
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    for ext in ["-wal", "-shm"]:
        wal_file = Path(str(TEST_DB_PATH) + ext)
        if wal_file.exists():
            wal_file.unlink()


@pytest.fixture
async def async_client() -> AsyncClient:
    """Create an async client for async tests with isolated database."""
    # Ensure test directory exists and clean up any existing test database
    TEST_DB_DIR.mkdir(parents=True, exist_ok=True)
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()

    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.main import app
        from backend.api.routes import _job_cache, _progress_queues

        # Clear any existing jobs before each test
        _job_cache.clear()
        _progress_queues.clear()

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test"
        ) as ac:
            yield ac

        # Cleanup after test
        _job_cache.clear()
        _progress_queues.clear()


@pytest.fixture
def temp_output_dir() -> Generator[Path, None, None]:
    """Create a temporary output directory for test exports."""
    temp_dir = Path(tempfile.mkdtemp(prefix="golfclip_test_"))
    yield temp_dir

    # Cleanup
    if temp_dir.exists():
        shutil.rmtree(temp_dir)


@pytest.fixture
def synthetic_video_path(temp_output_dir: Path) -> Generator[Path, None, None]:
    """
    Create a synthetic test video file using raw format.

    This creates a minimal valid video that can be processed by ffmpeg.
    The video is 2 seconds at 30 fps (60 frames) with audio.
    """
    video_path = temp_output_dir / "test_video.mp4"

    try:
        # Try to create video with ffmpeg if available
        _create_video_with_ffmpeg(video_path, duration=2.0, fps=30)
    except Exception:
        # Fallback: create with opencv if ffmpeg not available
        try:
            _create_video_with_opencv(video_path, duration=2.0, fps=30)
        except ImportError:
            # Last resort: create a minimal placeholder
            _create_minimal_video_placeholder(video_path)

    yield video_path

    # Cleanup handled by temp_output_dir fixture


def _get_ffmpeg_executable() -> str:
    """Get the path to ffmpeg executable."""
    import shutil

    # Check if ffmpeg is already in PATH
    if shutil.which("ffmpeg"):
        return "ffmpeg"

    # Check winget installation path (Windows)
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        for pkg_dir in winget_path.iterdir():
            if "FFmpeg" in pkg_dir.name:
                # Find the bin directory
                for bin_dir in pkg_dir.rglob("bin"):
                    ffmpeg = bin_dir / "ffmpeg.exe"
                    if ffmpeg.exists():
                        return str(ffmpeg)

    # Check common Windows paths
    common_paths = [
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/Program Files (x86)/ffmpeg/bin/ffmpeg.exe"),
    ]
    for path in common_paths:
        if path.exists():
            return str(path)

    return "ffmpeg"  # Fallback to default


def _create_video_with_ffmpeg(video_path: Path, duration: float = 2.0, fps: int = 30):
    """Create a test video using ffmpeg with synthetic audio."""
    import subprocess

    ffmpeg_path = _get_ffmpeg_executable()

    # Generate a test video with color bars and a tone
    # Using lavfi to generate synthetic video and audio
    cmd = [
        ffmpeg_path, "-y",
        "-f", "lavfi",
        "-i", f"color=c=green:s=320x240:r={fps}:d={duration}",
        "-f", "lavfi",
        "-i", f"sine=frequency=440:sample_rate=44100:duration={duration}",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-c:a", "aac",
        "-shortest",
        str(video_path)
    ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=30
    )

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")


def _create_video_with_opencv(video_path: Path, duration: float = 2.0, fps: int = 30):
    """Create a test video using OpenCV (no audio)."""
    import cv2

    width, height = 320, 240
    total_frames = int(duration * fps)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(str(video_path), fourcc, fps, (width, height))

    for i in range(total_frames):
        # Create a green frame with moving circle (simulating ball)
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        frame[:, :] = (0, 255, 0)  # Green background

        # Draw a white circle that moves across the frame
        x = int((i / total_frames) * width)
        cv2.circle(frame, (x, height // 2), 10, (255, 255, 255), -1)

        out.write(frame)

    out.release()


def _create_minimal_video_placeholder(video_path: Path):
    """Create a minimal placeholder file for testing edge cases."""
    # This is just a placeholder - real tests need actual video
    video_path.write_bytes(b"PLACEHOLDER_VIDEO_FILE")


def _get_ffmpeg_path() -> str:
    """Get the path to ffmpeg/ffprobe, checking common install locations."""
    import shutil

    # Check if ffprobe is already in PATH
    if shutil.which("ffprobe"):
        return "ffprobe"

    # Check winget installation path (Windows)
    winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_path.exists():
        for pkg_dir in winget_path.iterdir():
            if "FFmpeg" in pkg_dir.name:
                # Find the bin directory
                for bin_dir in pkg_dir.rglob("bin"):
                    ffprobe = bin_dir / "ffprobe.exe"
                    if ffprobe.exists():
                        return str(ffprobe)

    # Check common Windows paths
    common_paths = [
        Path("C:/ffmpeg/bin/ffprobe.exe"),
        Path("C:/Program Files/ffmpeg/bin/ffprobe.exe"),
        Path("C:/Program Files (x86)/ffmpeg/bin/ffprobe.exe"),
    ]
    for path in common_paths:
        if path.exists():
            return str(path)

    return "ffprobe"  # Fallback to default


def _is_ffmpeg_available() -> bool:
    """Check if ffmpeg/ffprobe is available."""
    import subprocess
    ffprobe_path = _get_ffmpeg_path()
    try:
        result = subprocess.run(
            [ffprobe_path, "-version"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _is_valid_video(video_path: Path) -> bool:
    """Check if the video file is a real video (not a placeholder)."""
    if not video_path.exists():
        return False
    # Placeholder files are small and don't have valid video signatures
    if video_path.stat().st_size < 1000:
        return False
    # Check for MP4 signature or other video format markers
    with open(video_path, 'rb') as f:
        header = f.read(12)
        # MP4/MOV files typically have 'ftyp' marker
        if b'ftyp' in header:
            return True
        # AVI files start with 'RIFF'
        if header.startswith(b'RIFF'):
            return True
    return False


# Cache the ffmpeg availability check
_FFMPEG_AVAILABLE = None

@pytest.fixture
def requires_real_video():
    """Skip test if ffmpeg is not available (needed for video processing)."""
    global _FFMPEG_AVAILABLE
    if _FFMPEG_AVAILABLE is None:
        _FFMPEG_AVAILABLE = _is_ffmpeg_available()
    if not _FFMPEG_AVAILABLE:
        pytest.skip("Skipping test: ffmpeg/ffprobe not available in PATH")


@pytest.fixture
def synthetic_audio_wav(temp_output_dir: Path) -> Generator[Path, None, None]:
    """Create a synthetic WAV audio file with a strike-like sound."""
    audio_path = temp_output_dir / "test_audio.wav"

    sample_rate = 44100
    duration = 2.0
    num_samples = int(sample_rate * duration)

    # Generate audio with a transient spike (simulating golf strike)
    t = np.linspace(0, duration, num_samples, dtype=np.float32)

    # Base noise
    audio = np.random.randn(num_samples).astype(np.float32) * 0.01

    # Add transient at 1 second mark
    strike_time = 1.0
    strike_idx = int(strike_time * sample_rate)
    strike_duration = int(0.05 * sample_rate)  # 50ms transient

    # Create strike transient (exponential decay)
    strike = np.exp(-np.linspace(0, 5, strike_duration)) * 0.8
    audio[strike_idx:strike_idx + strike_duration] += strike.astype(np.float32)

    # Normalize
    audio = np.clip(audio, -1.0, 1.0)

    # Write WAV file
    with wave.open(str(audio_path), 'w') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)

        # Convert to 16-bit integers
        audio_int = (audio * 32767).astype(np.int16)
        wav_file.writeframes(audio_int.tobytes())

    yield audio_path


@pytest.fixture
def nonexistent_video_path() -> str:
    """Return a path that doesn't exist for error testing."""
    return "/nonexistent/path/to/video.mp4"


@pytest.fixture
def invalid_job_id() -> str:
    """Return an invalid job ID for error testing."""
    return "00000000-0000-0000-0000-000000000000"


@pytest.fixture
def cleanup_exports(temp_output_dir: Path):
    """Fixture to ensure export files are cleaned up."""
    exported_files = []

    yield exported_files

    # Cleanup any exported files
    for file_path in exported_files:
        path = Path(file_path)
        if path.exists():
            path.unlink()


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "slow: marks tests as slow (deselect with '-m \"not slow\"')"
    )
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests"
    )
