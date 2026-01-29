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


# ============================================================================
# Origin Feedback CRUD Operations (for ML training on ball origin detection)
# ============================================================================


async def create_origin_feedback(
    job_id: str,
    shot_id: int,
    video_path: str,
    strike_time: float,
    frame_width: int,
    frame_height: int,
    manual_origin_x: float,
    manual_origin_y: float,
    auto_origin_x: Optional[float] = None,
    auto_origin_y: Optional[float] = None,
    auto_confidence: Optional[float] = None,
    auto_method: Optional[str] = None,
    shaft_score: Optional[float] = None,
    clubhead_detected: Optional[bool] = None,
    environment: str = "prod",
) -> dict:
    """Store origin feedback capturing user corrections to ball origin detection.

    Args:
        job_id: The job ID
        shot_id: The shot number within the job
        video_path: Path to the video file
        strike_time: Time of ball strike in seconds
        frame_width: Video frame width
        frame_height: Video frame height
        manual_origin_x: User-marked origin X (normalized 0-1)
        manual_origin_y: User-marked origin Y (normalized 0-1)
        auto_origin_x: Auto-detected origin X (normalized 0-1), None if detection failed
        auto_origin_y: Auto-detected origin Y (normalized 0-1), None if detection failed
        auto_confidence: Auto-detection confidence (0-1)
        auto_method: Detection method used (e.g., "shaft+clubhead", "clubhead_only", "fallback")
        shaft_score: Shaft detection score (0-1)
        clubhead_detected: Whether clubhead was successfully detected
        environment: Environment tag (default: 'prod')

    Returns:
        Dict with the created feedback record
    """
    db = await get_db()

    # Compute error if auto-detection was available
    error_dx = None
    error_dy = None
    error_distance = None
    if auto_origin_x is not None and auto_origin_y is not None:
        error_dx = manual_origin_x - auto_origin_x
        error_dy = manual_origin_y - auto_origin_y
        error_distance = (error_dx ** 2 + error_dy ** 2) ** 0.5

    created_at = datetime.utcnow().isoformat()

    cursor = await db.execute(
        """
        INSERT INTO origin_feedback (
            job_id, shot_id, video_path, strike_time,
            frame_width, frame_height,
            auto_origin_x, auto_origin_y, auto_confidence, auto_method,
            shaft_score, clubhead_detected,
            manual_origin_x, manual_origin_y,
            error_dx, error_dy, error_distance,
            created_at, environment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id, shot_id, video_path, strike_time,
            frame_width, frame_height,
            auto_origin_x, auto_origin_y, auto_confidence, auto_method,
            shaft_score, 1 if clubhead_detected else (0 if clubhead_detected is False else None),
            manual_origin_x, manual_origin_y,
            error_dx, error_dy, error_distance,
            created_at, environment,
        ),
    )
    await db.commit()

    feedback_id = cursor.lastrowid
    logger.info(
        f"Created origin feedback {feedback_id} for job={job_id} shot={shot_id} "
        f"error_distance={error_distance:.4f if error_distance else 'N/A'}"
    )

    return {
        "id": feedback_id,
        "job_id": job_id,
        "shot_id": shot_id,
        "video_path": video_path,
        "strike_time": strike_time,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "auto_origin": {
            "x": auto_origin_x,
            "y": auto_origin_y,
            "confidence": auto_confidence,
            "method": auto_method,
        } if auto_origin_x is not None else None,
        "manual_origin": {
            "x": manual_origin_x,
            "y": manual_origin_y,
        },
        "detection_metadata": {
            "shaft_score": shaft_score,
            "clubhead_detected": clubhead_detected,
        },
        "error": {
            "dx": error_dx,
            "dy": error_dy,
            "distance": error_distance,
        } if error_distance is not None else None,
        "created_at": created_at,
        "environment": environment,
    }


async def export_origin_feedback(environment: Optional[str] = None) -> dict:
    """Export all origin feedback data for ML analysis.

    Args:
        environment: Optional filter by environment ('prod', 'dev', etc.)

    Returns:
        Dict with:
        - exported_at: ISO timestamp of export
        - total_records: Number of records exported
        - records: List of feedback records
        - stats: Aggregate statistics
    """
    db = await get_db()

    # Build query with optional environment filter
    query = "SELECT * FROM origin_feedback"
    params = []
    if environment is not None:
        query += " WHERE environment = ?"
        params.append(environment)
    query += " ORDER BY created_at"

    async with db.execute(query, params) as cursor:
        rows = await cursor.fetchall()

    records_list = []
    error_distances = []
    by_method: dict[str, dict] = {}

    for row in rows:
        feedback = _origin_feedback_row_to_dict(row)
        records_list.append(feedback)

        # Collect stats
        if feedback["error"] and feedback["error"]["distance"] is not None:
            error_distances.append(feedback["error"]["distance"])

        method = feedback["auto_origin"]["method"] if feedback["auto_origin"] else "none"
        if method not in by_method:
            by_method[method] = {"count": 0, "errors": []}
        by_method[method]["count"] += 1
        if feedback["error"] and feedback["error"]["distance"] is not None:
            by_method[method]["errors"].append(feedback["error"]["distance"])

    # Compute aggregate stats
    stats = {
        "total": len(records_list),
        "mean_error_distance": sum(error_distances) / len(error_distances) if error_distances else None,
        "max_error_distance": max(error_distances) if error_distances else None,
        "min_error_distance": min(error_distances) if error_distances else None,
        "by_method": {},
    }

    for method, data in by_method.items():
        errors = data["errors"]
        stats["by_method"][method] = {
            "count": data["count"],
            "mean_error": sum(errors) / len(errors) if errors else None,
        }

    return {
        "exported_at": datetime.utcnow().isoformat(),
        "total_records": len(records_list),
        "records": records_list,
        "stats": stats,
    }


async def get_origin_feedback_stats() -> dict:
    """Get aggregate statistics on origin detection accuracy.

    Returns:
        Dict with statistics including correction rate, mean error, etc.
    """
    db = await get_db()

    # Total feedback count
    async with db.execute("SELECT COUNT(*) as count FROM origin_feedback") as cursor:
        row = await cursor.fetchone()
        total = row["count"]

    if total == 0:
        return {
            "total_feedback": 0,
            "correction_rate": 0.0,
            "mean_error_distance": None,
            "by_method": {},
        }

    # Mean error distance
    async with db.execute(
        "SELECT AVG(error_distance) as mean_error FROM origin_feedback WHERE error_distance IS NOT NULL"
    ) as cursor:
        row = await cursor.fetchone()
        mean_error = row["mean_error"]

    # Stats by detection method
    async with db.execute(
        """
        SELECT auto_method,
               COUNT(*) as count,
               AVG(error_distance) as mean_error
        FROM origin_feedback
        GROUP BY auto_method
        """
    ) as cursor:
        rows = await cursor.fetchall()

    # Schema expects by_method as dict[str, int] (just counts)
    by_method = {
        (row["auto_method"] or "none"): row["count"]
        for row in rows
    }

    # correction_rate is 1.0 since every record in origin_feedback is a user correction
    # (table only contains records where user provided manual origin)
    return {
        "total_feedback": total,
        "correction_rate": 1.0,
        "mean_error_distance": mean_error,
        "by_method": by_method,
    }


def _origin_feedback_row_to_dict(row) -> dict:
    """Convert database row to origin feedback dict."""
    auto_origin = None
    if row["auto_origin_x"] is not None:
        auto_origin = {
            "x": row["auto_origin_x"],
            "y": row["auto_origin_y"],
            "confidence": row["auto_confidence"],
            "method": row["auto_method"],
        }

    error = None
    if row["error_distance"] is not None:
        error = {
            "dx": row["error_dx"],
            "dy": row["error_dy"],
            "distance": row["error_distance"],
        }

    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "video_path": row["video_path"],
        "strike_time": row["strike_time"],
        "frame_width": row["frame_width"],
        "frame_height": row["frame_height"],
        "auto_origin": auto_origin,
        "manual_origin": {
            "x": row["manual_origin_x"],
            "y": row["manual_origin_y"],
        },
        "detection_metadata": {
            "shaft_score": row["shaft_score"],
            "clubhead_detected": bool(row["clubhead_detected"]) if row["clubhead_detected"] is not None else None,
        },
        "error": error,
        "created_at": row["created_at"],
        "environment": row["environment"],
    }
