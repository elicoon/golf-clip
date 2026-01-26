"""Tests for tracer feedback database operations."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Patch DB_PATH before importing database module
TEST_DB_PATH = Path(tempfile.gettempdir()) / "golfclip_tracer_feedback_test" / "test.db"


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


async def _create_test_job(job_id: str):
    """Helper to create a test job for foreign key constraints."""
    from backend.models.job import create_job
    await create_job(
        job_id=job_id,
        video_path="/test/video.mp4",
        output_dir="/test/output",
        auto_approve=True,
        video_info=None,
    )


@pytest.mark.asyncio
async def test_create_tracer_feedback_with_all_params():
    """Test creating tracer feedback with auto and final params."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, get_tracer_feedback

        job_id = "test-job-123"
        shot_id = 1

        # Create job first (for foreign key constraint)
        await _create_test_job(job_id)

        auto_params = {
            "shot_shape": "draw",
            "shot_height": "medium",
            "flight_time": 3.0,
            "starting_line": "center"
        }

        final_params = {
            "shot_shape": "fade",
            "shot_height": "high",
            "flight_time": 3.5,
            "starting_line": "right"
        }

        origin_point = {"x": 0.5, "y": 0.8}
        landing_point = {"x": 0.7, "y": 0.9}
        apex_point = {"x": 0.6, "y": 0.3}

        # Create feedback
        result = await create_tracer_feedback(
            job_id=job_id,
            shot_id=shot_id,
            feedback_type="tracer_configured",
            auto_params=auto_params,
            final_params=final_params,
            origin_point=origin_point,
            landing_point=landing_point,
            apex_point=apex_point,
        )

        assert result is not None
        assert result["id"] is not None
        assert result["job_id"] == job_id
        assert result["shot_id"] == shot_id
        assert result["feedback_type"] == "tracer_configured"
        assert result["auto_params"] == auto_params
        assert result["final_params"] == final_params
        assert result["origin_point"] == origin_point
        assert result["landing_point"] == landing_point
        assert result["apex_point"] == apex_point


@pytest.mark.asyncio
async def test_create_tracer_feedback_auto_accepted():
    """Test creating feedback for auto-accepted trajectory (no final params)."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback

        job_id = "test-auto-accept"
        shot_id = 1

        # Create job first (for foreign key constraint)
        await _create_test_job(job_id)

        auto_params = {
            "shot_shape": "straight",
            "shot_height": "medium",
            "flight_time": 2.5,
            "starting_line": "center"
        }

        origin_point = {"x": 0.5, "y": 0.8}
        landing_point = {"x": 0.6, "y": 0.85}

        # Create feedback with no final_params (auto-accepted)
        result = await create_tracer_feedback(
            job_id=job_id,
            shot_id=shot_id,
            feedback_type="tracer_auto_accepted",
            auto_params=auto_params,
            final_params=None,
            origin_point=origin_point,
            landing_point=landing_point,
        )

        assert result is not None
        assert result["feedback_type"] == "tracer_auto_accepted"
        assert result["auto_params"] == auto_params
        assert result["final_params"] is None
        assert result["apex_point"] is None


@pytest.mark.asyncio
async def test_create_tracer_feedback_skip():
    """Test creating feedback for skipped shot."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback

        job_id = "test-skip"
        await _create_test_job(job_id)

        result = await create_tracer_feedback(
            job_id=job_id,
            shot_id=1,
            feedback_type="tracer_skip",
            auto_params=None,
            final_params=None,
            origin_point={"x": 0.5, "y": 0.8},
            landing_point=None,
        )

        assert result is not None
        assert result["feedback_type"] == "tracer_skip"
        assert result["auto_params"] is None
        assert result["landing_point"] is None


@pytest.mark.asyncio
async def test_get_tracer_feedback_by_id():
    """Test retrieving tracer feedback by ID."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, get_tracer_feedback

        job_id = "test-get-by-id"
        await _create_test_job(job_id)

        auto_params = {"shot_shape": "draw", "flight_time": 3.0}
        origin_point = {"x": 0.5, "y": 0.8}
        landing_point = {"x": 0.7, "y": 0.9}

        created = await create_tracer_feedback(
            job_id=job_id,
            shot_id=1,
            feedback_type="tracer_configured",
            auto_params=auto_params,
            final_params=auto_params,  # Same as auto (no changes)
            origin_point=origin_point,
            landing_point=landing_point,
        )

        # Retrieve by ID
        retrieved = await get_tracer_feedback(created["id"])

        assert retrieved is not None
        assert retrieved["id"] == created["id"]
        assert retrieved["job_id"] == job_id
        assert retrieved["shot_id"] == 1
        assert retrieved["feedback_type"] == "tracer_configured"
        assert retrieved["auto_params"] == auto_params


@pytest.mark.asyncio
async def test_get_tracer_feedback_not_found():
    """Test retrieving non-existent feedback returns None."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import get_tracer_feedback

        result = await get_tracer_feedback(99999)
        assert result is None


@pytest.mark.asyncio
async def test_get_tracer_feedback_for_job():
    """Test retrieving all tracer feedback for a job."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, get_tracer_feedback_for_job

        job_id = "test-job-multi"
        await _create_test_job(job_id)
        await _create_test_job("other-job")

        # Create multiple feedback entries
        await create_tracer_feedback(
            job_id=job_id,
            shot_id=1,
            feedback_type="tracer_configured",
            auto_params={"shot_shape": "draw"},
            final_params={"shot_shape": "fade"},
            origin_point={"x": 0.5, "y": 0.8},
            landing_point={"x": 0.7, "y": 0.9},
        )

        await create_tracer_feedback(
            job_id=job_id,
            shot_id=2,
            feedback_type="tracer_auto_accepted",
            auto_params={"shot_shape": "straight"},
            final_params=None,
            origin_point={"x": 0.5, "y": 0.8},
            landing_point={"x": 0.6, "y": 0.85},
        )

        await create_tracer_feedback(
            job_id=job_id,
            shot_id=3,
            feedback_type="tracer_skip",
            auto_params=None,
            final_params=None,
            origin_point={"x": 0.5, "y": 0.8},
            landing_point=None,
        )

        # Also create feedback for a different job
        await create_tracer_feedback(
            job_id="other-job",
            shot_id=1,
            feedback_type="tracer_configured",
            auto_params={"shot_shape": "hook"},
            final_params={"shot_shape": "draw"},
            origin_point={"x": 0.4, "y": 0.7},
            landing_point={"x": 0.6, "y": 0.8},
        )

        # Get feedback for our job only
        feedback_list = await get_tracer_feedback_for_job(job_id)

        assert len(feedback_list) == 3
        assert feedback_list[0]["shot_id"] == 1
        assert feedback_list[1]["shot_id"] == 2
        assert feedback_list[2]["shot_id"] == 3
        assert all(f["job_id"] == job_id for f in feedback_list)


@pytest.mark.asyncio
async def test_export_tracer_feedback_with_deltas():
    """Test exporting tracer feedback with computed deltas."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, export_tracer_feedback

        job_id = "export-job"
        await _create_test_job(job_id)

        # Create feedback with different auto and final params
        await create_tracer_feedback(
            job_id=job_id,
            shot_id=1,
            feedback_type="tracer_configured",
            auto_params={
                "shot_shape": "draw",
                "shot_height": "medium",
                "flight_time": 3.0,
                "starting_line": "center"
            },
            final_params={
                "shot_shape": "fade",
                "shot_height": "high",
                "flight_time": 3.5,
                "starting_line": "right"
            },
            origin_point={"x": 0.5, "y": 0.8},
            landing_point={"x": 0.7, "y": 0.9},
        )

        # Create auto-accepted feedback (no deltas)
        await create_tracer_feedback(
            job_id=job_id,
            shot_id=2,
            feedback_type="tracer_auto_accepted",
            auto_params={"shot_shape": "straight", "flight_time": 2.5},
            final_params=None,
            origin_point={"x": 0.5, "y": 0.8},
            landing_point={"x": 0.6, "y": 0.85},
        )

        # Export all feedback
        export_data = await export_tracer_feedback()

        assert "feedback" in export_data
        assert "stats" in export_data
        assert len(export_data["feedback"]) == 2

        # Check first entry has deltas computed
        configured_entry = export_data["feedback"][0]
        assert "deltas" in configured_entry
        assert configured_entry["deltas"]["shot_shape"] == {"auto": "draw", "final": "fade"}
        assert configured_entry["deltas"]["shot_height"] == {"auto": "medium", "final": "high"}
        assert configured_entry["deltas"]["flight_time"] == {"auto": 3.0, "final": 3.5}
        assert configured_entry["deltas"]["starting_line"] == {"auto": "center", "final": "right"}

        # Check auto-accepted entry has no deltas (or empty deltas)
        auto_entry = export_data["feedback"][1]
        assert auto_entry["deltas"] is None or auto_entry["deltas"] == {}


@pytest.mark.asyncio
async def test_export_tracer_feedback_with_environment_filter():
    """Test exporting tracer feedback filtered by environment."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, export_tracer_feedback

        job_id = "env-job"
        await _create_test_job(job_id)

        # Create feedback (default is 'prod' environment)
        await create_tracer_feedback(
            job_id=job_id,
            shot_id=1,
            feedback_type="tracer_configured",
            auto_params={"shot_shape": "draw"},
            final_params={"shot_shape": "fade"},
            origin_point={"x": 0.5, "y": 0.8},
            landing_point={"x": 0.7, "y": 0.9},
        )

        # Export with environment filter
        export_data = await export_tracer_feedback(environment="prod")
        assert len(export_data["feedback"]) == 1

        # Export with non-matching environment
        export_data_dev = await export_tracer_feedback(environment="dev")
        assert len(export_data_dev["feedback"]) == 0


@pytest.mark.asyncio
async def test_export_tracer_feedback_stats():
    """Test that export includes aggregate statistics."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.models.trajectory import create_tracer_feedback, export_tracer_feedback

        job_id = "stats-job"
        await _create_test_job(job_id)

        # Create various feedback types
        for i in range(3):
            await create_tracer_feedback(
                job_id=job_id,
                shot_id=i,
                feedback_type="tracer_configured",
                auto_params={"shot_shape": "draw"},
                final_params={"shot_shape": "fade"},
                origin_point={"x": 0.5, "y": 0.8},
                landing_point={"x": 0.7, "y": 0.9},
            )

        for i in range(2):
            await create_tracer_feedback(
                job_id=job_id,
                shot_id=i + 10,
                feedback_type="tracer_auto_accepted",
                auto_params={"shot_shape": "straight"},
                final_params=None,
                origin_point={"x": 0.5, "y": 0.8},
                landing_point={"x": 0.6, "y": 0.85},
            )

        await create_tracer_feedback(
            job_id=job_id,
            shot_id=20,
            feedback_type="tracer_skip",
            auto_params=None,
            final_params=None,
            origin_point={"x": 0.5, "y": 0.8},
            landing_point=None,
        )

        export_data = await export_tracer_feedback()

        assert export_data["stats"]["total"] == 6
        assert export_data["stats"]["by_type"]["tracer_configured"] == 3
        assert export_data["stats"]["by_type"]["tracer_auto_accepted"] == 2
        assert export_data["stats"]["by_type"]["tracer_skip"] == 1


@pytest.mark.asyncio
async def test_schema_version_is_6():
    """Test that schema version is now 6 after migration."""
    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        from backend.core.database import get_schema_version, SCHEMA_VERSION

        version = await get_schema_version()
        assert version == SCHEMA_VERSION
        assert version == 7


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
