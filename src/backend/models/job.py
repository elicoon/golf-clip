"""Database operations for Job and Shot models."""

from datetime import datetime
from typing import Any, Optional

import aiosqlite
from loguru import logger

from backend.core.database import get_db, serialize_json, deserialize_json


def job_row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a database row to a job dictionary matching the API schema."""
    return {
        "id": row["id"],
        "video_path": row["video_path"],
        "output_dir": row["output_dir"],
        "status": row["status"],
        "progress": row["progress"],
        "current_step": row["current_step"],
        "auto_approve": bool(row["auto_approve"]),
        "video_info": deserialize_json(row["video_info_json"]),
        "created_at": row["created_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "error": deserialize_json(row["error_json"]),
        "cancelled": bool(row["cancelled"]),
        "total_shots_detected": row["total_shots_detected"],
        "shots_needing_review": row["shots_needing_review"],
        "shots": [],  # Populated separately
    }


def shot_row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a database row to a shot dictionary matching the API schema."""
    return {
        "id": row["shot_number"],  # Use shot_number as the API-facing ID
        "strike_time": row["strike_time"],
        "landing_time": row["landing_time"],
        "clip_start": row["clip_start"],
        "clip_end": row["clip_end"],
        "confidence": row["confidence"],
        "shot_type": row["shot_type"],
        "audio_confidence": row["audio_confidence"],
        "visual_confidence": row["visual_confidence"],
        "confidence_reasons": deserialize_json(row["confidence_reasons_json"]) or [],
    }


async def create_job(
    job_id: str,
    video_path: str,
    output_dir: str,
    auto_approve: bool,
    video_info: Optional[dict],
) -> dict[str, Any]:
    """Create a new job in the database.

    Args:
        job_id: Unique job identifier (UUID).
        video_path: Path to the input video file.
        output_dir: Directory for output clips.
        auto_approve: Whether to auto-approve high confidence shots.
        video_info: Video metadata dictionary.

    Returns:
        The created job as a dictionary.
    """
    db = await get_db()
    created_at = datetime.utcnow().isoformat()

    await db.execute(
        """
        INSERT INTO jobs (
            id, video_path, output_dir, status, progress, current_step,
            auto_approve, video_info_json, created_at, cancelled,
            total_shots_detected, shots_needing_review
        ) VALUES (?, ?, ?, 'pending', 0, 'Initializing', ?, ?, ?, 0, 0, 0)
        """,
        (
            job_id,
            video_path,
            output_dir,
            int(auto_approve),
            serialize_json(video_info),
            created_at,
        ),
    )
    await db.commit()

    logger.debug(f"Created job {job_id} in database")

    return {
        "id": job_id,
        "video_path": video_path,
        "output_dir": output_dir,
        "status": "pending",
        "progress": 0,
        "current_step": "Initializing",
        "auto_approve": auto_approve,
        "video_info": video_info,
        "created_at": created_at,
        "started_at": None,
        "completed_at": None,
        "error": None,
        "cancelled": False,
        "total_shots_detected": 0,
        "shots_needing_review": 0,
        "shots": [],
    }


async def get_job(job_id: str, include_shots: bool = True) -> Optional[dict[str, Any]]:
    """Get a job by ID.

    Args:
        job_id: The job ID to look up.
        include_shots: Whether to include shots in the result.

    Returns:
        The job as a dictionary, or None if not found.
    """
    db = await get_db()

    async with db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)) as cursor:
        row = await cursor.fetchone()

    if not row:
        return None

    job = job_row_to_dict(row)

    if include_shots:
        job["shots"] = await get_shots_for_job(job_id)

    return job


async def get_all_jobs(
    limit: int = 50,
    status: Optional[str] = None,
    include_shots: bool = False,
) -> list[dict[str, Any]]:
    """Get all jobs with optional filtering.

    Args:
        limit: Maximum number of jobs to return.
        status: Filter by status if provided.
        include_shots: Whether to include shots in each job.

    Returns:
        List of jobs as dictionaries.
    """
    db = await get_db()

    if status:
        query = "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?"
        params = (status, limit)
    else:
        query = "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?"
        params = (limit,)

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    jobs = []
    for row in rows:
        job = job_row_to_dict(row)
        if include_shots:
            job["shots"] = await get_shots_for_job(job["id"])
        jobs.append(job)

    return jobs


# Valid column names for job updates (prevents SQL injection)
_VALID_JOB_COLUMNS = {
    "video_path", "output_dir", "status", "progress", "current_step",
    "auto_approve", "video_info_json", "created_at", "started_at",
    "completed_at", "error_json", "cancelled", "total_shots_detected",
    "shots_needing_review",
}


async def update_job(job_id: str, **updates: Any) -> bool:
    """Update a job in the database.

    Args:
        job_id: The job ID to update.
        **updates: Fields to update. Special handling for 'error' and 'video_info'
                   which are serialized to JSON.

    Returns:
        True if the job was updated, False if not found.

    Raises:
        ValueError: If an invalid column name is provided.
    """
    db = await get_db()

    # Handle JSON fields
    if "error" in updates:
        updates["error_json"] = serialize_json(updates.pop("error"))
    if "video_info" in updates:
        updates["video_info_json"] = serialize_json(updates.pop("video_info"))

    # Validate column names to prevent SQL injection
    for key in updates.keys():
        if key not in _VALID_JOB_COLUMNS:
            raise ValueError(f"Invalid column name for job update: {key}")

    # Build update query dynamically
    set_clauses = []
    values = []
    for key, value in updates.items():
        # Convert booleans to integers for SQLite
        if isinstance(value, bool):
            value = int(value)
        set_clauses.append(f"{key} = ?")
        values.append(value)

    if not set_clauses:
        return True  # Nothing to update

    values.append(job_id)
    query = f"UPDATE jobs SET {', '.join(set_clauses)} WHERE id = ?"

    cursor = await db.execute(query, values)
    await db.commit()

    return cursor.rowcount > 0


async def delete_job(job_id: str) -> bool:
    """Delete a job and its associated shots.

    Args:
        job_id: The job ID to delete.

    Returns:
        True if the job was deleted, False if not found.
    """
    db = await get_db()

    # Shots are deleted automatically due to ON DELETE CASCADE
    cursor = await db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    await db.commit()

    deleted = cursor.rowcount > 0
    if deleted:
        logger.debug(f"Deleted job {job_id} from database")

    return deleted


async def create_shots(job_id: str, shots: list[dict[str, Any]]) -> None:
    """Create multiple shots for a job.

    Args:
        job_id: The job ID these shots belong to.
        shots: List of shot dictionaries from the detection pipeline.
    """
    db = await get_db()

    # Prepare data for batch insert
    shot_data = [
        (
            job_id,
            shot.get("id", idx + 1),  # shot_number
            shot["strike_time"],
            shot.get("landing_time"),
            shot["clip_start"],
            shot["clip_end"],
            shot["confidence"],
            shot.get("shot_type"),
            shot.get("audio_confidence", 0),
            shot.get("visual_confidence", 0),
            serialize_json(shot.get("confidence_reasons", [])),
        )
        for idx, shot in enumerate(shots)
    ]

    await db.executemany(
        """
        INSERT INTO shots (
            job_id, shot_number, strike_time, landing_time,
            clip_start, clip_end, confidence, shot_type,
            audio_confidence, visual_confidence, confidence_reasons_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        shot_data,
    )
    await db.commit()

    logger.debug(f"Created {len(shots)} shots for job {job_id}")


async def get_shots_for_job(job_id: str) -> list[dict[str, Any]]:
    """Get all shots for a job.

    Args:
        job_id: The job ID to get shots for.

    Returns:
        List of shots as dictionaries.
    """
    db = await get_db()

    async with db.execute(
        "SELECT * FROM shots WHERE job_id = ? ORDER BY shot_number",
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [shot_row_to_dict(row) for row in rows]


# Valid column names for shot updates (prevents SQL injection)
_VALID_SHOT_COLUMNS = {
    "shot_number", "strike_time", "landing_time", "clip_start", "clip_end",
    "confidence", "shot_type", "audio_confidence", "visual_confidence",
    "confidence_reasons_json",
}


async def update_shot(job_id: str, shot_id: int, **updates: Any) -> bool:
    """Update a shot in the database.

    Args:
        job_id: The job ID the shot belongs to.
        shot_id: The shot number to update.
        **updates: Fields to update. Special handling for 'confidence_reasons'.

    Returns:
        True if the shot was updated, False if not found.

    Raises:
        ValueError: If an invalid column name is provided.
    """
    db = await get_db()

    # Handle JSON fields
    if "confidence_reasons" in updates:
        updates["confidence_reasons_json"] = serialize_json(updates.pop("confidence_reasons"))

    # Handle the id -> shot_number mapping
    if "id" in updates:
        updates["shot_number"] = updates.pop("id")

    # Validate column names to prevent SQL injection
    for key in updates.keys():
        if key not in _VALID_SHOT_COLUMNS:
            raise ValueError(f"Invalid column name for shot update: {key}")

    # Build update query dynamically
    set_clauses = []
    values = []
    for key, value in updates.items():
        set_clauses.append(f"{key} = ?")
        values.append(value)

    if not set_clauses:
        return True  # Nothing to update

    values.extend([job_id, shot_id])
    query = f"UPDATE shots SET {', '.join(set_clauses)} WHERE job_id = ? AND shot_number = ?"

    cursor = await db.execute(query, values)
    await db.commit()

    return cursor.rowcount > 0


async def load_jobs_into_memory() -> dict[str, dict[str, Any]]:
    """Load all jobs from database into a dictionary (for startup compatibility).

    This provides backward compatibility with the in-memory jobs dict approach.

    Returns:
        Dictionary mapping job_id -> job dict with shots included.
    """
    jobs = await get_all_jobs(limit=1000, include_shots=True)
    return {job["id"]: job for job in jobs}
