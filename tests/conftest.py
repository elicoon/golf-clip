"""Pytest configuration and fixtures for GolfClip tests."""

import os
import sys
from pathlib import Path

import pytest

# Add src directory to Python path for imports
src_path = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(src_path))

# Add FFmpeg to PATH if installed via winget (Windows)
_ffmpeg_winget_path = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
if _ffmpeg_winget_path.exists():
    for ffmpeg_dir in _ffmpeg_winget_path.glob("Gyan.FFmpeg*/ffmpeg-*/bin"):
        if ffmpeg_dir.exists():
            os.environ["PATH"] = str(ffmpeg_dir) + os.pathsep + os.environ.get("PATH", "")
            break


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: marks tests as integration tests (deselect with '-m \"not integration\"')"
    )
