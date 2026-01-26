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


# ============================================================================
# Tracer Feedback CRUD Operations
# ============================================================================


async def create_tracer_feedback(
    job_id: str,
    shot_id: int,
    feedback_type: str,
    auto_params: Optional[dict],
    final_params: Optional[dict],
    origin_point: Optional[dict],
    landing_point: Optional[dict],
    apex_point: Optional[dict] = None,
    environment: str = "prod",
) -> dict:
    """Store tracer feedback capturing user corrections to auto-generated trajectories.

    Args:
        job_id: The job ID
        shot_id: The shot number within the job
        feedback_type: One of: tracer_auto_accepted, tracer_configured,
                       tracer_reluctant_accept, tracer_skip, tracer_rejected
        auto_params: The auto-generated trajectory parameters
        final_params: The user's final configured parameters (null if auto-accepted)
        origin_point: Ball origin point dict with x, y
        landing_point: User-marked landing point dict with x, y
        apex_point: Optional apex point dict with x, y
        environment: Environment tag (default: 'prod')

    Returns:
        Dict with the created feedback record
    """
    db = await get_db()

    created_at = datetime.utcnow().isoformat()

    cursor = await db.execute(
        """
        INSERT INTO tracer_feedback (
            job_id, shot_id, feedback_type,
            auto_params_json, final_params_json,
            origin_point_json, landing_point_json, apex_point_json,
            created_at, environment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            shot_id,
            feedback_type,
            serialize_json(auto_params),
            serialize_json(final_params),
            serialize_json(origin_point),
            serialize_json(landing_point),
            serialize_json(apex_point),
            created_at,
            environment,
        ),
    )
    await db.commit()

    feedback_id = cursor.lastrowid
    logger.debug(f"Created tracer feedback {feedback_id} for job={job_id} shot={shot_id} type={feedback_type}")

    return {
        "id": feedback_id,
        "job_id": job_id,
        "shot_id": shot_id,
        "feedback_type": feedback_type,
        "auto_params": auto_params,
        "final_params": final_params,
        "origin_point": origin_point,
        "landing_point": landing_point,
        "apex_point": apex_point,
        "created_at": created_at,
        "environment": environment,
    }


async def get_tracer_feedback(feedback_id: int) -> Optional[dict]:
    """Get tracer feedback by ID.

    Args:
        feedback_id: The feedback record ID

    Returns:
        Dict with feedback data or None if not found
    """
    db = await get_db()

    async with db.execute(
        "SELECT * FROM tracer_feedback WHERE id = ?",
        (feedback_id,),
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        return None

    return _tracer_feedback_row_to_dict(row)


async def get_tracer_feedback_for_job(job_id: str) -> list[dict]:
    """Get all tracer feedback for a job.

    Args:
        job_id: The job ID

    Returns:
        List of feedback dicts ordered by shot_id
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT * FROM tracer_feedback
        WHERE job_id = ?
        ORDER BY shot_id
        """,
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [_tracer_feedback_row_to_dict(row) for row in rows]


async def export_tracer_feedback(environment: Optional[str] = None) -> dict:
    """Export all tracer feedback data with computed deltas for ML analysis.

    Args:
        environment: Optional filter by environment ('prod', 'dev', etc.)

    Returns:
        Dict with:
        - feedback: List of feedback records with computed deltas
        - stats: Aggregate statistics
    """
    db = await get_db()

    # Build query with optional environment filter
    query = "SELECT * FROM tracer_feedback"
    params = []
    if environment is not None:
        query += " WHERE environment = ?"
        params.append(environment)
    query += " ORDER BY created_at"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    feedback_list = []
    stats_by_type: dict[str, int] = {}

    for row in rows:
        feedback = _tracer_feedback_row_to_dict(row)

        # Compute deltas between auto and final params
        deltas = _compute_param_deltas(feedback["auto_params"], feedback["final_params"])
        feedback["deltas"] = deltas

        feedback_list.append(feedback)

        # Count by type
        ftype = feedback["feedback_type"]
        stats_by_type[ftype] = stats_by_type.get(ftype, 0) + 1

    return {
        "feedback": feedback_list,
        "stats": {
            "total": len(feedback_list),
            "by_type": stats_by_type,
        },
    }


def _tracer_feedback_row_to_dict(row) -> dict:
    """Convert database row to tracer feedback dict."""
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "feedback_type": row["feedback_type"],
        "auto_params": deserialize_json(row["auto_params_json"]),
        "final_params": deserialize_json(row["final_params_json"]),
        "origin_point": deserialize_json(row["origin_point_json"]),
        "landing_point": deserialize_json(row["landing_point_json"]),
        "apex_point": deserialize_json(row["apex_point_json"]),
        "created_at": row["created_at"],
        "environment": row["environment"],
    }


def _compute_param_deltas(auto_params: Optional[dict], final_params: Optional[dict]) -> Optional[dict]:
    """Compute deltas between auto-generated and user-configured parameters.

    Args:
        auto_params: The auto-generated trajectory parameters
        final_params: The user's final configured parameters

    Returns:
        Dict mapping param names to {auto, final} values for params that differ,
        or None if no final_params (auto-accepted case)
    """
    if final_params is None or auto_params is None:
        return None

    deltas = {}
    all_keys = set(auto_params.keys()) | set(final_params.keys())

    for key in all_keys:
        auto_val = auto_params.get(key)
        final_val = final_params.get(key)
        if auto_val != final_val:
            deltas[key] = {"auto": auto_val, "final": final_val}

    return deltas if deltas else {}
