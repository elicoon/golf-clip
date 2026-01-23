"""API routes for GolfClip."""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from loguru import logger

from backend.api.schemas import (
    ClipBoundary,
    DetectedShot,
    ExportClipsRequest,
    HoleInfo,
    ProcessingStatus,
    ProcessVideoRequest,
    ProcessVideoResponse,
    VideoInfo,
)
from backend.core.config import settings
from backend.core.video import extract_clip, get_video_info
from backend.detection.pipeline import ShotDetectionPipeline

router = APIRouter()

# In-memory job storage (replace with proper storage for production)
jobs: dict[str, dict] = {}


@router.post("/process", response_model=ProcessVideoResponse)
async def process_video(request: ProcessVideoRequest, background_tasks: BackgroundTasks):
    """Start processing a video file to detect shots."""
    video_path = Path(request.video_path)

    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    # Get video info
    try:
        info = get_video_info(video_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read video: {e}")

    # Create job
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "video_path": str(video_path),
        "output_dir": request.output_dir or str(video_path.parent / "golfclip_output"),
        "status": "pending",
        "progress": 0,
        "current_step": "Initializing",
        "shots": [],
        "video_info": info,
        "auto_approve": request.auto_approve_high_confidence,
    }

    # Start processing in background
    background_tasks.add_task(run_detection_pipeline, job_id)

    return ProcessVideoResponse(
        job_id=job_id,
        status=ProcessingStatus(
            video_path=str(video_path),
            status="pending",
            progress=0,
            current_step="Initializing",
        ),
        video_info=VideoInfo(path=str(video_path), **info),
    )


async def run_detection_pipeline(job_id: str):
    """Run the shot detection pipeline in the background."""
    job = jobs.get(job_id)
    if not job:
        return

    try:
        job["status"] = "processing"
        job["current_step"] = "Loading video"

        pipeline = ShotDetectionPipeline(Path(job["video_path"]))

        # Update progress callback
        def on_progress(step: str, progress: float):
            job["current_step"] = step
            job["progress"] = progress

        shots = await pipeline.detect_shots(progress_callback=on_progress)

        job["shots"] = [shot.model_dump() for shot in shots]
        job["progress"] = 100

        # Check how many need review
        needs_review = sum(1 for s in shots if s.confidence < settings.confidence_threshold)
        job["total_shots_detected"] = len(shots)
        job["shots_needing_review"] = needs_review

        if needs_review > 0:
            job["status"] = "review"
            job["current_step"] = f"{needs_review} shots need review"
        else:
            job["status"] = "complete"
            job["current_step"] = "Detection complete"

    except Exception as e:
        logger.exception(f"Error processing job {job_id}")
        job["status"] = "error"
        job["error_message"] = str(e)


@router.get("/status/{job_id}", response_model=ProcessingStatus)
async def get_status(job_id: str):
    """Get the current status of a processing job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return ProcessingStatus(
        video_path=job["video_path"],
        status=job["status"],
        progress=job["progress"],
        current_step=job["current_step"],
        total_shots_detected=job.get("total_shots_detected", 0),
        shots_needing_review=job.get("shots_needing_review", 0),
        error_message=job.get("error_message"),
    )


@router.get("/shots/{job_id}", response_model=list[DetectedShot])
async def get_detected_shots(job_id: str):
    """Get all detected shots for a job."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return [DetectedShot(**shot) for shot in job.get("shots", [])]


@router.post("/shots/{job_id}/update")
async def update_shot_boundaries(job_id: str, boundaries: list[ClipBoundary]):
    """Update clip boundaries after user review."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Update shot boundaries
    for boundary in boundaries:
        for shot in job["shots"]:
            if shot["id"] == boundary.shot_id:
                shot["clip_start"] = boundary.start_time
                shot["clip_end"] = boundary.end_time
                if boundary.approved:
                    shot["confidence"] = 1.0  # User-approved = 100% confidence

    # Check if all shots are now approved
    all_approved = all(s["confidence"] >= settings.confidence_threshold for s in job["shots"])
    if all_approved:
        job["status"] = "complete"
        job["shots_needing_review"] = 0

    return {"status": "updated", "all_approved": all_approved}


@router.post("/export")
async def export_clips(request: ExportClipsRequest, background_tasks: BackgroundTasks):
    """Export confirmed clips to the output directory."""
    job = jobs.get(request.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    output_dir = Path(request.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    video_path = Path(job["video_path"])
    exported = []

    for clip in request.clips:
        if not clip.approved:
            continue

        filename = request.filename_pattern.format(shot_id=clip.shot_id) + ".mp4"
        output_path = output_dir / filename

        try:
            extract_clip(video_path, output_path, clip.start_time, clip.end_time)
            exported.append(str(output_path))
        except Exception as e:
            logger.error(f"Failed to export clip {clip.shot_id}: {e}")

    return {"exported": exported, "count": len(exported)}


@router.get("/video-info")
async def get_video_info_endpoint(path: str):
    """Get metadata for a video file."""
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    try:
        info = get_video_info(video_path)
        return VideoInfo(path=str(video_path), **info)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read video: {e}")
