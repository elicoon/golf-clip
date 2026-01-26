"""Tests for landing point migration (schema v4)."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


def test_migration_adds_landing_columns():
    """Verify schema v4 adds landing_x and landing_y to shots table."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        # Must patch before importing the module
        with patch("backend.core.database.DB_PATH", test_db):
            # Reset the global connection state
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                # Initialize database (runs all migrations)
                loop.run_until_complete(db_module.init_db())

                # Check schema version (v6 includes tracer feedback table)
                version = loop.run_until_complete(db_module.get_schema_version())
                assert version == 7, f"Expected schema v7, got v{version}"

                # Verify columns exist by inserting a shot with landing coords
                async def verify_columns():
                    db = await db_module.get_db()
                    # Create a test job first
                    await db.execute(
                        """
                        INSERT INTO jobs (id, video_path, output_dir, status, created_at)
                        VALUES ('test-job', '/test.mp4', '/out', 'complete', '2024-01-01')
                        """
                    )
                    # Insert shot with landing columns
                    await db.execute(
                        """
                        INSERT INTO shots (job_id, shot_number, strike_time, clip_start, clip_end, confidence, landing_x, landing_y)
                        VALUES ('test-job', 1, 10.0, 8.0, 15.0, 0.9, 0.65, 0.82)
                        """
                    )
                    await db.commit()

                    # Read back
                    async with db.execute(
                        "SELECT landing_x, landing_y FROM shots WHERE job_id = 'test-job'"
                    ) as cursor:
                        row = await cursor.fetchone()
                        return row["landing_x"], row["landing_y"]

                landing_x, landing_y = loop.run_until_complete(verify_columns())
                assert landing_x == 0.65, f"Expected landing_x=0.65, got {landing_x}"
                assert landing_y == 0.82, f"Expected landing_y=0.82, got {landing_y}"

                # Cleanup
                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_landing_columns_default_to_null():
    """Verify landing_x and landing_y default to NULL when not specified."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                async def verify_null_default():
                    db = await db_module.get_db()
                    # Create a test job
                    await db.execute(
                        """
                        INSERT INTO jobs (id, video_path, output_dir, status, created_at)
                        VALUES ('test-job-null', '/test.mp4', '/out', 'complete', '2024-01-01')
                        """
                    )
                    # Insert shot WITHOUT landing columns
                    await db.execute(
                        """
                        INSERT INTO shots (job_id, shot_number, strike_time, clip_start, clip_end, confidence)
                        VALUES ('test-job-null', 1, 10.0, 8.0, 15.0, 0.9)
                        """
                    )
                    await db.commit()

                    # Read back
                    async with db.execute(
                        "SELECT landing_x, landing_y FROM shots WHERE job_id = 'test-job-null'"
                    ) as cursor:
                        row = await cursor.fetchone()
                        return row["landing_x"], row["landing_y"]

                landing_x, landing_y = loop.run_until_complete(verify_null_default())
                assert landing_x is None, f"Expected landing_x=None, got {landing_x}"
                assert landing_y is None, f"Expected landing_y=None, got {landing_y}"

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_update_shot_landing():
    """Test update_shot_landing saves landing coordinates."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                async def test_update():
                    from backend.models.job import update_shot_landing, create_job, create_shots, get_shots_for_job

                    # Create test job and shot
                    await create_job("test-job-landing", "/test.mp4", "/out", True, None)
                    await create_shots("test-job-landing", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])

                    # Update landing point
                    result = await update_shot_landing("test-job-landing", 1, 0.65, 0.82)
                    assert result is True

                    # Verify landing point saved
                    shots = await get_shots_for_job("test-job-landing")
                    assert len(shots) == 1
                    assert shots[0]["landing_x"] == 0.65
                    assert shots[0]["landing_y"] == 0.82

                    # Update to new values
                    await update_shot_landing("test-job-landing", 1, 0.70, 0.85)
                    shots = await get_shots_for_job("test-job-landing")
                    assert shots[0]["landing_x"] == 0.70
                    assert shots[0]["landing_y"] == 0.85

                loop.run_until_complete(test_update())
                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_update_shot_landing_nonexistent():
    """Test update_shot_landing returns False for nonexistent shot."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                async def test_nonexistent():
                    from backend.models.job import update_shot_landing
                    result = await update_shot_landing("nonexistent-job", 1, 0.5, 0.5)
                    assert result is False

                loop.run_until_complete(test_nonexistent())
                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()
