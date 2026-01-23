"""Clip extraction and processing."""

from pathlib import Path
from typing import Optional

from loguru import logger

from backend.api.schemas import ClipBoundary, HoleInfo
from backend.core.video import extract_clip


def export_clips(
    video_path: Path,
    clips: list[ClipBoundary],
    output_dir: Path,
    filename_pattern: str = "hole{hole}_shot{shot}",
    hole_info: Optional[HoleInfo] = None,
) -> list[Path]:
    """Export multiple clips from a video.

    Args:
        video_path: Source video file
        clips: List of clip boundaries to export
        output_dir: Directory to save clips
        filename_pattern: Pattern for clip filenames
        hole_info: Optional hole information for naming

    Returns:
        List of paths to exported clips
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    exported = []

    for clip in clips:
        if not clip.approved:
            logger.info(f"Skipping unapproved clip {clip.shot_id}")
            continue

        # Build filename
        if hole_info:
            filename = filename_pattern.format(
                hole=hole_info.hole_number,
                shot=clip.shot_id,
            )
        else:
            filename = f"shot_{clip.shot_id:02d}"

        output_path = output_dir / f"{filename}.mp4"

        try:
            extract_clip(
                video_path,
                output_path,
                clip.start_time,
                clip.end_time,
                copy_codec=True,  # Fast extraction
            )
            exported.append(output_path)
            logger.info(f"Exported clip {clip.shot_id} to {output_path}")
        except Exception as e:
            logger.error(f"Failed to export clip {clip.shot_id}: {e}")

    return exported


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
