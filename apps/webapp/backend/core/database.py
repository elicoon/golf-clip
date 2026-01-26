"""PostgreSQL database for webapp."""

from typing import Optional, Any
import asyncpg
from loguru import logger

from backend.core.config import settings

_pool: Optional[asyncpg.Pool] = None


async def init_db() -> None:
    """Initialize database connection pool."""
    global _pool

    logger.info("Connecting to PostgreSQL...")
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
    )

    async with _pool.acquire() as conn:
        await _run_migrations(conn)

    logger.info("Database initialized")


async def close_db() -> None:
    """Close database pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    """Get connection pool."""
    if _pool is None:
        raise RuntimeError("Database not initialized")
    return _pool


async def _run_migrations(conn: asyncpg.Connection) -> None:
    """Apply database migrations."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    row = await conn.fetchrow("SELECT MAX(version) as v FROM schema_version")
    current = row["v"] if row["v"] else 0

    if current < 1:
        await _migrate_v1(conn)


async def _migrate_v1(conn: asyncpg.Connection) -> None:
    """Initial schema."""
    logger.info("Applying migration v1")

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            storage_key TEXT,
            original_filename TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            progress REAL NOT NULL DEFAULT 0,
            current_step TEXT NOT NULL DEFAULT 'Initializing',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            error_json JSONB,
            video_info JSONB,
            total_shots_detected INTEGER DEFAULT 0,
            shots_needing_review INTEGER DEFAULT 0
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS shots (
            id SERIAL PRIMARY KEY,
            job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
            shot_number INTEGER NOT NULL,
            strike_time REAL NOT NULL,
            clip_start REAL NOT NULL,
            clip_end REAL NOT NULL,
            confidence REAL NOT NULL,
            audio_confidence REAL,
            visual_confidence REAL,
            confidence_reasons JSONB,
            landing_x REAL,
            landing_y REAL
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS shot_trajectories (
            id SERIAL PRIMARY KEY,
            job_id TEXT,
            shot_id INTEGER,
            points JSONB,
            apex_point JSONB,
            confidence REAL,
            frame_width INTEGER,
            frame_height INTEGER,
            flight_duration REAL,
            launch_angle REAL,
            is_manual_override BOOLEAN DEFAULT FALSE,
            UNIQUE(job_id, shot_id)
        )
    """)

    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_shots_job_id ON shots(job_id)
    """)

    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_trajectories_job_id ON shot_trajectories(job_id)
    """)

    await conn.execute("INSERT INTO schema_version (version) VALUES (1)")
