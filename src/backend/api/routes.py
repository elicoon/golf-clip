"""API routes for GolfClip."""

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, List, Optional

import shutil
import tempfile

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, UploadFile, File, Request
from fastapi.responses import StreamingResponse, FileResponse
from loguru import logger

from backend.api.schemas import (
    BatchUploadResponse,
    ClipBoundary,
    DetectedShot,
    ExportClipsRequest,
    ExportJobResponse,
    ExportJobStatus,
    FeedbackExportResponse,
    FeedbackStats,
    HoleInfo,
    JobError,
    ProcessingStatus,
    ProcessVideoRequest,
    ProcessVideoResponse,
    ProgressEvent,
    ShotFeedbackRequest,
    ShotFeedbackResponse,
    TracerFeedbackExportResponse,
    TracerFeedbackRequest,
    TracerFeedbackResponse,
    TracerFeedbackStats,
    TrajectoryData,
    TrajectoryPoint,
    TrajectoryUpdateRequest,
    UploadedFile,
    UploadError,
    VideoInfo,
)
from backend.core.config import settings
from backend.core.environment import get_environment
from backend.core.video import extract_clip, get_video_info
from backend.processing.clips import ClipExporter
from backend.detection.pipeline import ShotDetectionPipeline
from backend.models.job import (
    create_feedback,
    create_job,
    create_shots,
    delete_job,
    get_all_feedback,
    get_all_jobs,
    get_feedback_for_job,
    get_feedback_stats,
    get_job,
    get_shots_for_job,
    update_job,
    update_shot,
)
from backend.models.trajectory import (
    create_tracer_feedback,
    export_tracer_feedback,
    get_tracer_feedback_for_job,
    get_trajectory,
    get_trajectories_for_job,
    update_trajectory as update_trajectory_db,
)

router = APIRouter()

def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


# In-memory job cache for active jobs (synced with database)
# This provides fast access during processing while database provides persistence
_job_cache: dict[str, dict] = {}

# Event queues for SSE streaming per job
_progress_queues: dict[str, asyncio.Queue] = {}

# In-memory storage for export jobs (transient, no persistence needed)
_export_jobs: dict[str, dict] = {}


def _get_cached_job(job_id: str) -> Optional[dict]:
    """Get a job from the in-memory cache."""
    return _job_cache.get(job_id)


def _cache_job(job_id: str, job: dict) -> None:
    """Add or update a job in the in-memory cache."""
    _job_cache[job_id] = job


def _remove_from_cache(job_id: str) -> None:
    """Remove a job from the in-memory cache."""
    _job_cache.pop(job_id, None)


async def _emit_progress(job_id: str, step: str, progress: float, details: Optional[str] = None):
    """Emit a progress event to the SSE queue for a job."""
    if job_id in _progress_queues:
        event = ProgressEvent(
            job_id=job_id,
            step=step,
            progress=progress,
            details=details,
            timestamp=datetime.utcnow().isoformat(),
        )
        try:
            _progress_queues[job_id].put_nowait(event)
        except asyncio.QueueFull:
            # Queue is full, skip this event (client is slow)
            logger.warning(f"Progress queue full for job {job_id}, skipping event")


# Directory for uploaded videos
_UPLOAD_DIR = Path(tempfile.gettempdir()) / "golfclip_uploads"


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing.

    Returns the server path where the file was saved, which can then be
    passed to /process endpoint.
    """
    # Validate file type
    allowed_extensions = {".mp4", ".mov", ".m4v"}
    file_ext = Path(file.filename or "").suffix.lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    # Create upload directory if needed
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Generate unique filename to avoid collisions
    unique_id = str(uuid.uuid4())[:8]
    safe_filename = f"{unique_id}_{file.filename}"
    file_path = _UPLOAD_DIR / safe_filename

    try:
        # Stream file to disk to handle large files
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        logger.info(f"Uploaded video saved to {file_path}")

        return {
            "path": str(file_path),
            "filename": file.filename,
            "size": file_path.stat().st_size,
        }

    except Exception as e:
        # Clean up on error
        if file_path.exists():
            file_path.unlink()
        logger.exception(f"Failed to save uploaded file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")


@router.post("/upload-batch", response_model=BatchUploadResponse)
async def upload_videos_batch(files: List[UploadFile] = File(...)):
    """Upload multiple video files for processing.

    Handles errors per-file without failing the entire batch.
    Returns arrays of successful uploads and errors.
    """
    allowed_extensions = {".mp4", ".mov", ".m4v"}
    uploaded: list[UploadedFile] = []
    errors: list[UploadError] = []

    # Create upload directory if needed
    _UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    for file in files:
        filename = file.filename or "unknown"

        # Validate file type
        file_ext = Path(filename).suffix.lower()
        if file_ext not in allowed_extensions:
            errors.append(UploadError(
                filename=filename,
                error=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
            ))
            continue

        # Generate unique filename to avoid collisions
        # Sanitize filename to prevent path traversal attacks
        unique_id = str(uuid.uuid4())[:8]
        clean_basename = Path(filename).name  # Remove any directory components
        # Remove potentially dangerous characters, keep only alphanumeric, dash, underscore, dot, space
        import re
        clean_basename = re.sub(r'[^\w\-_\. ]', '', clean_basename)
        if not clean_basename or clean_basename.startswith('.'):
            clean_basename = f"video{file_ext}"
        safe_filename = f"{unique_id}_{clean_basename}"
        file_path = _UPLOAD_DIR / safe_filename

        try:
            # Stream file to disk to handle large files
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            file_size = file_path.stat().st_size
            logger.info(f"Uploaded video saved to {file_path} ({file_size} bytes)")

            uploaded.append(UploadedFile(
                filename=filename,
                path=str(file_path),
                size=file_size,
            ))

        except Exception as e:
            # Clean up on error
            if file_path.exists():
                file_path.unlink()
            logger.exception(f"Failed to save uploaded file {filename}: {e}")
            errors.append(UploadError(
                filename=filename,
                error=str(e)
            ))

    logger.info(f"Batch upload complete: {len(uploaded)} uploaded, {len(errors)} errors")

    return BatchUploadResponse(uploaded=uploaded, errors=errors)


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
        logger.exception(f"Failed to read video metadata: {video_path}")
        raise HTTPException(status_code=400, detail=f"Could not read video: {e}")

    # Create job in database
    job_id = str(uuid.uuid4())
    output_dir = request.output_dir or str(video_path.parent / "golfclip_output")

    job = await create_job(
        job_id=job_id,
        video_path=str(video_path),
        output_dir=output_dir,
        auto_approve=request.auto_approve_high_confidence,
        video_info=info,
    )

    # Cache for fast access during processing
    _cache_job(job_id, job)

    # Create SSE queue for this job
    _progress_queues[job_id] = asyncio.Queue(maxsize=100)

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
    # Get from cache or database
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id)
        if not job:
            logger.error(f"Job {job_id} not found when starting pipeline")
            return
        _cache_job(job_id, job)

    try:
        # Update status to processing
        job["status"] = "processing"
        job["started_at"] = datetime.utcnow().isoformat()
        job["current_step"] = "Loading video"

        await update_job(
            job_id,
            status="processing",
            started_at=job["started_at"],
            current_step="Loading video",
        )

        await _emit_progress(job_id, "Loading video", 0)

        # Check for cancellation
        if job.get("cancelled"):
            job["status"] = "cancelled"
            job["completed_at"] = datetime.utcnow().isoformat()
            await update_job(job_id, status="cancelled", completed_at=job["completed_at"])
            await _emit_progress(job_id, "Cancelled", 0)
            return

        pipeline = ShotDetectionPipeline(Path(job["video_path"]))

        # Progress callback that updates job and emits SSE events
        async def on_progress(step: str, progress: float):
            if job.get("cancelled"):
                raise asyncio.CancelledError("Job cancelled by user")

            job["current_step"] = step
            job["progress"] = progress
            await _emit_progress(job_id, step, progress)

        # Wrapper to handle async progress callback in sync context
        def sync_progress_callback(step: str, progress: float):
            job["current_step"] = step
            job["progress"] = progress

            # Update database periodically (every 5% progress)
            # to avoid too many DB writes during processing
            if int(progress) % 5 == 0:
                asyncio.create_task(
                    update_job(job_id, current_step=step, progress=progress)
                )

            # Schedule the async emit in the event loop
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(_emit_progress(job_id, step, progress))
            except RuntimeError:
                pass  # No event loop, skip SSE

        shots = await pipeline.detect_shots(progress_callback=sync_progress_callback, job_id=job_id)

        # Check for cancellation again after processing
        if job.get("cancelled"):
            job["status"] = "cancelled"
            job["completed_at"] = datetime.utcnow().isoformat()
            await update_job(job_id, status="cancelled", completed_at=job["completed_at"])
            await _emit_progress(job_id, "Cancelled", 0)
            return

        # Store shots in database
        shot_dicts = [shot.model_dump() for shot in shots]
        await create_shots(job_id, shot_dicts)

        job["shots"] = shot_dicts
        job["progress"] = 100
        job["completed_at"] = datetime.utcnow().isoformat()

        # Check how many need review
        needs_review = sum(1 for s in shots if s.confidence < settings.confidence_threshold)
        job["total_shots_detected"] = len(shots)
        job["shots_needing_review"] = needs_review

        if needs_review > 0:
            job["status"] = "review"
            job["current_step"] = f"{needs_review} shots need review"
            await update_job(
                job_id,
                status="review",
                progress=100,
                current_step=job["current_step"],
                completed_at=job["completed_at"],
                total_shots_detected=len(shots),
                shots_needing_review=needs_review,
            )
            await _emit_progress(job_id, f"{needs_review} shots need review", 100)
        else:
            job["status"] = "complete"
            job["current_step"] = "Detection complete"
            await update_job(
                job_id,
                status="complete",
                progress=100,
                current_step="Detection complete",
                completed_at=job["completed_at"],
                total_shots_detected=len(shots),
                shots_needing_review=0,
            )
            await _emit_progress(job_id, "Detection complete", 100)

    except asyncio.CancelledError:
        logger.info(f"Job {job_id} was cancelled")
        job["status"] = "cancelled"
        job["completed_at"] = datetime.utcnow().isoformat()
        await update_job(job_id, status="cancelled", completed_at=job["completed_at"])
        await _emit_progress(job_id, "Cancelled", job.get("progress", 0))

    except Exception as e:
        logger.exception(f"Error processing job {job_id}")
        job["status"] = "error"
        job["completed_at"] = datetime.utcnow().isoformat()
        job["error"] = JobError(
            code="PROCESSING_ERROR",
            message=str(e),
            details={"exception_type": type(e).__name__},
        ).model_dump()
        await update_job(
            job_id,
            status="error",
            completed_at=job["completed_at"],
            error=job["error"],
        )
        await _emit_progress(job_id, "Error", job.get("progress", 0), details=str(e))

    finally:
        # Clean up SSE queue after a delay (allow clients to receive final events)
        async def cleanup_queue():
            await asyncio.sleep(30)
            if job_id in _progress_queues:
                del _progress_queues[job_id]
            # Keep completed jobs in cache for a while, but could remove them
            # to save memory if needed

        try:
            asyncio.create_task(cleanup_queue())
        except RuntimeError:
            pass


@router.get("/progress/{job_id}")
async def stream_progress(job_id: str):
    """Stream progress events via Server-Sent Events (SSE)."""
    # Check cache first, then database
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        _cache_job(job_id, job)

    # Create queue if it doesn't exist (for late joiners)
    if job_id not in _progress_queues:
        _progress_queues[job_id] = asyncio.Queue(maxsize=100)

    async def event_generator() -> AsyncGenerator[str, None]:
        """Generate SSE events from the progress queue."""
        queue = _progress_queues.get(job_id)
        if not queue:
            return

        # Send initial state
        initial_event = ProgressEvent(
            job_id=job_id,
            step=job.get("current_step", "Unknown"),
            progress=job.get("progress", 0),
            timestamp=datetime.utcnow().isoformat(),
            total_shots_detected=job.get("total_shots_detected", 0),
            shots_needing_review=job.get("shots_needing_review", 0),
        )
        yield f"data: {initial_event.model_dump_json()}\n\n"

        # Check if job is already complete - refresh from database to get latest data
        if job.get("status") in ("complete", "error", "cancelled", "review"):
            # Get fresh data from database to ensure we have shots_needing_review
            fresh_job = await get_job(job_id)
            if fresh_job:
                _cache_job(job_id, fresh_job)  # Update cache
                complete_event = ProgressEvent(
                    job_id=job_id,
                    step=fresh_job.get("current_step", "Complete"),
                    progress=100,
                    timestamp=datetime.utcnow().isoformat(),
                    total_shots_detected=fresh_job.get("total_shots_detected", 0),
                    shots_needing_review=fresh_job.get("shots_needing_review", 0),
                )
                yield f"event: complete\ndata: {complete_event.model_dump_json()}\n\n"
            else:
                yield f"event: complete\ndata: {initial_event.model_dump_json()}\n\n"
            return

        # Stream updates
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30.0)
                yield f"data: {event.model_dump_json()}\n\n"

                # Check if job is complete (from cache or database)
                current_job = _get_cached_job(job_id) or await get_job(job_id)
                if current_job and current_job.get("status") in ("complete", "error", "cancelled", "review"):
                    # Create completion event with shots data from job
                    complete_event = ProgressEvent(
                        job_id=job_id,
                        step=current_job.get("current_step", "Complete"),
                        progress=100,
                        timestamp=datetime.utcnow().isoformat(),
                        total_shots_detected=current_job.get("total_shots_detected", 0),
                        shots_needing_review=current_job.get("shots_needing_review", 0),
                    )
                    yield f"event: complete\ndata: {complete_event.model_dump_json()}\n\n"
                    break

            except asyncio.TimeoutError:
                # Send keepalive
                yield ": keepalive\n\n"

                # Check if job still exists and is active
                current_job = _get_cached_job(job_id) or await get_job(job_id)
                if not current_job or current_job.get("status") in ("complete", "error", "cancelled", "review"):
                    break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable buffering in nginx
        },
    )


@router.get("/status/{job_id}", response_model=ProcessingStatus)
async def get_status(job_id: str):
    """Get the current status of a processing job."""
    # Check cache first, then database
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        _cache_job(job_id, job)

    # For completed jobs, always refresh from database to avoid stale cache
    if job.get("status") in ("complete", "error", "cancelled", "review"):
        fresh_job = await get_job(job_id)
        if fresh_job:
            job = fresh_job
            _cache_job(job_id, job)

    return ProcessingStatus(
        video_path=job["video_path"],
        status=job["status"],
        progress=job["progress"],
        current_step=job["current_step"],
        total_shots_detected=job.get("total_shots_detected", 0),
        shots_needing_review=job.get("shots_needing_review", 0),
        error_message=job["error"]["message"] if job.get("error") else None,
    )


@router.post("/cancel/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a running processing job."""
    # Check cache first, then database
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        _cache_job(job_id, job)

    if job["status"] not in ("pending", "processing"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel job in '{job['status']}' status"
        )

    job["cancelled"] = True
    job["status"] = "cancelling"

    await update_job(job_id, cancelled=True, status="cancelling")

    logger.info(f"Cancellation requested for job {job_id}")

    return {"status": "cancelling", "message": "Cancellation requested"}


@router.get("/shots/{job_id}", response_model=list[DetectedShot])
async def get_detected_shots(job_id: str):
    """Get all detected shots for a job."""
    # Check cache first
    job = _get_cached_job(job_id)
    if job and job.get("shots"):
        return [DetectedShot(**shot) for shot in job["shots"]]

    # Fallback to database
    job = await get_job(job_id, include_shots=True)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    _cache_job(job_id, job)
    return [DetectedShot(**shot) for shot in job.get("shots", [])]


@router.post("/shots/{job_id}/update")
async def update_shot_boundaries(job_id: str, boundaries: list[ClipBoundary]):
    """Update clip boundaries after user review."""
    # Check cache first, then database
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id, include_shots=True)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        _cache_job(job_id, job)

    # Update shot boundaries
    updated_count = 0
    for boundary in boundaries:
        # Update in cache
        for shot in job.get("shots", []):
            if shot["id"] == boundary.shot_id:
                shot["clip_start"] = boundary.start_time
                shot["clip_end"] = boundary.end_time
                if boundary.approved:
                    shot["confidence"] = 1.0  # User-approved = 100% confidence

                # Update in database
                await update_shot(
                    job_id,
                    boundary.shot_id,
                    clip_start=boundary.start_time,
                    clip_end=boundary.end_time,
                    confidence=1.0 if boundary.approved else shot["confidence"],
                )
                updated_count += 1

    # Recalculate shots needing review
    shots = await get_shots_for_job(job_id)
    needs_review = sum(
        1 for s in shots
        if s["confidence"] < settings.confidence_threshold
    )
    job["shots"] = shots
    job["shots_needing_review"] = needs_review

    # Check if all shots are now approved
    all_approved = needs_review == 0
    if all_approved and job["status"] == "review":
        job["status"] = "complete"
        await update_job(job_id, status="complete", shots_needing_review=0)
    else:
        await update_job(job_id, shots_needing_review=needs_review)

    return {
        "status": "updated",
        "updated_count": updated_count,
        "all_approved": all_approved,
        "shots_needing_review": needs_review,
    }


@router.post("/export", response_model=ExportJobResponse)
async def export_clips(request: ExportClipsRequest, background_tasks: BackgroundTasks):
    """Export confirmed clips to the output directory.

    Returns immediately with an export_job_id. Use GET /api/export/{export_job_id}/status
    to poll for progress.
    """
    # Check cache first, then database
    job = _get_cached_job(request.job_id)
    if not job:
        job = await get_job(request.job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

    # Filter to approved clips only
    approved_clips = [clip for clip in request.clips if clip.approved]

    # Create export job
    export_job_id = str(uuid.uuid4())
    export_job = {
        "export_job_id": export_job_id,
        "job_id": request.job_id,
        "status": "pending",
        "total_clips": len(approved_clips),
        "exported_count": 0,
        "current_clip": None,
        "progress": 0,
        "output_dir": request.output_dir,
        "video_path": job["video_path"],
        "clips": [clip.model_dump() for clip in approved_clips],
        "filename_pattern": request.filename_pattern,
        "exported": [],
        "errors": [],
        "has_errors": False,
        "render_tracer": request.render_tracer,
        "tracer_style": request.tracer_style.model_dump() if request.tracer_style else None,
    }
    _export_jobs[export_job_id] = export_job

    # Start export in background
    background_tasks.add_task(run_export_job, export_job_id)

    return ExportJobResponse(
        export_job_id=export_job_id,
        status="pending",
        total_clips=len(approved_clips),
    )


async def run_export_job(export_job_id: str):
    """Run the clip export in the background."""
    export_job = _export_jobs.get(export_job_id)
    if not export_job:
        logger.error(f"Export job {export_job_id} not found")
        return

    try:
        export_job["status"] = "exporting"

        output_dir = Path(export_job["output_dir"])
        output_dir.mkdir(parents=True, exist_ok=True)

        video_path = Path(export_job["video_path"])
        clips = export_job["clips"]
        total_clips = len(clips)

        # Create ClipExporter for tracer rendering if needed
        clip_exporter = ClipExporter(video_path) if export_job.get("render_tracer") else None

        for i, clip in enumerate(clips):
            export_job["current_clip"] = clip["shot_id"]
            export_job["progress"] = (i / max(total_clips, 1)) * 100

            filename = export_job["filename_pattern"].format(shot_id=clip["shot_id"]) + ".mp4"
            output_path = output_dir / filename

            try:
                loop = asyncio.get_event_loop()

                if export_job.get("render_tracer"):
                    # Get trajectory for this shot
                    trajectory = await get_trajectory(export_job["job_id"], clip["shot_id"])

                    if trajectory and trajectory.get("points"):
                        # Export with tracer overlay
                        tracer_style_dict = export_job.get("tracer_style")

                        def export_with_tracer():
                            return clip_exporter.export_clip_with_tracer(
                                start_time=clip["start_time"],
                                end_time=clip["end_time"],
                                output_path=output_path,
                                trajectory_points=trajectory["points"],
                                frame_width=trajectory["frame_width"],
                                frame_height=trajectory["frame_height"],
                                apex_point=trajectory.get("apex_point"),
                                tracer_style=tracer_style_dict,
                            )

                        result = await loop.run_in_executor(None, export_with_tracer)

                        if result.success:
                            export_job["exported"].append(str(output_path))
                            export_job["exported_count"] = len(export_job["exported"])
                            logger.info(f"Exported clip {clip['shot_id']} with tracer to {output_path}")
                        else:
                            raise Exception(result.error_message or "Tracer export failed")
                    else:
                        # No trajectory, fall back to normal export
                        logger.warning(f"No trajectory for shot {clip['shot_id']}, exporting without tracer")
                        await loop.run_in_executor(
                            None,
                            extract_clip,
                            video_path,
                            output_path,
                            clip["start_time"],
                            clip["end_time"],
                        )
                        export_job["exported"].append(str(output_path))
                        export_job["exported_count"] = len(export_job["exported"])
                        logger.info(f"Exported clip {clip['shot_id']} to {output_path}")
                else:
                    # Normal export without tracer
                    await loop.run_in_executor(
                        None,
                        extract_clip,
                        video_path,
                        output_path,
                        clip["start_time"],
                        clip["end_time"],
                    )
                    export_job["exported"].append(str(output_path))
                    export_job["exported_count"] = len(export_job["exported"])
                    logger.info(f"Exported clip {clip['shot_id']} to {output_path}")

            except Exception as e:
                error_msg = f"Failed to export clip {clip['shot_id']}: {e}"
                logger.error(error_msg)
                export_job["errors"].append({"shot_id": clip["shot_id"], "error": str(e)})
                export_job["has_errors"] = True

        # Mark complete
        export_job["status"] = "complete"
        export_job["progress"] = 100
        export_job["current_clip"] = None

    except Exception as e:
        logger.exception(f"Error in export job {export_job_id}")
        export_job["status"] = "error"
        export_job["errors"].append({"shot_id": None, "error": str(e)})
        export_job["has_errors"] = True

    finally:
        # Clean up export job after 5 minutes
        async def cleanup_export_job():
            await asyncio.sleep(300)
            if export_job_id in _export_jobs:
                del _export_jobs[export_job_id]

        try:
            asyncio.create_task(cleanup_export_job())
        except RuntimeError:
            pass


@router.get("/export/{export_job_id}/status", response_model=ExportJobStatus)
async def get_export_status(export_job_id: str):
    """Get the status of an export job."""
    export_job = _export_jobs.get(export_job_id)
    if not export_job:
        raise HTTPException(status_code=404, detail="Export job not found")

    return ExportJobStatus(
        export_job_id=export_job["export_job_id"],
        status=export_job["status"],
        total_clips=export_job["total_clips"],
        exported_count=export_job["exported_count"],
        current_clip=export_job["current_clip"],
        progress=export_job["progress"],
        output_dir=export_job["output_dir"],
        exported=export_job["exported"],
        errors=export_job["errors"],
        has_errors=export_job["has_errors"],
    )


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
        logger.exception(f"Failed to get video info: {video_path}")
        raise HTTPException(status_code=400, detail=f"Could not read video: {e}")


@router.get("/video")
async def stream_video(path: str, request: Request, download: bool = False):
    """Stream a video file for playback in the browser.

    Supports HTTP Range requests for seeking.
    Set download=true to trigger browser download instead of playback.
    """
    video_path = Path(path)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    file_size = video_path.stat().st_size

    # Determine content type based on extension
    ext = video_path.suffix.lower()
    content_types = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".m4v": "video/x-m4v",
    }
    content_type = content_types.get(ext, "video/mp4")

    # Handle range requests for video seeking
    range_header = request.headers.get("range")

    # Build common headers
    extra_headers = {"Accept-Ranges": "bytes"}
    if download:
        # Trigger browser download with original filename
        # Escape quotes in filename and use RFC 5987 encoding for Unicode
        filename = video_path.name
        # Escape double quotes
        safe_filename = filename.replace('"', '\\"')
        extra_headers["Content-Disposition"] = f'attachment; filename="{safe_filename}"'

    if range_header and not download:
        # Parse range header (e.g., "bytes=0-1024") - only for streaming, not downloads
        try:
            range_match = range_header.replace("bytes=", "").split("-")
            start = int(range_match[0]) if range_match[0] else 0
            end = int(range_match[1]) if range_match[1] else file_size - 1
        except (ValueError, IndexError):
            start = 0
            end = file_size - 1

        # Clamp values
        start = max(0, start)
        end = min(end, file_size - 1)
        content_length = end - start + 1

        def iterfile():
            with open(video_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 64 * 1024  # 64KB chunks
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iterfile(),
            status_code=206,
            media_type=content_type,
            headers={
                **extra_headers,
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Content-Length": str(content_length),
            },
        )
    else:
        # Full file response
        return FileResponse(
            video_path,
            media_type=content_type,
            headers=extra_headers,
        )


@router.get("/jobs")
async def list_jobs(limit: int = 50, status: Optional[str] = None):
    """List all processing jobs with optional status filter."""
    # Get from database (source of truth for listing)
    jobs = await get_all_jobs(limit=limit, status=status, include_shots=False)

    job_list = [
        {
            "job_id": job["id"],
            "video_path": job["video_path"],
            "status": job["status"],
            "progress": job["progress"],
            "current_step": job["current_step"],
            "total_shots_detected": job.get("total_shots_detected", 0),
            "created_at": job.get("created_at"),
            "completed_at": job.get("completed_at"),
        }
        for job in jobs
    ]

    return {"jobs": job_list, "count": len(job_list)}


@router.delete("/jobs/{job_id}")
async def delete_job_endpoint(job_id: str):
    """Delete a job from the database."""
    # Check if job exists and can be deleted
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] in ("pending", "processing"):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running job. Cancel it first."
        )

    # Delete from database
    await delete_job(job_id)

    # Remove from cache
    _remove_from_cache(job_id)

    # Clean up SSE queue if exists
    if job_id in _progress_queues:
        del _progress_queues[job_id]

    return {"status": "deleted", "job_id": job_id}


async def load_jobs_on_startup() -> None:
    """Load existing jobs into cache on startup.

    Called by the application lifespan manager after database initialization.
    """
    from backend.models.job import load_jobs_into_memory

    jobs = await load_jobs_into_memory()

    # Only cache active/recent jobs to save memory
    for job_id, job in jobs.items():
        # Cache active jobs and recently completed ones
        if job["status"] in ("pending", "processing", "review"):
            _cache_job(job_id, job)

    logger.info(f"Loaded {len(jobs)} jobs from database, cached {len(_job_cache)} active jobs")


# =============================================================================
# Database Management Endpoints
# =============================================================================


@router.get("/db/stats")
async def get_database_stats():
    """Get database statistics and health information."""
    from backend.core.database import get_database_stats

    return await get_database_stats()


@router.post("/db/purge")
async def purge_old_jobs(days: int = 30):
    """Purge old completed/cancelled/errored jobs from the database.

    Args:
        days: Number of days to keep. Jobs older than this will be deleted.
              Defaults to 30 days.

    Returns:
        Number of jobs deleted and remaining counts.
    """
    from backend.core.database import purge_old_jobs as db_purge_old_jobs, get_database_stats

    if days < 1:
        raise HTTPException(status_code=400, detail="days must be at least 1")

    deleted_count = await db_purge_old_jobs(days=days)

    # Also remove deleted jobs from cache
    for job_id in list(_job_cache.keys()):
        job = await get_job(job_id)
        if not job:
            _remove_from_cache(job_id)

    stats = await get_database_stats()

    return {
        "deleted_count": deleted_count,
        "remaining_jobs": stats["total_jobs"],
        "remaining_shots": stats["total_shots"],
        "jobs_by_status": stats.get("jobs_by_status", {}),
    }


@router.get("/db/export")
async def export_all_jobs():
    """Export all jobs and shots as JSON for backup purposes.

    Returns:
        JSON array of all jobs with their shots included.
    """
    from backend.core.database import export_jobs_to_json

    jobs = await export_jobs_to_json()

    return {
        "exported_at": datetime.utcnow().isoformat(),
        "job_count": len(jobs),
        "jobs": jobs,
    }


# =============================================================================
# Shot Feedback Endpoints
# NOTE: Specific paths (/feedback/export, /feedback/stats) MUST come before
# parameterized paths (/feedback/{job_id}) for correct route matching.
# =============================================================================


@router.get("/feedback/export", response_model=FeedbackExportResponse)
async def export_feedback(limit: int = 10000, offset: int = 0, feedback_type: Optional[str] = None):
    """Export all feedback data for analysis and model training.

    Args:
        limit: Maximum records to return (default 10000).
        offset: Number of records to skip for pagination.
        feedback_type: Filter by 'true_positive' or 'false_positive'.

    Returns:
        All feedback records with full detection feature snapshots.
    """
    if feedback_type and feedback_type not in ("true_positive", "false_positive"):
        raise HTTPException(
            status_code=400,
            detail="feedback_type must be 'true_positive' or 'false_positive'"
        )

    records = await get_all_feedback(limit=limit, offset=offset, feedback_type=feedback_type)

    return FeedbackExportResponse(
        exported_at=datetime.utcnow().isoformat(),
        total_records=len(records),
        records=records,
    )


@router.get("/feedback/stats", response_model=FeedbackStats)
async def get_feedback_statistics():
    """Get aggregate statistics on collected feedback.

    Returns precision metric (TP / (TP + FP)) and counts.
    """
    stats = await get_feedback_stats()

    return FeedbackStats(
        total_feedback=stats["total_feedback"],
        true_positives=stats["true_positives"],
        false_positives=stats["false_positives"],
        precision=stats["precision"],
    )


@router.post("/feedback/{job_id}", response_model=list[ShotFeedbackResponse])
async def submit_feedback(job_id: str, request: ShotFeedbackRequest):
    """Submit feedback on detected shots (true positive or false positive).

    This data is used to improve detection algorithms over time.
    """
    # Get job with shots to snapshot detection features
    job = _get_cached_job(job_id)
    if not job:
        job = await get_job(job_id, include_shots=True)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        _cache_job(job_id, job)

    # Build shot lookup for snapshotting
    shots_by_id = {shot["id"]: shot for shot in job.get("shots", [])}

    created_feedback = []
    for item in request.feedback:
        shot = shots_by_id.get(item.shot_id)
        if not shot:
            raise HTTPException(
                status_code=404,
                detail=f"Shot {item.shot_id} not found in job {job_id}"
            )

        # Snapshot detection features at feedback time
        feedback_record = await create_feedback(
            job_id=job_id,
            shot_id=item.shot_id,
            feedback_type=item.feedback_type.value,
            notes=item.notes,
            confidence_snapshot=shot.get("confidence"),
            audio_confidence_snapshot=shot.get("audio_confidence"),
            visual_confidence_snapshot=shot.get("visual_confidence"),
            detection_features=shot.get("confidence_reasons"),
            environment=get_environment(),
        )

        created_feedback.append(ShotFeedbackResponse(
            id=feedback_record["id"],
            job_id=feedback_record["job_id"],
            shot_id=feedback_record["shot_id"],
            feedback_type=feedback_record["feedback_type"],
            notes=feedback_record["notes"],
            confidence_snapshot=feedback_record["confidence_snapshot"],
            audio_confidence_snapshot=feedback_record["audio_confidence_snapshot"],
            visual_confidence_snapshot=feedback_record["visual_confidence_snapshot"],
            created_at=feedback_record["created_at"],
            environment=feedback_record["environment"],
        ))

    return created_feedback


@router.get("/feedback/{job_id}", response_model=list[ShotFeedbackResponse])
async def get_job_feedback(job_id: str):
    """Get all feedback records for a specific job."""
    # Verify job exists
    job = _get_cached_job(job_id) or await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    feedback_records = await get_feedback_for_job(job_id)

    return [
        ShotFeedbackResponse(
            id=record["id"],
            job_id=record["job_id"],
            shot_id=record["shot_id"],
            feedback_type=record["feedback_type"],
            notes=record["notes"],
            confidence_snapshot=record["confidence_snapshot"],
            audio_confidence_snapshot=record["audio_confidence_snapshot"],
            visual_confidence_snapshot=record["visual_confidence_snapshot"],
            created_at=record["created_at"],
            environment=record["environment"],
        )
        for record in feedback_records
    ]


# === TRAJECTORY ENDPOINTS (Phase 2) ===

@router.get("/trajectory/{job_id}/{shot_id}")
async def get_shot_trajectory(job_id: str, shot_id: int):
    """Get trajectory data for a specific shot.

    Returns trajectory points in normalized coordinates (0-1).
    """
    trajectory = await get_trajectory(job_id, shot_id)

    if not trajectory:
        raise HTTPException(
            status_code=404,
            detail=f"No trajectory found for job {job_id} shot {shot_id}",
        )

    # Convert to response format
    points = [
        TrajectoryPoint(
            timestamp=p["timestamp"],
            x=p["x"],
            y=p["y"],
            confidence=p.get("confidence", 0),
            interpolated=p.get("interpolated", False),
        )
        for p in trajectory["points"]
    ]

    apex = None
    if trajectory["apex_point"]:
        ap = trajectory["apex_point"]
        apex = TrajectoryPoint(
            timestamp=ap.get("timestamp", 0),
            x=ap["x"],
            y=ap["y"],
            confidence=1.0,
            interpolated=False,
        )

    return TrajectoryData(
        shot_id=trajectory["shot_id"],
        points=points,
        confidence=trajectory["confidence"],
        smoothness_score=trajectory["smoothness_score"],
        physics_plausibility=trajectory["physics_plausibility"],
        apex_point=apex,
        launch_angle=trajectory["launch_angle"],
        flight_duration=trajectory["flight_duration"],
        has_gaps=trajectory["has_gaps"],
        gap_count=trajectory["gap_count"],
        is_manual_override=trajectory["is_manual_override"],
        frame_width=trajectory["frame_width"],
        frame_height=trajectory["frame_height"],
    )


@router.get("/trajectories/{job_id}")
async def get_job_trajectories(job_id: str):
    """Get all trajectories for a job."""
    trajectories = await get_trajectories_for_job(job_id)

    if not trajectories:
        return {"job_id": job_id, "trajectories": []}

    result = []
    for t in trajectories:
        points = [
            TrajectoryPoint(
                timestamp=p["timestamp"],
                x=p["x"],
                y=p["y"],
                confidence=p.get("confidence", 0),
                interpolated=p.get("interpolated", False),
            )
            for p in t["points"]
        ]

        apex = None
        if t["apex_point"]:
            ap = t["apex_point"]
            apex = TrajectoryPoint(
                timestamp=ap.get("timestamp", 0),
                x=ap["x"],
                y=ap["y"],
                confidence=1.0,
                interpolated=False,
            )

        result.append(TrajectoryData(
            shot_id=t["shot_id"],
            points=points,
            confidence=t["confidence"],
            smoothness_score=t["smoothness_score"],
            physics_plausibility=t["physics_plausibility"],
            apex_point=apex,
            launch_angle=t["launch_angle"],
            flight_duration=t["flight_duration"],
            has_gaps=t["has_gaps"],
            gap_count=t["gap_count"],
            is_manual_override=t["is_manual_override"],
            frame_width=t["frame_width"],
            frame_height=t["frame_height"],
        ))

    return {"job_id": job_id, "trajectories": result}


@router.put("/trajectory/{job_id}/{shot_id}")
async def update_shot_trajectory(
    job_id: str,
    shot_id: int,
    request: TrajectoryUpdateRequest,
):
    """Update trajectory with manual edits.

    Points should be in normalized coordinates (0-1).
    """
    # Verify job exists
    job = _get_cached_job(job_id) or await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    points_dicts = [
        {
            "timestamp": p.timestamp,
            "x": p.x,
            "y": p.y,
            "confidence": p.confidence,
            "interpolated": p.interpolated,
        }
        for p in request.points
    ]

    success = await update_trajectory_db(
        job_id=job_id,
        shot_id=shot_id,
        trajectory_points=points_dicts,
        is_manual_override=True,
    )

    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"No trajectory found for job {job_id} shot {shot_id}",
        )

    return {"status": "updated", "job_id": job_id, "shot_id": shot_id}


@router.get("/trajectory/{job_id}/{shot_id}/generate")
async def generate_trajectory_sse(
    job_id: str,
    shot_id: int,
    landing_x: Optional[float] = Query(None, ge=0, le=1, description="Landing X coordinate (0-1), optional"),
    landing_y: Optional[float] = Query(None, ge=0, le=1, description="Landing Y coordinate (0-1), optional"),
    target_x: Optional[float] = Query(None, ge=0, le=1, description="Target X coordinate (0-1), optional"),
    target_y: Optional[float] = Query(None, ge=0, le=1, description="Target Y coordinate (0-1), optional"),
    starting_line: str = Query("center", description="Starting line: left, center, right"),
    shot_shape: str = Query("straight", description="Shot shape: hook, draw, straight, fade, slice"),
    shot_height: str = Query("medium", description="Shot height: low, medium, high"),
    flight_time: float = Query(None, ge=1.0, le=6.0, description="Flight time in seconds (1.0-6.0)"),
    apex_x: Optional[float] = Query(None, ge=0, le=1, description="Apex X coordinate (0-1), optional"),
    apex_y: Optional[float] = Query(None, ge=0, le=1, description="Apex Y coordinate (0-1), optional"),
):
    """Generate trajectory with SSE progress updates.

    Returns Server-Sent Events with:
    - event: progress - Progress updates during generation
    - event: warning - Non-fatal detection issues
    - event: complete - Final trajectory data
    - event: error - Fatal errors
    """
    from backend.models.job import get_job, update_shot_landing
    from backend.models.trajectory import create_trajectory, get_trajectory as get_traj
    from backend.detection.tracker import ConstrainedBallTracker
    from backend.detection.origin import BallOriginDetector

    # Verify job exists
    job = await get_job(job_id, include_shots=True)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Verify video file exists
    video_path = Path(job["video_path"])
    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    # Find the shot
    shot = None
    for s in job.get("shots", []):
        if s.get("shot_number") == shot_id or s.get("id") == shot_id:
            shot = s
            break

    if not shot:
        raise HTTPException(status_code=404, detail=f"Shot {shot_id} not found in job {job_id}")

    # Get video dimensions
    try:
        video_info = get_video_info(str(video_path))
        frame_width = video_info.get("width", 1920)
        frame_height = video_info.get("height", 1080)
    except Exception as e:
        logger.warning(f"Could not get video dimensions, using defaults: {e}")
        frame_width = 1920
        frame_height = 1080

    strike_time = shot.get("strike_time", 0.0)

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # Step 1: Save landing point (if provided)
            if landing_x is not None and landing_y is not None:
                yield sse_event("progress", {
                    "step": "saving",
                    "progress": 5,
                    "message": "Saving landing point..."
                })
                await update_shot_landing(job_id, shot_id, landing_x, landing_y)
            else:
                yield sse_event("progress", {
                    "step": "saving",
                    "progress": 5,
                    "message": "Using auto-generated trajectory..."
                })

            # Step 2: Detect ball origin
            yield sse_event("progress", {
                "step": "origin",
                "progress": 10,
                "message": "Detecting ball origin..."
            })

            origin_detector = BallOriginDetector()
            tracker = ConstrainedBallTracker(origin_detector=origin_detector)

            # Run origin detection in executor (CPU-bound)
            loop = asyncio.get_event_loop()
            origin = await loop.run_in_executor(
                None,
                lambda: origin_detector.detect_origin(video_path, strike_time)
            )

            if origin is None:
                # Emit warning but continue with fallback origin
                yield sse_event("warning", {
                    "code": "origin_detection_failed",
                    "message": "Could not detect ball origin, using fallback position"
                })
                # Use a fallback origin (center-bottom of frame)
                from backend.detection.origin import OriginDetection
                origin = OriginDetection(
                    x=frame_width * 0.5,
                    y=frame_height * 0.85,
                    confidence=0.3,
                    method="fallback"
                )
            elif origin.confidence < 0.6:
                yield sse_event("warning", {
                    "code": "low_origin_confidence",
                    "message": f"Ball origin detection confidence is low ({origin.confidence:.0%})"
                })

            yield sse_event("progress", {
                "step": "origin",
                "progress": 20,
                "message": f"Ball origin detected at ({origin.x:.0f}, {origin.y:.0f})"
            })

            # Step 3: Generate trajectory with full configuration
            yield sse_event("progress", {
                "step": "generating",
                "progress": 25,
                "message": "Generating trajectory..."
            })

            # Run early ball detection to get stats for debug display
            from backend.detection.early_tracker import EarlyBallTracker
            early_detection_stats = {"frames_analyzed": 30, "frames_with_ball": 0}
            try:
                fps = video_info.get("fps", 60.0)
                early_tracker = EarlyBallTracker(
                    video_path=video_path,
                    origin_x=origin.x,
                    origin_y=origin.y,
                    strike_time=strike_time,
                    frame_width=frame_width,
                    frame_height=frame_height,
                    fps=fps,
                )
                # Run early detection (first 0.5s = ~30 frames at 60fps)
                early_detections = await loop.run_in_executor(
                    None,
                    lambda: early_tracker.detect()
                )
                early_detection_stats["frames_with_ball"] = len(early_detections)
                early_detection_stats["frames_analyzed"] = int(0.5 * fps)  # ~30 frames
                logger.info(f"Early detection stats: {len(early_detections)} detections in {int(0.5 * fps)} frames")
            except Exception as e:
                logger.warning(f"Early detection stats failed: {e}")

            yield sse_event("progress", {
                "step": "generating",
                "progress": 40,
                "message": f"Early detection: {early_detection_stats['frames_with_ball']}/{early_detection_stats['frames_analyzed']} frames"
            })

            # Normalize origin
            origin_normalized = (origin.x / frame_width, origin.y / frame_height)

            # Compute default landing/target if not provided
            # Default landing: ball flies to upper portion of frame based on shot direction
            actual_landing_x = landing_x
            actual_landing_y = landing_y
            actual_target_x = target_x
            actual_target_y = target_y

            if actual_landing_x is None or actual_landing_y is None:
                # Calculate default landing based on starting_line and shot_shape
                # Base X: depends on starting line
                base_x = {"left": 0.3, "center": 0.5, "right": 0.7}.get(starting_line, 0.5)
                # Adjust for shot shape (draw goes right-to-left, fade goes left-to-right)
                shape_offset = {"hook": -0.15, "draw": -0.08, "straight": 0, "fade": 0.08, "slice": 0.15}.get(shot_shape, 0)
                actual_landing_x = max(0.1, min(0.9, base_x + shape_offset))
                # Y: higher in frame (towards top) based on shot height
                actual_landing_y = {"low": 0.25, "medium": 0.15, "high": 0.08}.get(shot_height, 0.15)
                yield sse_event("warning", {
                    "code": "auto_landing",
                    "message": "Using auto-generated landing point"
                })

            if actual_target_x is None or actual_target_y is None:
                # Default target: same X as landing but slightly different Y
                actual_target_x = actual_landing_x
                actual_target_y = actual_landing_y

            # Build apex tuple if provided
            apex = (apex_x, apex_y) if apex_x is not None and apex_y is not None else None

            # Run trajectory generation in executor
            trajectory_result = await loop.run_in_executor(
                None,
                lambda: tracker.generate_configured_trajectory(
                    origin=origin_normalized,
                    target=(actual_target_x, actual_target_y),
                    landing=(actual_landing_x, actual_landing_y),
                    starting_line=starting_line,
                    shot_shape=shot_shape,
                    shot_height=shot_height,
                    strike_time=strike_time,
                    flight_time=flight_time,
                    apex=apex,
                )
            )

            if trajectory_result is None:
                yield sse_event("error", {
                    "error": "Failed to generate trajectory",
                    "progress": 0
                })
                return

            # Step 4: Save trajectory to database
            yield sse_event("progress", {
                "step": "saving",
                "progress": 92,
                "message": "Saving trajectory..."
            })

            trajectory_points = trajectory_result.get("points", [])
            apex_point = trajectory_result.get("apex_point")
            flight_duration = trajectory_result.get("flight_duration")
            launch_angle = trajectory_result.get("launch_angle")
            confidence = trajectory_result.get("confidence", 0.85)

            await create_trajectory(
                job_id=job_id,
                shot_id=shot_id,
                trajectory_points=trajectory_points,
                confidence=confidence,
                apex_point=apex_point,
                launch_angle=launch_angle,
                flight_duration=flight_duration,
                frame_width=frame_width,
                frame_height=frame_height,
            )

            # Fetch saved trajectory for response
            saved_trajectory = await get_traj(job_id, shot_id)

            yield sse_event("progress", {
                "step": "complete",
                "progress": 100,
                "message": "Trajectory generation complete"
            })

            yield sse_event("complete", {
                "trajectory": saved_trajectory,
                "progress": 100,
                "message": "Trajectory generation complete",
                "early_detection_stats": early_detection_stats,
            })

        except Exception as e:
            logger.exception(f"Error generating trajectory for job={job_id} shot={shot_id}")
            yield sse_event("error", {
                "error": str(e),
                "progress": 0
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# =============================================================================
# Tracer Feedback Endpoints (ML Training Data Collection)
# NOTE: Specific paths (/tracer-feedback/stats, /tracer-feedback/export) MUST
# come before parameterized paths (/tracer-feedback/{job_id}) for correct routing.
# =============================================================================


@router.get("/tracer-feedback/stats", response_model=TracerFeedbackStats)
async def get_tracer_feedback_stats():
    """Get aggregate statistics on tracer feedback.

    Returns auto-accepted rate, counts by feedback type, and common adjustments.
    """
    # Export all feedback to compute stats
    export_data = await export_tracer_feedback()
    feedback_list = export_data.get("feedback", [])
    stats_by_type = export_data.get("stats", {}).get("by_type", {})

    # Count by type
    auto_accepted = stats_by_type.get("tracer_auto_accepted", 0)
    configured = stats_by_type.get("tracer_configured", 0)
    reluctant_accept = stats_by_type.get("tracer_reluctant_accept", 0)
    skip = stats_by_type.get("tracer_skip", 0)
    rejected = stats_by_type.get("tracer_rejected", 0)
    total = len(feedback_list)

    # Compute auto-accepted rate
    auto_accepted_rate = 0.0
    if total > 0:
        auto_accepted_rate = auto_accepted / total

    # Compute common adjustments from configured feedback
    common_adjustments: dict[str, dict[str, int]] = {}
    for record in feedback_list:
        deltas = record.get("deltas")
        if deltas:
            for param, change in deltas.items():
                if param not in common_adjustments:
                    common_adjustments[param] = {}
                # Represent the change as "auto->final" or just track that it changed
                auto_val = change.get("auto")
                final_val = change.get("final")
                key = f"{auto_val}->{final_val}"
                common_adjustments[param][key] = common_adjustments[param].get(key, 0) + 1

    return TracerFeedbackStats(
        total_feedback=total,
        auto_accepted=auto_accepted,
        configured=configured,
        reluctant_accept=reluctant_accept,
        skip=skip,
        rejected=rejected,
        auto_accepted_rate=auto_accepted_rate,
        common_adjustments=common_adjustments,
    )


@router.get("/tracer-feedback/export", response_model=TracerFeedbackExportResponse)
async def export_tracer_feedback_data(environment: Optional[str] = None):
    """Export tracer feedback for ML training.

    Args:
        environment: Optional filter by environment ('prod', 'dev', etc.)

    Returns:
        All tracer feedback records with computed deltas between auto and final params.
    """
    export_data = await export_tracer_feedback(environment=environment)

    return TracerFeedbackExportResponse(
        feedback=export_data.get("feedback", []),
        stats=export_data.get("stats", {}),
    )


@router.post("/tracer-feedback/{job_id}", response_model=TracerFeedbackResponse)
async def submit_tracer_feedback(job_id: str, request: TracerFeedbackRequest):
    """Submit feedback on tracer/trajectory quality for a shot.

    This data is used to improve auto-generated trajectory parameters over time.
    """
    # Verify job exists
    job = _get_cached_job(job_id) or await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    # Create feedback record
    feedback_record = await create_tracer_feedback(
        job_id=job_id,
        shot_id=request.shot_id,
        feedback_type=request.feedback_type.value,
        auto_params=request.auto_params,
        final_params=request.final_params,
        origin_point=request.origin_point,
        landing_point=request.landing_point,
        apex_point=request.apex_point,
        environment=get_environment(),
    )

    return TracerFeedbackResponse(
        id=feedback_record["id"],
        job_id=feedback_record["job_id"],
        shot_id=feedback_record["shot_id"],
        feedback_type=feedback_record["feedback_type"],
        auto_params=feedback_record["auto_params"],
        final_params=feedback_record["final_params"],
        origin_point=feedback_record["origin_point"],
        landing_point=feedback_record["landing_point"],
        apex_point=feedback_record["apex_point"],
        created_at=feedback_record["created_at"],
        environment=feedback_record["environment"],
    )
