"""FFmpeg video operations with VideoProcessor class for handling large video files."""

import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import ffmpeg
from loguru import logger

from backend.core.config import settings


@dataclass
class VideoMetadata:
    """Video file metadata."""

    path: Path
    duration: float
    width: int
    height: int
    fps: float
    codec: str
    has_audio: bool
    audio_sample_rate: Optional[int]
    audio_codec: Optional[str]
    file_size: int
    bitrate: Optional[int]
    pixel_format: Optional[str]

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "path": str(self.path),
            "duration": self.duration,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "codec": self.codec,
            "has_audio": self.has_audio,
            "audio_sample_rate": self.audio_sample_rate,
            "audio_codec": self.audio_codec,
            "file_size": self.file_size,
            "bitrate": self.bitrate,
            "pixel_format": self.pixel_format,
        }


ProgressCallback = Callable[[str, float], None]


class VideoProcessor:
    """Handles video processing operations with progress tracking.

    Designed for large video files (up to 100GB) with:
    - Metadata extraction via ffprobe
    - Audio extraction with progress
    - Frame extraction at specific timestamps
    - Memory-efficient streaming operations
    """

    def __init__(self, video_path: Path):
        """Initialize processor with video path.

        Args:
            video_path: Path to the video file

        Raises:
            FileNotFoundError: If video file doesn't exist
        """
        self.video_path = Path(video_path)
        if not self.video_path.exists():
            raise FileNotFoundError(f"Video file not found: {video_path}")

        self._metadata: Optional[VideoMetadata] = None
        self._probe_data: Optional[dict] = None

    @property
    def metadata(self) -> VideoMetadata:
        """Get video metadata, probing if necessary."""
        if self._metadata is None:
            self._metadata = self.get_metadata()
        return self._metadata

    def get_metadata(self) -> VideoMetadata:
        """Extract comprehensive video metadata using ffprobe.

        Returns:
            VideoMetadata object with all video properties

        Raises:
            ValueError: If no video stream found
            ffmpeg.Error: If ffprobe fails
        """
        try:
            probe = ffmpeg.probe(str(self.video_path))
            self._probe_data = probe

            video_stream = next(
                (s for s in probe["streams"] if s["codec_type"] == "video"), None
            )
            audio_stream = next(
                (s for s in probe["streams"] if s["codec_type"] == "audio"), None
            )

            if not video_stream:
                raise ValueError(f"No video stream found in {self.video_path}")

            # Parse frame rate (handle "30/1", "30000/1001", etc.)
            fps_str = video_stream.get("r_frame_rate", "30/1")
            fps_parts = fps_str.split("/")
            if len(fps_parts) == 2 and fps_parts[1] and float(fps_parts[1]) != 0:
                fps = float(fps_parts[0]) / float(fps_parts[1])
            elif fps_parts[0]:
                fps = float(fps_parts[0])
            else:
                fps = 30.0  # Fallback default

            # Parse bitrate
            bitrate = None
            if "bit_rate" in probe["format"]:
                bitrate = int(probe["format"]["bit_rate"])
            elif "bit_rate" in video_stream:
                bitrate = int(video_stream["bit_rate"])

            return VideoMetadata(
                path=self.video_path,
                duration=float(probe["format"].get("duration", 0)),
                width=int(video_stream.get("width", 0)),
                height=int(video_stream.get("height", 0)),
                fps=fps,
                codec=video_stream.get("codec_name", "unknown"),
                has_audio=audio_stream is not None,
                audio_sample_rate=int(audio_stream.get("sample_rate", 44100)) if audio_stream else None,
                audio_codec=audio_stream.get("codec_name") if audio_stream else None,
                file_size=int(probe["format"].get("size", 0)),
                bitrate=bitrate,
                pixel_format=video_stream.get("pix_fmt"),
            )

        except ffmpeg.Error as e:
            logger.error(f"FFprobe error for {self.video_path}: {e.stderr.decode() if e.stderr else str(e)}")
            raise

    def extract_audio(
        self,
        output_path: Path,
        sample_rate: Optional[int] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> Path:
        """Extract audio track from video as WAV.

        Args:
            output_path: Destination path for WAV file
            sample_rate: Audio sample rate (default: from settings)
            progress_callback: Optional callback(step_name, progress_percent)

        Returns:
            Path to extracted audio file

        Raises:
            ValueError: If video has no audio track
            ffmpeg.Error: If extraction fails
        """
        if not self.metadata.has_audio:
            raise ValueError(f"Video has no audio track: {self.video_path}")

        sample_rate = sample_rate or settings.audio_sample_rate
        logger.info(f"Extracting audio from {self.video_path} at {sample_rate}Hz")

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback("Extracting audio", 0)

        try:
            # Build ffmpeg command with progress monitoring
            process = (
                ffmpeg
                .input(str(self.video_path))
                .output(
                    str(output_path),
                    acodec="pcm_s16le",
                    ar=sample_rate,
                    ac=1,  # Mono for analysis
                )
                .overwrite_output()
                .global_args("-progress", "pipe:1", "-nostats")
                .run_async(pipe_stdout=True, pipe_stderr=True)
            )

            # Parse progress from ffmpeg output
            self._monitor_progress(
                process,
                self.metadata.duration,
                progress_callback,
                "Extracting audio",
            )

            logger.info(f"Audio extracted to {output_path}")
            return output_path

        except ffmpeg.Error as e:
            logger.error(f"Audio extraction error: {e.stderr.decode() if e.stderr else str(e)}")
            raise

    def extract_frame(
        self,
        timestamp: float,
        output_path: Path,
        quality: int = 2,
    ) -> Path:
        """Extract a single frame at the given timestamp.

        Args:
            timestamp: Time in seconds (clamped to video duration)
            output_path: Destination path for image file
            quality: JPEG quality (2 = high quality, 31 = low quality)

        Returns:
            Path to extracted frame

        Raises:
            ffmpeg.Error: If extraction fails
        """
        # Clamp timestamp to valid range
        timestamp = self._clamp_timestamp(timestamp)

        logger.debug(f"Extracting frame at {timestamp:.3f}s from {self.video_path}")

        try:
            (
                ffmpeg
                .input(str(self.video_path), ss=timestamp)
                .output(str(output_path), vframes=1, format="image2", qscale=quality)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            return output_path

        except ffmpeg.Error as e:
            logger.error(f"Frame extraction error at {timestamp}s: {e.stderr.decode() if e.stderr else str(e)}")
            raise

    def extract_frames_at_timestamps(
        self,
        timestamps: list[float],
        output_dir: Path,
        format: str = "jpg",
        progress_callback: Optional[ProgressCallback] = None,
    ) -> list[Path]:
        """Extract multiple frames at specific timestamps.

        Args:
            timestamps: List of times in seconds
            output_dir: Directory for output frames
            format: Image format (jpg, png)
            progress_callback: Optional callback(step_name, progress_percent)

        Returns:
            List of paths to extracted frames
        """
        if not timestamps:
            logger.warning("No timestamps provided for frame extraction")
            return []

        output_dir.mkdir(parents=True, exist_ok=True)
        frames = []
        total = len(timestamps)

        if progress_callback:
            progress_callback("Extracting frames", 0)

        for i, ts in enumerate(timestamps):
            ts = self._clamp_timestamp(ts)
            output_path = output_dir / f"frame_{i:04d}_{ts:.3f}.{format}"

            try:
                self.extract_frame(ts, output_path)
                frames.append(output_path)
            except Exception as e:
                logger.warning(f"Failed to extract frame at {ts}s: {e}")
                continue

            if progress_callback:
                progress = ((i + 1) / total) * 100
                progress_callback("Extracting frames", progress)

        return frames

    def extract_frames_range(
        self,
        start_time: float,
        end_time: float,
        fps: float = 10.0,
        output_dir: Path = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> list[Path]:
        """Extract frames from a time range at specified FPS.

        Useful for extracting frames for visual analysis of a segment.

        Args:
            start_time: Start time in seconds
            end_time: End time in seconds
            fps: Frames per second to extract
            output_dir: Directory for output frames (uses temp if None)
            progress_callback: Optional callback(step_name, progress_percent)

        Returns:
            List of paths to extracted frames
        """
        start_time = self._clamp_timestamp(start_time)
        end_time = self._clamp_timestamp(end_time)

        if end_time <= start_time:
            logger.warning(f"Invalid range: {start_time} to {end_time}")
            return []

        duration = end_time - start_time

        if output_dir is None:
            output_dir = settings.temp_dir / f"frames_{self.video_path.stem}"
        output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Extracting frames from {start_time:.2f}s to {end_time:.2f}s at {fps} FPS")

        if progress_callback:
            progress_callback("Extracting frame range", 0)

        try:
            # Use ffmpeg's fps filter for efficient extraction
            output_pattern = str(output_dir / "frame_%04d.jpg")

            process = (
                ffmpeg
                .input(str(self.video_path), ss=start_time, t=duration)
                .filter("fps", fps=fps)
                .output(output_pattern, format="image2", qscale=2)
                .overwrite_output()
                .global_args("-progress", "pipe:1", "-nostats")
                .run_async(pipe_stdout=True, pipe_stderr=True)
            )

            self._monitor_progress(
                process,
                duration,
                progress_callback,
                "Extracting frame range",
            )

            # Collect output files
            frames = sorted(output_dir.glob("frame_*.jpg"))
            logger.info(f"Extracted {len(frames)} frames")
            return frames

        except ffmpeg.Error as e:
            logger.error(f"Frame range extraction error: {e.stderr.decode() if e.stderr else str(e)}")
            raise

    def _clamp_timestamp(self, timestamp: float) -> float:
        """Clamp timestamp to valid video range.

        Args:
            timestamp: Time in seconds

        Returns:
            Timestamp clamped to [0, duration]
        """
        if timestamp < 0:
            return 0.0
        if timestamp > self.metadata.duration:
            return max(0, self.metadata.duration - 0.001)
        return timestamp

    def _monitor_progress(
        self,
        process,
        total_duration: float,
        progress_callback: Optional[ProgressCallback],
        step_name: str,
    ) -> None:
        """Monitor ffmpeg process and report progress.

        Args:
            process: ffmpeg async process
            total_duration: Expected duration for progress calculation
            progress_callback: Callback for progress updates
            step_name: Name of current operation
        """
        if progress_callback is None:
            # Just wait for completion
            _, stderr = process.communicate()
            if process.returncode != 0:
                raise ffmpeg.Error("ffmpeg", stdout=b"", stderr=stderr)
            return

        # Parse progress output
        time_pattern = re.compile(r"out_time_ms=(\d+)")
        last_progress = 0

        try:
            while True:
                line = process.stdout.readline()
                if not line:
                    break

                line = line.decode("utf-8", errors="ignore")
                match = time_pattern.search(line)

                if match and total_duration > 0:
                    time_ms = int(match.group(1))
                    time_sec = time_ms / 1_000_000
                    progress = min(100, (time_sec / total_duration) * 100)

                    if progress - last_progress >= 1:  # Report every 1%
                        progress_callback(step_name, progress)
                        last_progress = progress

            process.wait()

            if process.returncode != 0:
                stderr = process.stderr.read() if process.stderr else b""
                raise ffmpeg.Error("ffmpeg", stdout=b"", stderr=stderr)

            progress_callback(step_name, 100)

        except Exception as e:
            logger.error(f"Progress monitoring error: {e}")
            process.wait()
            raise

    def cleanup_temp_files(self, output_dir: Optional[Path] = None) -> int:
        """Clean up temporary files created during processing.

        Args:
            output_dir: Specific directory to clean. If None, cleans the
                       default temp directory for this video.

        Returns:
            Number of files/directories removed.
        """
        if output_dir is None:
            output_dir = settings.temp_dir / f"frames_{self.video_path.stem}"

        if not output_dir.exists():
            logger.debug(f"No temp directory to clean: {output_dir}")
            return 0

        removed = 0
        try:
            if output_dir.is_dir():
                # Count files before removal
                removed = sum(1 for _ in output_dir.rglob("*") if _.is_file())
                shutil.rmtree(output_dir)
                logger.info(f"Cleaned up {removed} temp files from {output_dir}")
            else:
                output_dir.unlink()
                removed = 1
                logger.info(f"Removed temp file: {output_dir}")
        except Exception as e:
            logger.warning(f"Failed to clean up temp files: {e}")

        return removed


# --- Legacy function interface for backwards compatibility ---

def get_video_info(video_path: Path) -> dict:
    """Get video metadata using ffprobe.

    Legacy function - consider using VideoProcessor for new code.
    """
    processor = VideoProcessor(video_path)
    metadata = processor.get_metadata()
    return {
        "duration": metadata.duration,
        "width": metadata.width,
        "height": metadata.height,
        "fps": metadata.fps,
        "codec": metadata.codec,
        "has_audio": metadata.has_audio,
        "audio_sample_rate": metadata.audio_sample_rate,
        "file_size": metadata.file_size,
    }


def extract_audio(video_path: Path, output_path: Path) -> Path:
    """Extract audio track from video as WAV.

    Legacy function - consider using VideoProcessor for new code.
    """
    processor = VideoProcessor(video_path)
    return processor.extract_audio(output_path)


def extract_frame(video_path: Path, timestamp: float, output_path: Path) -> Path:
    """Extract a single frame at the given timestamp.

    Legacy function - consider using VideoProcessor for new code.
    """
    processor = VideoProcessor(video_path)
    return processor.extract_frame(timestamp, output_path)


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

    Returns:
        Path to extracted clip
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
    """Extract multiple frames at specific timestamps.

    Legacy function - consider using VideoProcessor for new code.
    """
    processor = VideoProcessor(video_path)
    return processor.extract_frames_at_timestamps(timestamps, output_dir)
