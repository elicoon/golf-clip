"""CRUD operations for shot trajectory data."""

from datetime import datetime
from typing import Optional

from loguru import logger

from backend.core.database import get_db, serialize_json, deserialize_json


async def create_trajectory(
    job_id: str,
    shot_id: int,
    trajectory_points: list[dict],
    confidence: float,
    smoothness_score: Optional[float] = None,
    physics_plausibility: Optional[float] = None,
    apex_point: Optional[dict] = None,
    launch_angle: Optional[float] = None,
    flight_duration: Optional[float] = None,
    has_gaps: bool = False,
    gap_count: int = 0,
    frame_width: int = 1920,
    frame_height: int = 1080,
) -> int:
    """Store a trajectory for a shot.

    Args:
        job_id: The job ID
        shot_id: The shot number within the job
        trajectory_points: List of dicts with keys: timestamp, x, y, confidence, interpolated
                          x and y should be normalized to 0-1 range
        confidence: Overall trajectory confidence (0-1)
        smoothness_score: How smooth the trajectory is (0-1)
        physics_plausibility: How physically realistic (0-1)
        apex_point: Highest point dict with timestamp, x, y
        launch_angle: Estimated launch angle in degrees
        flight_duration: Ball flight time in seconds
        has_gaps: Whether trajectory has detection gaps
        gap_count: Number of interpolated points
        frame_width: Source video frame width (for denormalization)
        frame_height: Source video frame height

    Returns:
        The trajectory record ID
    """
    db = await get_db()

    # Normalize coordinates if they aren't already
    normalized_points = []
    for pt in trajectory_points:
        x = pt["x"]
        y = pt["y"]
        # If coordinates are in pixel space, normalize them
        if x > 1 or y > 1:
            x = x / frame_width
            y = y / frame_height
        normalized_points.append({
            "timestamp": pt["timestamp"],
            "x": x,
            "y": y,
            "confidence": pt.get("confidence", 0),
            "interpolated": pt.get("interpolated", False),
        })

    apex_x = None
    apex_y = None
    apex_timestamp = None
    if apex_point:
        apex_x = apex_point.get("x", 0)
        apex_y = apex_point.get("y", 0)
        if apex_x > 1:
            apex_x = apex_x / frame_width
        if apex_y > 1:
            apex_y = apex_y / frame_height
        apex_timestamp = apex_point.get("timestamp")

    cursor = await db.execute(
        """
        INSERT INTO shot_trajectories (
            job_id, shot_id, trajectory_json, confidence,
            smoothness_score, physics_plausibility,
            apex_x, apex_y, apex_timestamp,
            launch_angle, flight_duration,
            has_gaps, gap_count, is_manual_override,
            frame_width, frame_height, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, shot_id) DO UPDATE SET
            trajectory_json = excluded.trajectory_json,
            confidence = excluded.confidence,
            smoothness_score = excluded.smoothness_score,
            physics_plausibility = excluded.physics_plausibility,
            apex_x = excluded.apex_x,
            apex_y = excluded.apex_y,
            apex_timestamp = excluded.apex_timestamp,
            launch_angle = excluded.launch_angle,
            flight_duration = excluded.flight_duration,
            has_gaps = excluded.has_gaps,
            gap_count = excluded.gap_count,
            frame_width = excluded.frame_width,
            frame_height = excluded.frame_height,
            updated_at = ?
        """,
        (
            job_id, shot_id, serialize_json(normalized_points), confidence,
            smoothness_score, physics_plausibility,
            apex_x, apex_y, apex_timestamp,
            launch_angle, flight_duration,
            1 if has_gaps else 0, gap_count, 0,
            frame_width, frame_height, datetime.utcnow().isoformat(),
            datetime.utcnow().isoformat(),
        ),
    )
    await db.commit()

    logger.debug(f"Stored trajectory for job={job_id} shot={shot_id} with {len(normalized_points)} points")
    return cursor.lastrowid


async def get_trajectory(job_id: str, shot_id: int) -> Optional[dict]:
    """Get trajectory data for a specific shot.

    Returns:
        Dict with trajectory data or None if not found
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT * FROM shot_trajectories
        WHERE job_id = ? AND shot_id = ?
        """,
        (job_id, shot_id),
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        return None

    return _row_to_dict(row)


async def get_trajectories_for_job(job_id: str) -> list[dict]:
    """Get all trajectories for a job.

    Returns:
        List of trajectory dicts ordered by shot_id
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT * FROM shot_trajectories
        WHERE job_id = ?
        ORDER BY shot_id
        """,
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [_row_to_dict(row) for row in rows]


async def update_trajectory(
    job_id: str,
    shot_id: int,
    trajectory_points: list[dict],
    is_manual_override: bool = True,
) -> bool:
    """Update trajectory with manual edits.

    Args:
        job_id: The job ID
        shot_id: The shot number
        trajectory_points: New trajectory points (normalized 0-1 coords)
        is_manual_override: Whether this is a manual edit

    Returns:
        True if updated, False if trajectory not found
    """
    db = await get_db()

    cursor = await db.execute(
        """
        UPDATE shot_trajectories
        SET trajectory_json = ?,
            is_manual_override = ?,
            updated_at = ?
        WHERE job_id = ? AND shot_id = ?
        """,
        (
            serialize_json(trajectory_points),
            1 if is_manual_override else 0,
            datetime.utcnow().isoformat(),
            job_id,
            shot_id,
        ),
    )
    await db.commit()

    return cursor.rowcount > 0


async def delete_trajectory(job_id: str, shot_id: int) -> bool:
    """Delete a trajectory record.

    Returns:
        True if deleted, False if not found
    """
    db = await get_db()

    cursor = await db.execute(
        "DELETE FROM shot_trajectories WHERE job_id = ? AND shot_id = ?",
        (job_id, shot_id),
    )
    await db.commit()

    return cursor.rowcount > 0


def _row_to_dict(row) -> dict:
    """Convert database row to trajectory dict."""
    points = deserialize_json(row["trajectory_json"]) or []

    apex_point = None
    if row["apex_x"] is not None and row["apex_y"] is not None:
        apex_point = {
            "x": row["apex_x"],
            "y": row["apex_y"],
            "timestamp": row["apex_timestamp"],
        }

    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "points": points,
        "confidence": row["confidence"],
        "smoothness_score": row["smoothness_score"],
        "physics_plausibility": row["physics_plausibility"],
        "apex_point": apex_point,
        "launch_angle": row["launch_angle"],
        "flight_duration": row["flight_duration"],
        "has_gaps": bool(row["has_gaps"]),
        "gap_count": row["gap_count"],
        "is_manual_override": bool(row["is_manual_override"]),
        "frame_width": row["frame_width"],
        "frame_height": row["frame_height"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
