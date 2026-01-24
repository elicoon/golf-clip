"""Clip extraction and export with progress tracking and quality control."""

import re
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from queue import Queue, Empty
from typing import Callable, Optional

import ffmpeg
from loguru import logger

from backend.api.schemas import ClipBoundary, HoleInfo
from backend.core.config import settings
from backend.core.video import VideoProcessor, VideoMetadata
from backend.processing.tracer import TracerExporter, TracerStyle


ProgressCallback = Callable[[str, float], None]


@dataclass
class ClipExportSettings:
    """Configuration for clip export encoding."""

    # Video settings
    video_codec: str = "libx264"
    video_preset: str = "medium"  # ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
    video_crf: int = 18  # 0-51, lower = higher quality, 18-23 recommended
    video_profile: str = "high"  # baseline, main, high
    video_level: str = "4.1"  # H.264 level for compatibility

    # Audio settings
    audio_codec: str = "aac"
    audio_bitrate: str = "192k"
    audio_sample_rate: int = 48000

    # Output settings
    match_source_resolution: bool = True
    max_width: Optional[int] = None  # Limit output width (preserves aspect ratio)
    max_height: Optional[int] = None  # Limit output height

    # Processing
    use_copy_codec: bool = False  # True for fast but potentially imprecise cuts
    # TODO: Implement two-pass encoding for better quality at target bitrates
    two_pass: bool = False


@dataclass
class ExportResult:
    """Result of a clip export operation."""

    success: bool
    output_path: Optional[Path]
    shot_id: int
    duration: float
    file_size: int = 0
    error_message: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "output_path": str(self.output_path) if self.output_path else None,
            "shot_id": self.shot_id,
            "duration": self.duration,
            "file_size": self.file_size,
            "error_message": self.error_message,
        }


class ClipExporter:
    """Exports video clips with progress tracking and quality control.

    Handles:
    - H.264 MP4 encoding matching input resolution
    - Progress callbacks for long operations
    - Edge cases (start/end of video, very short clips)
    - Batch operations with detailed results
    """

    # Minimum clip duration in seconds
    MIN_CLIP_DURATION = 0.5

    def __init__(
        self,
        video_path: Path,
        settings: Optional[ClipExportSettings] = None,
    ):
        """Initialize exporter with video file.

        Args:
            video_path: Source video file
            settings: Export encoding settings (uses defaults if None)
        """
        self.video_path = Path(video_path)
        self.processor = VideoProcessor(video_path)
        self.export_settings = settings or ClipExportSettings()

        # Cache video metadata
        self._metadata: Optional[VideoMetadata] = None

    @property
    def metadata(self) -> VideoMetadata:
        """Get source video metadata."""
        if self._metadata is None:
            self._metadata = self.processor.get_metadata()
        return self._metadata

    def export_clip(
        self,
        start_time: float,
        end_time: float,
        output_path: Path,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> ExportResult:
        """Export a single clip with H.264 encoding.

        Args:
            start_time: Clip start time in seconds
            end_time: Clip end time in seconds
            output_path: Destination path for the clip
            progress_callback: Optional callback(step_name, progress_percent)

        Returns:
            ExportResult with success status and details
        """
        # Validate and clamp timestamps
        start_time, end_time = self._validate_clip_boundaries(start_time, end_time)
        duration = end_time - start_time

        if duration < self.MIN_CLIP_DURATION:
            logger.warning(f"Clip too short ({duration:.2f}s), minimum is {self.MIN_CLIP_DURATION}s")
            return ExportResult(
                success=False,
                output_path=None,
                shot_id=-1,
                duration=duration,
                error_message=f"Clip duration ({duration:.2f}s) below minimum ({self.MIN_CLIP_DURATION}s)",
            )

        logger.info(f"Exporting clip {start_time:.2f}s - {end_time:.2f}s ({duration:.2f}s)")

        if progress_callback:
            progress_callback("Encoding clip", 0)

        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)

            if self.export_settings.use_copy_codec:
                self._export_copy_codec(start_time, duration, output_path)
            else:
                self._export_reencode(
                    start_time,
                    duration,
                    output_path,
                    progress_callback,
                )

            # Verify output file
            if not output_path.exists():
                raise RuntimeError("Output file not created")

            file_size = output_path.stat().st_size
            logger.info(f"Clip exported to {output_path} ({file_size / 1024 / 1024:.2f} MB)")

            if progress_callback:
                progress_callback("Encoding clip", 100)

            return ExportResult(
                success=True,
                output_path=output_path,
                shot_id=-1,
                duration=duration,
                file_size=file_size,
            )

        except Exception as e:
            logger.error(f"Clip export failed: {e}")
            return ExportResult(
                success=False,
                output_path=None,
                shot_id=-1,
                duration=duration,
                error_message=str(e),
            )

    def export_clip_with_tracer(
        self,
        start_time: float,
        end_time: float,
        output_path: Path,
        trajectory_points: list[dict],
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
        tracer_style: Optional[dict] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> "ExportResult":
        """Export a clip with shot tracer overlay.

        Args:
            start_time: Clip start in seconds
            end_time: Clip end in seconds
            output_path: Where to save output
            trajectory_points: Normalized trajectory points
            frame_width: Source video width
            frame_height: Source video height
            apex_point: Optional apex point for marker
            tracer_style: Optional style configuration dict
            progress_callback: Progress callback

        Returns:
            ExportResult with status
        """
        output_path = Path(output_path)
        duration = end_time - start_time

        try:
            # Create style from dict if provided
            style = None
            if tracer_style:
                style = TracerStyle.from_dict(tracer_style)

            # Create exporter and render
            exporter = TracerExporter(self.video_path, style)

            def tracer_progress(p: float):
                if progress_callback:
                    progress_callback("Rendering tracer", p)

            exporter.export_with_tracer(
                output_path=output_path,
                start_time=start_time,
                end_time=end_time,
                trajectory_points=trajectory_points,
                frame_width=frame_width,
                frame_height=frame_height,
                apex_point=apex_point,
                progress_callback=tracer_progress,
            )

            # Get file size if export succeeded
            file_size = 0
            if output_path.exists():
                file_size = output_path.stat().st_size

            return ExportResult(
                success=True,
                output_path=output_path,
                shot_id=-1,
                duration=duration,
                file_size=file_size,
            )

        except Exception as e:
            logger.exception(f"Failed to export clip with tracer: {e}")
            return ExportResult(
                success=False,
                output_path=output_path,
                shot_id=-1,
                duration=duration,
                error_message=str(e),
            )

    def export_clips(
        self,
        clips: list[ClipBoundary],
        output_dir: Path,
        filename_pattern: str = "shot_{shot_id:02d}",
        hole_info: Optional[HoleInfo] = None,
        progress_callback: Optional[ProgressCallback] = None,
        skip_unapproved: bool = True,
    ) -> list[ExportResult]:
        """Export multiple clips from the video.

        Args:
            clips: List of clip boundaries to export
            output_dir: Directory to save clips
            filename_pattern: Pattern for clip filenames (supports {shot_id}, {hole}, {shot})
            hole_info: Optional hole information for naming
            progress_callback: Optional callback(step_name, progress_percent)
            skip_unapproved: Whether to skip unapproved clips

        Returns:
            List of ExportResult for each clip
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        results = []

        # Filter to approved clips if requested
        clips_to_export = clips
        if skip_unapproved:
            clips_to_export = [c for c in clips if c.approved]
            skipped = len(clips) - len(clips_to_export)
            if skipped > 0:
                logger.info(f"Skipping {skipped} unapproved clips")

        total = len(clips_to_export)
        if total == 0:
            logger.warning("No clips to export")
            return results

        logger.info(f"Exporting {total} clips to {output_dir}")

        for i, clip in enumerate(clips_to_export):
            if progress_callback:
                overall_progress = (i / total) * 100
                progress_callback(f"Exporting clip {i + 1}/{total}", overall_progress)

            # Build filename
            filename = self._build_filename(filename_pattern, clip, hole_info)
            output_path = output_dir / f"{filename}.mp4"

            # Export with per-clip progress
            # Use default args to capture current values (avoid closure variable capture bug)
            def clip_progress(step: str, progress: float, _i: int = i, _total: int = total):
                if progress_callback:
                    # Map clip progress to overall progress
                    clip_contribution = (1 / _total) * 100
                    base = (_i / _total) * 100
                    overall = base + (progress / 100) * clip_contribution
                    progress_callback(f"Exporting clip {_i + 1}/{_total}: {step}", overall)

            result = self.export_clip(
                clip.start_time,
                clip.end_time,
                output_path,
                progress_callback=clip_progress if progress_callback else None,
            )
            result.shot_id = clip.shot_id
            results.append(result)

            if result.success:
                logger.info(f"Exported clip {clip.shot_id} to {output_path}")
            else:
                logger.error(f"Failed to export clip {clip.shot_id}: {result.error_message}")

        if progress_callback:
            progress_callback("Export complete", 100)

        # Summary
        successful = sum(1 for r in results if r.success)
        logger.info(f"Export complete: {successful}/{total} clips successful")

        return results

    def _validate_clip_boundaries(
        self,
        start_time: float,
        end_time: float,
    ) -> tuple[float, float]:
        """Validate and clamp clip boundaries to video duration.

        Handles edge cases:
        - Negative start times
        - End time past video duration
        - Start time past end time

        Args:
            start_time: Requested start time
            end_time: Requested end time

        Returns:
            Tuple of (clamped_start, clamped_end)
        """
        duration = self.metadata.duration

        # Clamp start time
        if start_time < 0:
            logger.warning(f"Start time {start_time}s clamped to 0")
            start_time = 0.0

        if start_time >= duration:
            logger.warning(f"Start time {start_time}s past video duration {duration}s")
            start_time = max(0, duration - 1.0)

        # Clamp end time
        if end_time <= start_time:
            logger.warning(f"End time {end_time}s <= start time {start_time}s, adjusting")
            end_time = min(start_time + self.MIN_CLIP_DURATION, duration)

        if end_time > duration:
            logger.warning(f"End time {end_time}s clamped to duration {duration}s")
            end_time = duration

        return start_time, end_time

    def _build_filename(
        self,
        pattern: str,
        clip: ClipBoundary,
        hole_info: Optional[HoleInfo],
    ) -> str:
        """Build filename from pattern and clip info.

        Args:
            pattern: Filename pattern with placeholders
            clip: Clip boundary data
            hole_info: Optional hole information

        Returns:
            Formatted filename (without extension)
        """
        # Build format kwargs
        kwargs = {
            "shot_id": clip.shot_id,
            "start": int(clip.start_time),
            "end": int(clip.end_time),
        }

        if hole_info:
            kwargs.update({
                "hole": hole_info.hole_number,
                "shot": hole_info.shot_number,
                "par": hole_info.par or 0,
                "yardage": hole_info.yardage,
            })

        try:
            return pattern.format(**kwargs)
        except KeyError as e:
            logger.warning(f"Invalid filename pattern key: {e}, using default")
            return f"shot_{clip.shot_id:02d}"

    def _export_copy_codec(
        self,
        start_time: float,
        duration: float,
        output_path: Path,
    ) -> None:
        """Export clip using stream copy (fast but may have keyframe issues).

        Args:
            start_time: Start time in seconds
            duration: Duration in seconds
            output_path: Destination path
        """
        (
            ffmpeg
            .input(str(self.video_path), ss=start_time, t=duration)
            .output(
                str(output_path),
                c="copy",
                avoid_negative_ts="make_zero",
                movflags="+faststart",
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )

    def _export_reencode(
        self,
        start_time: float,
        duration: float,
        output_path: Path,
        progress_callback: Optional[ProgressCallback],
    ) -> None:
        """Export clip with H.264 re-encoding.

        Args:
            start_time: Start time in seconds
            duration: Duration in seconds
            output_path: Destination path
            progress_callback: Optional progress callback
        """
        export_settings = self.export_settings

        # Build input stream
        input_stream = ffmpeg.input(str(self.video_path), ss=start_time, t=duration)

        # Build video stream with filters
        video = input_stream.video

        # Apply resolution limits if specified
        if export_settings.max_width or export_settings.max_height:
            scale_parts = []
            if export_settings.max_width:
                scale_parts.append(f"min({export_settings.max_width},iw)")
            else:
                scale_parts.append("-2")
            if export_settings.max_height:
                scale_parts.append(f"min({export_settings.max_height},ih)")
            else:
                scale_parts.append("-2")

            video = video.filter(
                "scale",
                scale_parts[0],
                scale_parts[1],
                force_original_aspect_ratio="decrease",
            )

        # Build output with H.264 settings
        output_kwargs = {
            "vcodec": export_settings.video_codec,
            "preset": export_settings.video_preset,
            "crf": export_settings.video_crf,
            "profile:v": export_settings.video_profile,
            "level": export_settings.video_level,
            "movflags": "+faststart",  # Fast start for web playback
            "pix_fmt": "yuv420p",  # Compatibility
        }

        # Only add audio settings if video has audio
        if self.metadata.has_audio:
            output_kwargs.update({
                "acodec": export_settings.audio_codec,
                "audio_bitrate": export_settings.audio_bitrate,
                "ar": export_settings.audio_sample_rate,
            })
            output_streams = [video, input_stream.audio]
        else:
            output_kwargs["an"] = None  # No audio
            output_streams = [video]

        if progress_callback:
            # Use async process for progress monitoring
            process = (
                ffmpeg
                .output(*output_streams, str(output_path), **output_kwargs)
                .overwrite_output()
                .global_args("-progress", "pipe:1", "-nostats")
                .run_async(pipe_stdout=True, pipe_stderr=True)
            )

            self._monitor_encode_progress(process, duration, progress_callback)
        else:
            # Simple synchronous encoding
            (
                ffmpeg
                .output(*output_streams, str(output_path), **output_kwargs)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )

    def _monitor_encode_progress(
        self,
        process,
        total_duration: float,
        progress_callback: ProgressCallback,
    ) -> None:
        """Monitor ffmpeg encoding progress.

        Uses a separate thread for reading to avoid blocking on Windows
        where pipe buffers can cause deadlocks.

        Args:
            process: ffmpeg async process
            total_duration: Expected clip duration
            progress_callback: Progress callback function
        """
        time_pattern = re.compile(r"out_time_ms=(\d+)")
        last_progress = 0
        timeout = settings.ffmpeg_timeout or 600

        # Queue for inter-thread communication
        line_queue: Queue = Queue()
        stderr_output: list[bytes] = []

        def reader_thread(stream, queue, is_stderr=False):
            """Read from stream and put lines in queue."""
            try:
                for line in iter(stream.readline, b""):
                    if is_stderr:
                        stderr_output.append(line)
                    else:
                        queue.put(line)
            finally:
                if not is_stderr:
                    queue.put(None)  # Signal end of stream

        # Start reader threads
        stdout_thread = threading.Thread(
            target=reader_thread, args=(process.stdout, line_queue), daemon=True
        )
        stderr_thread = threading.Thread(
            target=reader_thread, args=(process.stderr, line_queue, True), daemon=True
        )
        stdout_thread.start()
        stderr_thread.start()

        try:
            while True:
                try:
                    line = line_queue.get(timeout=timeout)
                except Empty:
                    logger.error(f"FFmpeg encoding timed out after {timeout}s")
                    process.kill()
                    raise TimeoutError(f"FFmpeg encoding timed out after {timeout}s")

                if line is None:  # End of stream
                    break

                line_str = line.decode("utf-8", errors="ignore")
                match = time_pattern.search(line_str)

                if match and total_duration > 0:
                    time_ms = int(match.group(1))
                    time_sec = time_ms / 1_000_000
                    progress = min(100, (time_sec / total_duration) * 100)

                    if progress - last_progress >= 2:  # Report every 2%
                        progress_callback("Encoding", progress)
                        last_progress = progress

            process.wait(timeout=30)

            if process.returncode != 0:
                stderr = b"".join(stderr_output)
                raise ffmpeg.Error("ffmpeg", stdout=b"", stderr=stderr)

        except TimeoutError:
            raise
        except Exception as e:
            logger.error(f"Encoding progress error: {e}")
            process.kill()
            process.wait()
            raise

    def cleanup_temp_files(self, output_dir: Optional[Path] = None) -> int:
        """Clean up temporary files created during export.

        Delegates to the underlying VideoProcessor cleanup, but can also
        clean export-specific directories.

        Args:
            output_dir: Specific directory to clean. If None, cleans the
                       processor's default temp directory.

        Returns:
            Number of files/directories removed.
        """
        return self.processor.cleanup_temp_files(output_dir)


# --- Legacy function interface for backwards compatibility ---

def export_clips(
    video_path: Path,
    clips: list[ClipBoundary],
    output_dir: Path,
    filename_pattern: str = "hole{hole}_shot{shot}",
    hole_info: Optional[HoleInfo] = None,
) -> list[Path]:
    """Export multiple clips from a video.

    Legacy function - consider using ClipExporter for new code.

    Args:
        video_path: Source video file
        clips: List of clip boundaries to export
        output_dir: Directory to save clips
        filename_pattern: Pattern for clip filenames
        hole_info: Optional hole information for naming

    Returns:
        List of paths to exported clips
    """
    exporter = ClipExporter(video_path)
    results = exporter.export_clips(
        clips,
        output_dir,
        filename_pattern=filename_pattern,
        hole_info=hole_info,
    )
    return [r.output_path for r in results if r.success and r.output_path]


def batch_export(
    jobs: list[dict],
    output_dir: Path,
) -> dict:
    """Export clips from multiple jobs.

    Args:
        jobs: List of job dicts with video_path, clips, hole_info
        output_dir: Base output directory

    Returns:
        Summary dict with counts and paths
    """
    total_exported = 0
    all_paths = []

    for job in jobs:
        video_path = Path(job["video_path"])
        clips = [ClipBoundary(**c) for c in job["clips"]]
        hole_info = HoleInfo(**job["hole_info"]) if job.get("hole_info") else None

        # Create subdirectory for this video
        if hole_info:
            subdir = output_dir / f"hole_{hole_info.hole_number:02d}"
        else:
            subdir = output_dir / video_path.stem

        exported = export_clips(video_path, clips, subdir, hole_info=hole_info)
        total_exported += len(exported)
        all_paths.extend(exported)

    return {
        "total_exported": total_exported,
        "paths": [str(p) for p in all_paths],
    }
