"""Test SSE endpoint for trajectory generation."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def test_generate_trajectory_sse_endpoint_exists():
    """Test that the SSE endpoint exists and accepts parameters."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                from backend.main import app
                client = TestClient(app)

                # Should return 404 for non-existent job, not 422 (validation error)
                response = client.get(
                    "/api/trajectory/nonexistent-job/1/generate",
                    params={"landing_x": 0.5, "landing_y": 0.5}
                )

                # 404 means endpoint exists but job not found
                assert response.status_code == 404, f"Unexpected status: {response.status_code}"
                # Verify it's a "job not found" message (includes job_id), not a generic "Not Found"
                detail = response.json().get("detail", "")
                assert "Job" in detail or "job" in detail, f"Expected 'job not found' message, got: {detail}"

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_validates_coordinates():
    """Test that coordinates must be between 0 and 1."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                from backend.main import app
                client = TestClient(app)

                # Invalid coordinates should return 422
                response = client.get(
                    "/api/trajectory/test-job/1/generate",
                    params={"landing_x": 1.5, "landing_y": 0.5}  # x > 1 is invalid
                )
                assert response.status_code == 422

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_streams_events():
    """Test that endpoint returns SSE formatted events."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            import backend.models.job as job_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                # Create test job and shot
                async def setup():
                    await job_module.create_job("sse-test", "/test.mp4", "/out", True, None)
                    await job_module.create_shots("sse-test", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])
                loop.run_until_complete(setup())

                from backend.main import app
                client = TestClient(app)

                response = client.get(
                    "/api/trajectory/sse-test/1/generate",
                    params={"landing_x": 0.65, "landing_y": 0.82}
                )

                assert response.status_code == 200
                content = response.text

                # Verify SSE format - should have event: and data: lines
                assert "event:" in content
                assert "data:" in content
                # Should have a complete event
                assert "complete" in content

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()
