"""FFmpeg video operations."""

import subprocess
from pathlib import Path
from typing import Optional

import ffmpeg
from loguru import logger

from backend.core.config import settings


def get_video_info(video_path: Path) -> dict:
    """Get video metadata using ffprobe."""
    try:
        probe = ffmpeg.probe(str(video_path))
        video_stream = next(
            (s for s in probe["streams"] if s["codec_type"] == "video"), None
        )
        audio_stream = next(
            (s for s in probe["streams"] if s["codec_type"] == "audio"), None
        )

        if not video_stream:
            raise ValueError("No video stream found")

        # Parse frame rate
        fps_parts = video_stream.get("r_frame_rate", "30/1").split("/")
        fps = float(fps_parts[0]) / float(fps_parts[1]) if len(fps_parts) == 2 else 30.0

        return {
            "duration": float(probe["format"].get("duration", 0)),
            "width": int(video_stream.get("width", 0)),
            "height": int(video_stream.get("height", 0)),
            "fps": fps,
            "codec": video_stream.get("codec_name", "unknown"),
            "has_audio": audio_stream is not None,
            "audio_sample_rate": int(audio_stream.get("sample_rate", 44100))
            if audio_stream
            else None,
            "file_size": int(probe["format"].get("size", 0)),
        }
    except ffmpeg.Error as e:
        logger.error(f"FFprobe error: {e.stderr.decode() if e.stderr else str(e)}")
        raise


def extract_audio(video_path: Path, output_path: Path) -> Path:
    """Extract audio track from video as WAV."""
    logger.info(f"Extracting audio from {video_path}")

    try:
        (
            ffmpeg.input(str(video_path))
            .output(
                str(output_path),
                acodec="pcm_s16le",
                ar=settings.audio_sample_rate,
                ac=1,  # Mono
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        logger.info(f"Audio extracted to {output_path}")
        return output_path
    except ffmpeg.Error as e:
        logger.error(f"FFmpeg error: {e.stderr.decode() if e.stderr else str(e)}")
        raise


def extract_frame(video_path: Path, timestamp: float, output_path: Path) -> Path:
    """Extract a single frame at the given timestamp."""
    try:
        (
            ffmpeg.input(str(video_path), ss=timestamp)
            .output(str(output_path), vframes=1, format="image2")
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
        return output_path
    except ffmpeg.Error as e:
        logger.error(f"FFmpeg error: {e.stderr.decode() if e.stderr else str(e)}")
        raise


def extract_clip(
    video_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float,
    copy_codec: bool = True,
) -> Path:
    """Extract a clip from the video.

    Args:
        video_path: Source video file
        output_path: Destination for the clip
        start_time: Start timestamp in seconds
        end_time: End timestamp in seconds
        copy_codec: If True, use stream copy (fast). If False, re-encode.
    """
    logger.info(f"Extracting clip {start_time:.2f}s - {end_time:.2f}s")

    duration = end_time - start_time

    try:
        input_stream = ffmpeg.input(str(video_path), ss=start_time, t=duration)

        if copy_codec:
            # Fast extraction using stream copy
            output = input_stream.output(
                str(output_path),
                c="copy",
                avoid_negative_ts="make_zero",
            )
        else:
            # Re-encode for precise cuts
            output = input_stream.output(
                str(output_path),
                vcodec="libx264",
                acodec="aac",
                preset="fast",
                crf=18,
            )

        output.overwrite_output().run(capture_stdout=True, capture_stderr=True)
        logger.info(f"Clip extracted to {output_path}")
        return output_path
    except ffmpeg.Error as e:
        logger.error(f"FFmpeg error: {e.stderr.decode() if e.stderr else str(e)}")
        raise


def get_frames_at_timestamps(
    video_path: Path, timestamps: list[float], output_dir: Path
) -> list[Path]:
    """Extract multiple frames at specific timestamps."""
    output_dir.mkdir(parents=True, exist_ok=True)
    frames = []

    for i, ts in enumerate(timestamps):
        output_path = output_dir / f"frame_{i:04d}_{ts:.3f}.jpg"
        extract_frame(video_path, ts, output_path)
        frames.append(output_path)

    return frames
