"""SQLite database setup and connection management for GolfClip."""

import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import aiosqlite
from loguru import logger

# Database path in user's home directory
DB_PATH = Path.home() / ".golfclip" / "golfclip.db"

# Current schema version - increment when making schema changes
SCHEMA_VERSION = 4

# Global connection pool (single connection for SQLite)
_db_connection: Optional[aiosqlite.Connection] = None


async def init_db() -> None:
    """Initialize the database, creating tables if they don't exist."""
    global _db_connection

    # Ensure directory exists
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Initializing database at {DB_PATH}")

    _db_connection = await aiosqlite.connect(str(DB_PATH))
    _db_connection.row_factory = aiosqlite.Row

    # Enable WAL mode for better concurrent read performance
    await _db_connection.execute("PRAGMA journal_mode=WAL")

    # Enable foreign keys
    await _db_connection.execute("PRAGMA foreign_keys = ON")

    # Create schema version table first
    await _db_connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL,
            description TEXT
        )
        """
    )

    # Check current schema version
    async with _db_connection.execute(
        "SELECT MAX(version) as version FROM schema_version"
    ) as cursor:
        row = await cursor.fetchone()
        current_version = row["version"] if row and row["version"] else 0

    # Apply migrations
    await _apply_migrations(current_version)

    await _db_connection.commit()

    logger.info(f"Database initialized successfully (schema version {SCHEMA_VERSION})")


async def _apply_migrations(current_version: int) -> None:
    """Apply database migrations incrementally."""
    if current_version < 1:
        await _migrate_v1()
    if current_version < 2:
        await _migrate_v2()
    if current_version < 3:
        await _migrate_v3()
    if current_version < 4:
        await _migrate_v4()


async def _migrate_v1() -> None:
    """Initial schema - version 1."""
    logger.info("Applying migration v1: Initial schema")

    await _db_connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            video_path TEXT NOT NULL,
            output_dir TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            progress REAL NOT NULL DEFAULT 0,
            current_step TEXT NOT NULL DEFAULT 'Initializing',
            auto_approve INTEGER NOT NULL DEFAULT 1,
            video_info_json TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            error_json TEXT,
            cancelled INTEGER NOT NULL DEFAULT 0,
            total_shots_detected INTEGER NOT NULL DEFAULT 0,
            shots_needing_review INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS shots (
            id INTEGER PRIMARY KEY,
            job_id TEXT NOT NULL,
            shot_number INTEGER NOT NULL,
            strike_time REAL NOT NULL,
            landing_time REAL,
            clip_start REAL NOT NULL,
            clip_end REAL NOT NULL,
            confidence REAL NOT NULL,
            shot_type TEXT,
            audio_confidence REAL NOT NULL DEFAULT 0,
            visual_confidence REAL NOT NULL DEFAULT 0,
            confidence_reasons_json TEXT,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_shots_job_id ON shots(job_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
        """
    )

    # Record migration (use INSERT OR IGNORE to handle re-runs)
    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (1, datetime.utcnow().isoformat(), "Initial schema with jobs and shots tables"),
    )

    logger.info("Migration v1 applied successfully")


async def _migrate_v2() -> None:
    """Add shot_feedback table for collecting user feedback on detection quality."""
    logger.info("Applying migration v2: Shot feedback table")

    await _db_connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS shot_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            shot_id INTEGER NOT NULL,
            feedback_type TEXT NOT NULL,
            notes TEXT,
            confidence_snapshot REAL,
            audio_confidence_snapshot REAL,
            visual_confidence_snapshot REAL,
            detection_features_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_feedback_type ON shot_feedback(feedback_type);
        CREATE INDEX IF NOT EXISTS idx_feedback_job ON shot_feedback(job_id);
        """
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (2, datetime.utcnow().isoformat(), "Shot feedback table for TP/FP labeling"),
    )

    logger.info("Migration v2 applied successfully")


async def _migrate_v3() -> None:
    """Add shot_trajectories table for storing ball flight paths."""
    logger.info("Applying migration v3: Shot trajectories table")

    await _db_connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS shot_trajectories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            shot_id INTEGER NOT NULL,
            trajectory_json TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            smoothness_score REAL,
            physics_plausibility REAL,
            apex_x REAL,
            apex_y REAL,
            apex_timestamp REAL,
            launch_angle REAL,
            flight_duration REAL,
            has_gaps INTEGER NOT NULL DEFAULT 0,
            gap_count INTEGER NOT NULL DEFAULT 0,
            is_manual_override INTEGER NOT NULL DEFAULT 0,
            frame_width INTEGER,
            frame_height INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            UNIQUE(job_id, shot_id)
        );

        CREATE INDEX IF NOT EXISTS idx_trajectories_job ON shot_trajectories(job_id);
        CREATE INDEX IF NOT EXISTS idx_trajectories_shot ON shot_trajectories(job_id, shot_id);
        """
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (3, datetime.utcnow().isoformat(), "Shot trajectories table for ball flight paths"),
    )

    logger.info("Migration v3 applied successfully")


async def _migrate_v4() -> None:
    """Add landing point columns to shots table for user-marked ball landing."""
    logger.info("Applying migration v4: Landing point columns")

    await _db_connection.executescript(
        """
        ALTER TABLE shots ADD COLUMN landing_x REAL;
        ALTER TABLE shots ADD COLUMN landing_y REAL;
        """
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (4, datetime.utcnow().isoformat(), "Landing point columns for user-marked ball landing"),
    )

    logger.info("Migration v4 applied successfully")


async def close_db() -> None:
    """Close the database connection."""
    global _db_connection
    if _db_connection:
        await _db_connection.close()
        _db_connection = None
        logger.info("Database connection closed")


async def get_db() -> aiosqlite.Connection:
    """Get the database connection.

    Returns:
        The active database connection.

    Raises:
        RuntimeError: If the database has not been initialized.
    """
    if _db_connection is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _db_connection


@asynccontextmanager
async def get_db_cursor() -> AsyncGenerator[aiosqlite.Cursor, None]:
    """Get a database cursor with automatic cleanup.

    Usage:
        async with get_db_cursor() as cursor:
            await cursor.execute("SELECT * FROM jobs")
            rows = await cursor.fetchall()
    """
    db = await get_db()
    cursor = await db.cursor()
    try:
        yield cursor
    finally:
        await cursor.close()


# Helper functions for JSON serialization
def serialize_json(data: Optional[dict | list]) -> Optional[str]:
    """Serialize a dict or list to JSON string for storage."""
    if data is None:
        return None
    return json.dumps(data)


def deserialize_json(data: Optional[str]) -> Optional[dict | list]:
    """Deserialize a JSON string from storage."""
    if data is None:
        return None
    return json.loads(data)


async def get_schema_version() -> int:
    """Get the current schema version."""
    db = await get_db()
    async with db.execute(
        "SELECT MAX(version) as version FROM schema_version"
    ) as cursor:
        row = await cursor.fetchone()
        return row["version"] if row and row["version"] else 0


async def purge_old_jobs(days: int = 30) -> int:
    """Delete jobs older than the specified number of days.

    Only deletes completed, cancelled, or errored jobs. Active jobs are preserved.

    Args:
        days: Number of days to keep jobs. Jobs older than this will be deleted.

    Returns:
        Number of jobs deleted.
    """
    db = await get_db()

    cutoff_date = (datetime.utcnow() - timedelta(days=days)).isoformat()

    # Only delete non-active jobs
    cursor = await db.execute(
        """
        DELETE FROM jobs
        WHERE status IN ('complete', 'cancelled', 'error')
        AND created_at < ?
        """,
        (cutoff_date,),
    )
    await db.commit()

    deleted_count = cursor.rowcount
    if deleted_count > 0:
        logger.info(f"Purged {deleted_count} jobs older than {days} days")

    return deleted_count


async def export_jobs_to_json() -> list[dict[str, Any]]:
    """Export all jobs and their shots to a JSON-serializable format.

    Returns:
        List of job dictionaries with their shots included.
    """
    from backend.models.job import get_all_jobs

    jobs = await get_all_jobs(limit=10000, include_shots=True)
    return jobs


async def get_database_stats() -> dict[str, Any]:
    """Get database statistics.

    Returns:
        Dictionary with database statistics.
    """
    db = await get_db()

    stats = {
        "schema_version": await get_schema_version(),
        "db_path": str(DB_PATH),
        "db_size_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
    }

    # Count jobs by status
    async with db.execute(
        "SELECT status, COUNT(*) as count FROM jobs GROUP BY status"
    ) as cursor:
        rows = await cursor.fetchall()
        stats["jobs_by_status"] = {row["status"]: row["count"] for row in rows}

    # Total counts
    async with db.execute("SELECT COUNT(*) as count FROM jobs") as cursor:
        row = await cursor.fetchone()
        stats["total_jobs"] = row["count"]

    async with db.execute("SELECT COUNT(*) as count FROM shots") as cursor:
        row = await cursor.fetchone()
        stats["total_shots"] = row["count"]

    return stats
