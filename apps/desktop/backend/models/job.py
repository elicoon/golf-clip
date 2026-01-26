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
        "landing_x": row["landing_x"],
        "landing_y": row["landing_y"],
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
    "confidence_reasons_json", "landing_x", "landing_y",
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


async def update_shot_landing(
    job_id: str,
    shot_id: int,
    landing_x: float,
    landing_y: float,
) -> bool:
    """Update the landing point for a shot.

    Args:
        job_id: The job ID the shot belongs to.
        shot_id: The shot number to update.
        landing_x: Normalized x-coordinate (0-1) of landing position.
        landing_y: Normalized y-coordinate (0-1) of landing position.

    Returns:
        True if the shot was updated, False if not found.
    """
    db = await get_db()

    cursor = await db.execute(
        "UPDATE shots SET landing_x = ?, landing_y = ? WHERE job_id = ? AND shot_number = ?",
        (landing_x, landing_y, job_id, shot_id),
    )
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


# ============================================================================
# Shot Feedback Functions
# ============================================================================


def feedback_row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a database row to a feedback dictionary."""
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "feedback_type": row["feedback_type"],
        "notes": row["notes"],
        "confidence_snapshot": row["confidence_snapshot"],
        "audio_confidence_snapshot": row["audio_confidence_snapshot"],
        "visual_confidence_snapshot": row["visual_confidence_snapshot"],
        "detection_features": deserialize_json(row["detection_features_json"]),
        "created_at": row["created_at"],
    }


async def create_feedback(
    job_id: str,
    shot_id: int,
    feedback_type: str,
    notes: Optional[str] = None,
    confidence_snapshot: Optional[float] = None,
    audio_confidence_snapshot: Optional[float] = None,
    visual_confidence_snapshot: Optional[float] = None,
    detection_features: Optional[dict] = None,
) -> dict[str, Any]:
    """Create a feedback record for a shot.

    Args:
        job_id: The job ID the shot belongs to.
        shot_id: The shot number being rated.
        feedback_type: Either 'true_positive' or 'false_positive'.
        notes: Optional user notes about the feedback.
        confidence_snapshot: The shot's confidence at feedback time.
        audio_confidence_snapshot: Audio confidence at feedback time.
        visual_confidence_snapshot: Visual confidence at feedback time.
        detection_features: Full detection feature dict for ML training.

    Returns:
        The created feedback record as a dictionary.
    """
    db = await get_db()
    created_at = datetime.utcnow().isoformat()

    cursor = await db.execute(
        """
        INSERT INTO shot_feedback (
            job_id, shot_id, feedback_type, notes,
            confidence_snapshot, audio_confidence_snapshot,
            visual_confidence_snapshot, detection_features_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            shot_id,
            feedback_type,
            notes,
            confidence_snapshot,
            audio_confidence_snapshot,
            visual_confidence_snapshot,
            serialize_json(detection_features),
            created_at,
        ),
    )
    await db.commit()

    feedback_id = cursor.lastrowid
    logger.debug(f"Created feedback {feedback_id} for job {job_id}, shot {shot_id}: {feedback_type}")

    return {
        "id": feedback_id,
        "job_id": job_id,
        "shot_id": shot_id,
        "feedback_type": feedback_type,
        "notes": notes,
        "confidence_snapshot": confidence_snapshot,
        "audio_confidence_snapshot": audio_confidence_snapshot,
        "visual_confidence_snapshot": visual_confidence_snapshot,
        "detection_features": detection_features,
        "created_at": created_at,
    }


async def get_feedback_for_job(job_id: str) -> list[dict[str, Any]]:
    """Get all feedback records for a job.

    Args:
        job_id: The job ID to get feedback for.

    Returns:
        List of feedback records as dictionaries.
    """
    db = await get_db()

    async with db.execute(
        "SELECT * FROM shot_feedback WHERE job_id = ? ORDER BY shot_id",
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [feedback_row_to_dict(row) for row in rows]


async def get_all_feedback(
    limit: int = 1000,
    offset: int = 0,
    feedback_type: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Get all feedback records with optional filtering.

    Args:
        limit: Maximum records to return.
        offset: Number of records to skip (for pagination).
        feedback_type: Filter by feedback type if provided.

    Returns:
        List of feedback records as dictionaries.
    """
    db = await get_db()

    if feedback_type:
        query = """
            SELECT * FROM shot_feedback
            WHERE feedback_type = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        params = (feedback_type, limit, offset)
    else:
        query = """
            SELECT * FROM shot_feedback
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        params = (limit, offset)

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    return [feedback_row_to_dict(row) for row in rows]


async def get_feedback_stats() -> dict[str, Any]:
    """Get aggregate statistics on collected feedback.

    Returns:
        Dictionary with total counts and precision metric.
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN feedback_type = 'true_positive' THEN 1 ELSE 0 END) as tp,
            SUM(CASE WHEN feedback_type = 'false_positive' THEN 1 ELSE 0 END) as fp
        FROM shot_feedback
        """
    ) as cursor:
        row = await cursor.fetchone()

    total = row["total"] or 0
    tp = row["tp"] or 0
    fp = row["fp"] or 0

    # Precision = TP / (TP + FP), handle division by zero
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0

    return {
        "total_feedback": total,
        "true_positives": tp,
        "false_positives": fp,
        "precision": round(precision, 4),
    }
