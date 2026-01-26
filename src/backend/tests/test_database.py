"""Tests for SQLite database persistence layer."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Patch DB_PATH before importing database module
TEST_DB_PATH = Path(tempfile.gettempdir()) / "golfclip_test" / "test.db"


@pytest.fixture(autouse=True)
async def setup_test_db():
    """Set up a test database for each test."""
    # Clean up any existing test database
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    TEST_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Patch the DB_PATH
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.core.database import init_db, close_db

        await init_db()
        yield
        await close_db()

    # Clean up
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()
    # Clean up WAL files
    for ext in ["-wal", "-shm"]:
        wal_file = Path(str(TEST_DB_PATH) + ext)
        if wal_file.exists():
            wal_file.unlink()


@pytest.mark.asyncio
async def test_create_and_get_job():
    """Test creating and retrieving a job."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, get_job

        job_id = "test-job-123"
        video_path = "/path/to/video.mp4"
        output_dir = "/path/to/output"

        # Create job
        job = await create_job(
            job_id=job_id,
            video_path=video_path,
            output_dir=output_dir,
            auto_approve=True,
            video_info={"duration": 120, "width": 1920, "height": 1080},
        )

        assert job["id"] == job_id
        assert job["video_path"] == video_path
        assert job["status"] == "pending"
        assert job["progress"] == 0
        assert job["video_info"]["duration"] == 120

        # Retrieve job
        retrieved = await get_job(job_id)
        assert retrieved is not None
        assert retrieved["id"] == job_id
        assert retrieved["video_info"]["duration"] == 120


@pytest.mark.asyncio
async def test_update_job():
    """Test updating a job."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, get_job, update_job

        job_id = "test-update-job"
        await create_job(
            job_id=job_id,
            video_path="/video.mp4",
            output_dir="/output",
            auto_approve=True,
            video_info=None,
        )

        # Update job
        success = await update_job(
            job_id,
            status="processing",
            progress=50.0,
            current_step="Analyzing audio",
        )
        assert success is True

        # Verify update
        job = await get_job(job_id)
        assert job["status"] == "processing"
        assert job["progress"] == 50.0
        assert job["current_step"] == "Analyzing audio"


@pytest.mark.asyncio
async def test_update_job_invalid_column():
    """Test that updating with invalid column raises error."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, update_job

        job_id = "test-invalid-column"
        await create_job(
            job_id=job_id,
            video_path="/video.mp4",
            output_dir="/output",
            auto_approve=True,
            video_info=None,
        )

        # Try to update with invalid column (SQL injection attempt)
        with pytest.raises(ValueError, match="Invalid column name"):
            await update_job(job_id, malicious_column="DROP TABLE jobs")


@pytest.mark.asyncio
async def test_create_and_get_shots():
    """Test creating and retrieving shots."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, create_shots, get_shots_for_job

        job_id = "test-shots-job"
        await create_job(
            job_id=job_id,
            video_path="/video.mp4",
            output_dir="/output",
            auto_approve=True,
            video_info=None,
        )

        # Create shots
        shots = [
            {
                "id": 1,
                "strike_time": 10.5,
                "landing_time": 14.2,
                "clip_start": 8.5,
                "clip_end": 16.2,
                "confidence": 0.85,
                "shot_type": "drive",
                "audio_confidence": 0.9,
                "visual_confidence": 0.8,
                "confidence_reasons": ["Strong audio signature", "Ball detected"],
            },
            {
                "id": 2,
                "strike_time": 45.0,
                "landing_time": 48.5,
                "clip_start": 43.0,
                "clip_end": 50.5,
                "confidence": 0.72,
                "shot_type": "iron",
                "audio_confidence": 0.7,
                "visual_confidence": 0.74,
                "confidence_reasons": ["Moderate confidence"],
            },
        ]

        await create_shots(job_id, shots)

        # Retrieve shots
        retrieved_shots = await get_shots_for_job(job_id)
        assert len(retrieved_shots) == 2
        assert retrieved_shots[0]["id"] == 1
        assert retrieved_shots[0]["strike_time"] == 10.5
        assert retrieved_shots[0]["confidence_reasons"] == ["Strong audio signature", "Ball detected"]
        assert retrieved_shots[1]["shot_type"] == "iron"


@pytest.mark.asyncio
async def test_update_shot():
    """Test updating a shot."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, create_shots, update_shot, get_shots_for_job

        job_id = "test-update-shot"
        await create_job(
            job_id=job_id,
            video_path="/video.mp4",
            output_dir="/output",
            auto_approve=True,
            video_info=None,
        )

        await create_shots(job_id, [{
            "id": 1,
            "strike_time": 10.0,
            "clip_start": 8.0,
            "clip_end": 14.0,
            "confidence": 0.6,
            "audio_confidence": 0.5,
            "visual_confidence": 0.7,
        }])

        # Update shot (user approved)
        success = await update_shot(
            job_id,
            shot_id=1,
            clip_start=7.5,
            clip_end=15.0,
            confidence=1.0,
        )
        assert success is True

        # Verify
        shots = await get_shots_for_job(job_id)
        assert shots[0]["clip_start"] == 7.5
        assert shots[0]["clip_end"] == 15.0
        assert shots[0]["confidence"] == 1.0


@pytest.mark.asyncio
async def test_delete_job_cascades_shots():
    """Test that deleting a job also deletes its shots."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, create_shots, delete_job, get_job, get_shots_for_job

        job_id = "test-cascade-delete"
        await create_job(
            job_id=job_id,
            video_path="/video.mp4",
            output_dir="/output",
            auto_approve=True,
            video_info=None,
        )

        await create_shots(job_id, [{
            "id": 1,
            "strike_time": 10.0,
            "clip_start": 8.0,
            "clip_end": 14.0,
            "confidence": 0.8,
            "audio_confidence": 0.8,
            "visual_confidence": 0.8,
        }])

        # Delete job
        success = await delete_job(job_id)
        assert success is True

        # Verify job is gone
        job = await get_job(job_id)
        assert job is None

        # Verify shots are also gone
        shots = await get_shots_for_job(job_id)
        assert len(shots) == 0


@pytest.mark.asyncio
async def test_get_all_jobs():
    """Test listing all jobs."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, get_all_jobs, update_job

        # Create multiple jobs
        for i in range(5):
            await create_job(
                job_id=f"job-{i}",
                video_path=f"/video{i}.mp4",
                output_dir="/output",
                auto_approve=True,
                video_info=None,
            )

        # Update some jobs
        await update_job("job-0", status="complete")
        await update_job("job-1", status="complete")
        await update_job("job-2", status="error")

        # Get all jobs
        all_jobs = await get_all_jobs(limit=10)
        assert len(all_jobs) == 5

        # Get only pending jobs
        pending_jobs = await get_all_jobs(status="pending")
        assert len(pending_jobs) == 2

        # Get complete jobs
        complete_jobs = await get_all_jobs(status="complete")
        assert len(complete_jobs) == 2


@pytest.mark.asyncio
async def test_purge_old_jobs():
    """Test purging old jobs."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, update_job, get_all_jobs
        from backend.core.database import purge_old_jobs, get_db
        from datetime import datetime, timedelta

        # Create jobs with different timestamps
        old_date = (datetime.utcnow() - timedelta(days=60)).isoformat()
        recent_date = (datetime.utcnow() - timedelta(days=5)).isoformat()

        await create_job("old-complete", "/v1.mp4", "/out", True, None)
        await create_job("old-pending", "/v2.mp4", "/out", True, None)
        await create_job("recent-complete", "/v3.mp4", "/out", True, None)

        # Manually update created_at dates
        db = await get_db()
        await db.execute(
            "UPDATE jobs SET created_at = ?, status = 'complete' WHERE id = ?",
            (old_date, "old-complete"),
        )
        await db.execute(
            "UPDATE jobs SET created_at = ? WHERE id = ?",
            (old_date, "old-pending"),  # Keep as pending
        )
        await db.execute(
            "UPDATE jobs SET created_at = ?, status = 'complete' WHERE id = ?",
            (recent_date, "recent-complete"),
        )
        await db.commit()

        # Purge jobs older than 30 days
        deleted = await purge_old_jobs(days=30)

        # Should only delete old-complete (old-pending is not in deletable status)
        assert deleted == 1

        # Verify remaining jobs
        jobs = await get_all_jobs(limit=10)
        job_ids = [j["id"] for j in jobs]
        assert "old-complete" not in job_ids
        assert "old-pending" in job_ids
        assert "recent-complete" in job_ids


@pytest.mark.asyncio
async def test_database_stats():
    """Test database statistics."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.job import create_job, create_shots, update_job
        from backend.core.database import get_database_stats

        # Create some data
        await create_job("stats-job-1", "/v1.mp4", "/out", True, None)
        await create_job("stats-job-2", "/v2.mp4", "/out", True, None)
        await update_job("stats-job-1", status="complete")

        await create_shots("stats-job-2", [
            {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 14.0,
             "confidence": 0.8, "audio_confidence": 0.8, "visual_confidence": 0.8},
        ])

        # Get stats
        stats = await get_database_stats()

        assert stats["schema_version"] == 7
        assert stats["total_jobs"] == 2
        assert stats["total_shots"] == 1
        assert "complete" in stats["jobs_by_status"]
        assert "pending" in stats["jobs_by_status"]


@pytest.mark.asyncio
async def test_schema_version():
    """Test schema versioning."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.core.database import get_schema_version, SCHEMA_VERSION

        version = await get_schema_version()
        assert version == SCHEMA_VERSION
        assert version == 7


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
