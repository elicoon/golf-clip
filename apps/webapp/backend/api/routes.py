"""API routes for GolfClip webapp."""

import asyncio
import json
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.responses import RedirectResponse, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.storage import get_storage
from backend.models.job import (
    create_job,
    create_shots,
    delete_job,
    get_all_jobs,
    get_job,
    get_shots_for_job,
    update_job,
    update_shot,
)

router = APIRouter()


def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


# In-memory caches for active jobs
_job_cache: dict[str, dict] = {}
_progress_queues: dict[str, asyncio.Queue] = {}


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
        event = {
            "job_id": job_id,
            "step": step,
            "progress": progress,
            "details": details,
            "timestamp": datetime.utcnow().isoformat(),
        }
        try:
            _progress_queues[job_id].put_nowait(event)
        except asyncio.QueueFull:
            logger.warning(f"Progress queue full for job {job_id}, skipping event")


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file to R2 storage (legacy - buffers in memory)."""
    allowed_extensions = {".mp4", ".mov", ".m4v"}
    file_ext = Path(file.filename or "").suffix.lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    # Read file content
    content = await file.read()
    size_mb = len(content) / (1024 * 1024)

    # Check file size
    if size_mb > settings.max_video_size_mb:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max: {settings.max_video_size_mb}MB, got: {size_mb:.1f}MB"
        )

    storage = get_storage()
    try:
        storage_key = storage.upload(content, file.filename or "video.mp4")
        logger.info(f"Uploaded video: {storage_key} ({size_mb:.1f}MB)")

        return {
            "storage_key": storage_key,
            "filename": file.filename,
            "size": len(content),
        }
    except Exception as e:
        logger.exception(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/upload/initiate")
async def initiate_direct_upload(filename: str, size_bytes: int):
    """Get a presigned URL for direct upload to R2.

    This bypasses the server for large files - client uploads directly to R2.
    """
    allowed_extensions = {".mp4", ".mov", ".m4v"}
    file_ext = Path(filename).suffix.lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    size_mb = size_bytes / (1024 * 1024)
    if size_mb > settings.max_video_size_mb:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max: {settings.max_video_size_mb}MB, declared: {size_mb:.1f}MB"
        )

    storage = get_storage()
    storage_key = storage.generate_storage_key(filename)
    upload_url = storage.get_presigned_upload_url(storage_key, expires_in=3600)

    logger.info(f"Initiated direct upload: {storage_key} ({size_mb:.1f}MB)")

    return {
        "storage_key": storage_key,
        "upload_url": upload_url,
        "expires_in": 3600,
    }


class UploadCompleteRequest(BaseModel):
    storage_key: str

@router.post("/upload/complete")
async def complete_direct_upload(request: UploadCompleteRequest):
    """Verify a direct upload completed successfully."""
    storage = get_storage()
    storage_key = request.storage_key

    size = storage.get_object_size(storage_key)
    if size is None:
        raise HTTPException(
            status_code=404,
            detail="Upload not found in storage. Upload may have failed or expired."
        )

    logger.info(f"Verified direct upload: {storage_key} ({size / (1024*1024):.1f}MB)")

    return {
        "storage_key": storage_key,
        "size_bytes": size,
        "verified": True,
    }


@router.post("/process")
async def process_video(
    storage_key: str,
    background_tasks: BackgroundTasks,
):
    """Start processing a video from R2 storage."""
    storage = get_storage()

    if not storage.exists(storage_key):
        raise HTTPException(status_code=404, detail="Video not found in storage")

    job_id = str(uuid.uuid4())

    # Extract original filename from storage key (format: prefix/uuid_filename)
    key_parts = storage_key.rsplit("/", 1)
    filename_part = key_parts[-1] if key_parts else storage_key
    original_filename = filename_part.split("_", 1)[-1] if "_" in filename_part else filename_part

    # Create job in database
    job = await create_job(
        job_id=job_id,
        storage_key=storage_key,
        original_filename=original_filename,
    )

    _cache_job(job_id, job)
    _progress_queues[job_id] = asyncio.Queue(maxsize=100)

    # Start processing in background
    background_tasks.add_task(run_detection_pipeline, job_id, storage_key)

    return {
        "job_id": job_id,
        "status": "pending",
        "storage_key": storage_key,
    }


async def run_detection_pipeline(job_id: str, storage_key: str):
    """Run detection in background."""
    storage = get_storage()
    tmp_path = None

    try:
        await update_job(
            job_id,
            status="processing",
            started_at=datetime.utcnow(),
            current_step="Downloading video",
        )
        await _emit_progress(job_id, "Downloading video", 0)

        # Download video to temp file
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = Path(tmp.name)

        logger.info(f"Downloading {storage_key} to {tmp_path}")
        storage.download_to_file(storage_key, tmp_path)

        await _emit_progress(job_id, "Downloading video", 100)

        # Import detection pipeline
        from golfclip_detection import ShotDetectionPipeline

        pipeline = ShotDetectionPipeline(tmp_path)

        def progress_callback(step: str, progress: float):
            """Sync wrapper for async progress callback."""
            if job_id in _progress_queues:
                try:
                    _progress_queues[job_id].put_nowait({
                        "job_id": job_id,
                        "step": step,
                        "progress": progress,
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                except asyncio.QueueFull:
                    pass

        shots = await pipeline.detect_shots(progress_callback=progress_callback)

        # Store shots
        shot_dicts = [shot.model_dump() for shot in shots]
        await create_shots(job_id, shot_dicts)

        # Update job status
        needs_review = sum(1 for s in shots if s.confidence < settings.confidence_threshold)
        status = "review" if needs_review > 0 else "complete"

        await update_job(
            job_id,
            status=status,
            progress=100,
            current_step="Complete",
            completed_at=datetime.utcnow(),
            total_shots_detected=len(shots),
            shots_needing_review=needs_review,
        )

        # Emit completion event
        await _emit_progress(job_id, "Complete", 100, f"Found {len(shots)} shots")

        logger.info(f"Job {job_id} complete: {len(shots)} shots detected")

    except Exception as e:
        logger.exception(f"Pipeline error for job {job_id}")
        await update_job(
            job_id,
            status="error",
            error={"code": "PROCESSING_ERROR", "message": str(e)},
            completed_at=datetime.utcnow(),
        )
        await _emit_progress(job_id, "Error", 0, str(e))

    finally:
        # Cleanup temp file
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to delete temp file {tmp_path}: {e}")

        # Cleanup queue after delay
        async def cleanup():
            await asyncio.sleep(60)
            _progress_queues.pop(job_id, None)
            _remove_from_cache(job_id)

        asyncio.create_task(cleanup())


@router.get("/status/{job_id}")
async def get_status(job_id: str):
    """Get job status."""
    job = _get_cached_job(job_id) or await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job_id,
        "status": job.get("status", "unknown"),
        "progress": job.get("progress", 0),
        "current_step": job.get("current_step", "Unknown"),
        "total_shots_detected": job.get("total_shots_detected", 0),
        "shots_needing_review": job.get("shots_needing_review", 0),
        "error": job.get("error"),
    }


@router.get("/progress/{job_id}")
async def get_progress_stream(job_id: str):
    """SSE endpoint for real-time progress updates."""
    job = _get_cached_job(job_id) or await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        """Generate SSE events from the progress queue."""
        queue = _progress_queues.get(job_id)
        if not queue:
            # Job may have completed before SSE connection
            final_job = await get_job(job_id)
            if final_job:
                yield sse_event("complete", {
                    "job_id": job_id,
                    "status": final_job.get("status"),
                    "total_shots_detected": final_job.get("total_shots_detected", 0),
                    "shots_needing_review": final_job.get("shots_needing_review", 0),
                })
            return

        try:
            while True:
                try:
                    # Wait for progress event with timeout
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)

                    # Determine event type
                    step = event.get("step", "")
                    if step == "Complete":
                        yield sse_event("complete", event)
                        break
                    elif step == "Error":
                        yield sse_event("error", event)
                        break
                    else:
                        yield sse_event("progress", event)

                except asyncio.TimeoutError:
                    # Send keepalive
                    yield ": keepalive\n\n"

        except asyncio.CancelledError:
            logger.debug(f"SSE connection cancelled for job {job_id}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/shots/{job_id}")
async def get_shots(job_id: str):
    """Get detected shots for a job."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    shots = await get_shots_for_job(job_id)
    return {"shots": shots, "count": len(shots)}


@router.post("/shots/{job_id}/update")
async def update_shot_boundaries(job_id: str, shot_id: int, clip_start: float, clip_end: float):
    """Update shot clip boundaries after review."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    await update_shot(job_id, shot_id, clip_start=clip_start, clip_end=clip_end)
    return {"status": "updated", "shot_id": shot_id}


@router.get("/video/{storage_key:path}")
async def stream_video(storage_key: str):
    """Redirect to presigned R2 URL for video streaming."""
    storage = get_storage()

    if not storage.exists(storage_key):
        raise HTTPException(status_code=404, detail="Video not found")

    # Generate presigned URL valid for 1 hour
    url = storage.get_presigned_url(storage_key, expires_in=3600)
    return RedirectResponse(url=url)


@router.get("/jobs")
async def list_jobs(limit: int = 100, offset: int = 0):
    """List all jobs."""
    jobs = await get_all_jobs(limit=limit, offset=offset)
    return {"jobs": jobs, "count": len(jobs)}


@router.delete("/jobs/{job_id}")
async def remove_job(job_id: str, delete_video: bool = False):
    """Delete a job and optionally its source video."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    deleted_files = []

    # Optionally delete video from R2
    if delete_video and job.get("storage_key"):
        storage = get_storage()
        try:
            storage.delete(job["storage_key"])
            deleted_files.append(job["storage_key"])
        except Exception as e:
            logger.warning(f"Failed to delete video {job['storage_key']}: {e}")

    # Delete job from database
    await delete_job(job_id)
    _remove_from_cache(job_id)

    return {"status": "deleted", "job_id": job_id, "deleted_files": deleted_files}


@router.post("/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    """Delete source video after export (free tier cleanup)."""
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    storage = get_storage()
    deleted = []

    if job.get("storage_key"):
        try:
            storage.delete(job["storage_key"])
            deleted.append(job["storage_key"])
            await update_job(job_id, storage_key=None)
            logger.info(f"Cleaned up video for job {job_id}: {job['storage_key']}")
        except Exception as e:
            logger.warning(f"Failed to delete {job['storage_key']}: {e}")

    return {"status": "cleaned", "deleted": deleted}


@router.get("/health")
async def health():
    """Health check."""
    return {"status": "healthy", "mode": "cloud"}
