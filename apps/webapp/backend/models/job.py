"""Job and shot database operations for webapp."""

import json
from datetime import datetime
from typing import Any, Optional

from backend.core.database import get_pool


async def create_job(
    job_id: str,
    storage_key: str,
    original_filename: str,
    video_info: Optional[dict] = None,
) -> dict:
    """Create a new job."""
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO jobs (id, storage_key, original_filename, video_info, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            """,
            job_id,
            storage_key,
            original_filename,
            json.dumps(video_info) if video_info else None,
        )
    return await get_job(job_id)


async def get_job(job_id: str, include_shots: bool = False) -> Optional[dict]:
    """Get a job by ID."""
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id)
        if not row:
            return None

        job = dict(row)
        if job.get("video_info"):
            job["video_info"] = json.loads(job["video_info"])
        if job.get("error_json"):
            job["error"] = json.loads(job["error_json"])

        if include_shots:
            job["shots"] = await get_shots_for_job(job_id)

        return job


async def update_job(job_id: str, **kwargs) -> None:
    """Update job fields."""
    if not kwargs:
        return

    pool = get_pool()
    set_clauses = []
    values = []
    for i, (key, value) in enumerate(kwargs.items(), start=1):
        if key == "error":
            set_clauses.append(f"error_json = ${i}")
            values.append(json.dumps(value) if value else None)
        else:
            set_clauses.append(f"{key} = ${i}")
            values.append(value)

    values.append(job_id)
    query = f"UPDATE jobs SET {', '.join(set_clauses)} WHERE id = ${len(values)}"

    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def get_shots_for_job(job_id: str) -> list[dict]:
    """Get all shots for a job."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM shots WHERE job_id = $1 ORDER BY shot_number",
            job_id,
        )
        shots = []
        for row in rows:
            shot = dict(row)
            if shot.get("confidence_reasons"):
                shot["confidence_reasons"] = json.loads(shot["confidence_reasons"])
            shots.append(shot)
        return shots


async def create_shots(job_id: str, shots: list[dict]) -> None:
    """Create shots for a job."""
    pool = get_pool()
    async with pool.acquire() as conn:
        for i, shot in enumerate(shots, start=1):
            await conn.execute(
                """
                INSERT INTO shots (
                    job_id, shot_number, strike_time, clip_start, clip_end,
                    confidence, audio_confidence, visual_confidence,
                    confidence_reasons, landing_x, landing_y
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """,
                job_id,
                i,
                shot.get("strike_time"),
                shot.get("clip_start"),
                shot.get("clip_end"),
                shot.get("confidence"),
                shot.get("audio_confidence"),
                shot.get("visual_confidence"),
                json.dumps(shot.get("confidence_reasons")) if shot.get("confidence_reasons") else None,
                shot.get("landing_x"),
                shot.get("landing_y"),
            )


async def update_shot(job_id: str, shot_id: int, **kwargs) -> None:
    """Update shot fields."""
    if not kwargs:
        return

    pool = get_pool()
    set_clauses = []
    values = []
    for i, (key, value) in enumerate(kwargs.items(), start=1):
        if key == "confidence_reasons":
            set_clauses.append(f"confidence_reasons = ${i}")
            values.append(json.dumps(value) if value else None)
        else:
            set_clauses.append(f"{key} = ${i}")
            values.append(value)

    values.append(job_id)
    values.append(shot_id)
    query = f"UPDATE shots SET {', '.join(set_clauses)} WHERE job_id = ${len(values) - 1} AND shot_number = ${len(values)}"

    async with pool.acquire() as conn:
        await conn.execute(query, *values)


async def delete_job(job_id: str) -> bool:
    """Delete a job and its associated shots."""
    pool = get_pool()
    async with pool.acquire() as conn:
        # Shots are cascade-deleted due to FK constraint
        result = await conn.execute("DELETE FROM jobs WHERE id = $1", job_id)
        return "DELETE 1" in result


async def get_all_jobs(limit: int = 100, offset: int = 0) -> list[dict]:
    """Get all jobs, ordered by creation date."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, storage_key, original_filename, status, progress,
                   current_step, created_at, completed_at, total_shots_detected,
                   shots_needing_review
            FROM jobs
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        return [dict(row) for row in rows]
