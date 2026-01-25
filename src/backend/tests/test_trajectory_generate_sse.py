"""Test SSE endpoint for trajectory generation."""

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

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
        # Create a dummy video file so video exists check passes
        test_video = Path(tmpdir) / "test_video.mp4"
        test_video.write_bytes(b"dummy video content")

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            import backend.models.job as job_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                # Create test job and shot with real video path
                async def setup():
                    await job_module.create_job("sse-test", str(test_video), "/out", True, None)
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
                # Should have an error event (since origin detection will fail on dummy video)
                # or complete event (if mocked properly)
                assert "error" in content or "complete" in content or "warning" in content

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_full_flow():
    """Test full SSE flow with mocked trajectory generation."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"
        # Create a dummy video file
        test_video = Path(tmpdir) / "test_video.mp4"
        test_video.write_bytes(b"dummy video content")

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
                    await job_module.create_job("flow-test", str(test_video), "/out", True, None)
                    await job_module.create_shots("flow-test", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])
                loop.run_until_complete(setup())

                # Mock the origin detector and tracker
                from backend.detection.origin import OriginDetection

                mock_origin = OriginDetection(
                    x=960.0, y=800.0, confidence=0.9, method="test"
                )

                mock_trajectory = {
                    "points": [
                        {"timestamp": 0.0, "x": 0.5, "y": 0.74, "confidence": 0.9, "interpolated": False},
                        {"timestamp": 0.5, "x": 0.55, "y": 0.4, "confidence": 0.9, "interpolated": False},
                        {"timestamp": 1.0, "x": 0.6, "y": 0.3, "confidence": 0.9, "interpolated": False},
                        {"timestamp": 1.5, "x": 0.65, "y": 0.5, "confidence": 0.9, "interpolated": False},
                        {"timestamp": 2.0, "x": 0.7, "y": 0.82, "confidence": 0.9, "interpolated": False},
                    ],
                    "apex_point": {"x": 0.6, "y": 0.3, "timestamp": 1.0},
                    "flight_duration": 2.0,
                    "launch_angle": 18.0,
                    "confidence": 0.85,
                }

                # Patch at the source modules since imports are inside the function
                with patch("backend.detection.origin.BallOriginDetector") as MockOriginDetector, \
                     patch("backend.detection.tracker.ConstrainedBallTracker") as MockTracker, \
                     patch("backend.core.video.get_video_info") as mock_video_info:

                    mock_video_info.return_value = {"width": 1920, "height": 1080, "fps": 60}

                    mock_origin_instance = MagicMock()
                    mock_origin_instance.detect_origin.return_value = mock_origin
                    MockOriginDetector.return_value = mock_origin_instance

                    mock_tracker_instance = MagicMock()
                    mock_tracker_instance.track_with_landing_point.return_value = mock_trajectory
                    MockTracker.return_value = mock_tracker_instance

                    from backend.main import app
                    client = TestClient(app)

                    response = client.get(
                        "/api/trajectory/flow-test/1/generate",
                        params={"landing_x": 0.7, "landing_y": 0.82}
                    )

                    assert response.status_code == 200
                    content = response.text

                    # Parse SSE events
                    events = []
                    for line in content.split("\n"):
                        if line.startswith("data:"):
                            data = json.loads(line[5:].strip())
                            events.append(data)

                    # Should have progress events
                    progress_events = [e for e in events if "progress" in e]
                    assert len(progress_events) > 0, "Should have progress events"

                    # Should have a complete event with trajectory
                    complete_events = [e for e in events if "trajectory" in e]
                    assert len(complete_events) > 0, "Should have complete event with trajectory"

                    # Verify trajectory was saved
                    async def check_saved():
                        from backend.models.trajectory import get_trajectory
                        traj = await get_trajectory("flow-test", 1)
                        return traj

                    saved_traj = loop.run_until_complete(check_saved())
                    assert saved_traj is not None, "Trajectory should be saved to database"
                    assert len(saved_traj["points"]) > 0, "Trajectory should have points"

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_video_not_found():
    """Test SSE endpoint returns 404 when video file doesn't exist."""
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

                # Create test job with non-existent video path
                async def setup():
                    await job_module.create_job("video-404-test", "/nonexistent/video.mp4", "/out", True, None)
                    await job_module.create_shots("video-404-test", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])
                loop.run_until_complete(setup())

                from backend.main import app
                client = TestClient(app)

                response = client.get(
                    "/api/trajectory/video-404-test/1/generate",
                    params={"landing_x": 0.5, "landing_y": 0.5}
                )

                assert response.status_code == 404
                assert "Video file not found" in response.json().get("detail", "")

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_shot_not_found():
    """Test SSE endpoint returns 404 when shot doesn't exist."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"
        test_video = Path(tmpdir) / "test_video.mp4"
        test_video.write_bytes(b"dummy")

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            import backend.models.job as job_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                # Create test job with no shots
                async def setup():
                    await job_module.create_job("shot-404-test", str(test_video), "/out", True, None)
                    # Don't create any shots
                loop.run_until_complete(setup())

                from backend.main import app
                client = TestClient(app)

                response = client.get(
                    "/api/trajectory/shot-404-test/999/generate",
                    params={"landing_x": 0.5, "landing_y": 0.5}
                )

                assert response.status_code == 404
                assert "Shot" in response.json().get("detail", "") or "shot" in response.json().get("detail", "")

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()


def test_generate_trajectory_sse_low_origin_confidence_warning():
    """Test that low origin confidence emits a warning event."""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_db = Path(tmpdir) / "test.db"
        test_video = Path(tmpdir) / "test_video.mp4"
        test_video.write_bytes(b"dummy")

        with patch("backend.core.database.DB_PATH", test_db):
            import backend.core.database as db_module
            import backend.models.job as job_module
            db_module._db_connection = None

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(db_module.init_db())

                async def setup():
                    await job_module.create_job("warning-test", str(test_video), "/out", True, None)
                    await job_module.create_shots("warning-test", [
                        {"id": 1, "strike_time": 10.0, "clip_start": 8.0, "clip_end": 15.0, "confidence": 0.9}
                    ])
                loop.run_until_complete(setup())

                from backend.detection.origin import OriginDetection

                # Mock origin with low confidence
                mock_origin = OriginDetection(
                    x=960.0, y=800.0, confidence=0.4, method="test"  # Low confidence
                )

                mock_trajectory = {
                    "points": [
                        {"timestamp": 0.0, "x": 0.5, "y": 0.74, "confidence": 0.9, "interpolated": False},
                    ],
                    "apex_point": {"x": 0.6, "y": 0.3, "timestamp": 1.0},
                    "flight_duration": 2.0,
                    "launch_angle": 18.0,
                    "confidence": 0.85,
                }

                # Patch at the source modules since imports are inside the function
                with patch("backend.detection.origin.BallOriginDetector") as MockOriginDetector, \
                     patch("backend.detection.tracker.ConstrainedBallTracker") as MockTracker, \
                     patch("backend.core.video.get_video_info") as mock_video_info:

                    mock_video_info.return_value = {"width": 1920, "height": 1080, "fps": 60}

                    mock_origin_instance = MagicMock()
                    mock_origin_instance.detect_origin.return_value = mock_origin
                    MockOriginDetector.return_value = mock_origin_instance

                    mock_tracker_instance = MagicMock()
                    mock_tracker_instance.track_with_landing_point.return_value = mock_trajectory
                    MockTracker.return_value = mock_tracker_instance

                    from backend.main import app
                    client = TestClient(app)

                    response = client.get(
                        "/api/trajectory/warning-test/1/generate",
                        params={"landing_x": 0.7, "landing_y": 0.82}
                    )

                    assert response.status_code == 200
                    content = response.text

                    # Should have low_origin_confidence warning
                    assert "low_origin_confidence" in content

                loop.run_until_complete(db_module.close_db())
            finally:
                loop.close()
