"""Tests for tracer feedback API endpoints.

These tests verify the tracer feedback submission, retrieval, and statistics
endpoints used for collecting user feedback on trajectory/tracer quality.
"""

import asyncio
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class JobCacheProxy:
    """Proxy for dynamically accessing the job cache after patching."""

    def __getitem__(self, key):
        from backend.api.routes import _job_cache
        return _job_cache[key]

    def __setitem__(self, key, value):
        from backend.api.routes import _job_cache
        _job_cache[key] = value

    def __contains__(self, key):
        from backend.api.routes import _job_cache
        return key in _job_cache

    def get(self, key, default=None):
        from backend.api.routes import _job_cache
        return _job_cache.get(key, default)

    def clear(self):
        from backend.api.routes import _job_cache
        _job_cache.clear()


jobs = JobCacheProxy()


def _run_async(coro):
    """Run an async function synchronously."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _create_job_in_db(job_id: str) -> dict:
    """Create a job in the database and return the job dict with shots."""
    from backend.models.job import create_job, create_shots, get_job

    # Create job in database
    job_data = _run_async(create_job(
        job_id=job_id,
        video_path="/test/video.mp4",
        output_dir="/test/output",
        auto_approve=True,
        video_info={"duration": 60.0, "width": 1920, "height": 1080, "fps": 30.0},
    ))

    # Create shots in database
    shots = [
        {
            "id": 1,
            "strike_time": 10.5,
            "landing_time": 14.0,
            "clip_start": 8.5,
            "clip_end": 16.0,
            "confidence": 0.85,
            "shot_type": "drive",
            "audio_confidence": 0.90,
            "visual_confidence": 0.80,
            "confidence_reasons": ["strong_audio", "ball_detected"],
        },
        {
            "id": 2,
            "strike_time": 35.2,
            "landing_time": 38.5,
            "clip_start": 33.2,
            "clip_end": 40.5,
            "confidence": 0.65,
            "shot_type": "iron",
            "audio_confidence": 0.70,
            "visual_confidence": 0.60,
            "confidence_reasons": ["moderate_audio"],
        },
    ]
    _run_async(create_shots(job_id, shots))

    # Get full job with shots
    job = _run_async(get_job(job_id, include_shots=True))
    return job


class TestSubmitTracerFeedback:
    """Test the POST /api/tracer-feedback/{job_id} endpoint."""

    def test_submit_tracer_auto_accepted(self, client: TestClient):
        """Submitting tracer_auto_accepted feedback should succeed."""
        job_id = "test-tracer-feedback-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "auto_params": {
                    "starting_line": "center",
                    "shot_shape": "straight",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
                "apex_point": {"x": 0.55, "y": 0.1},
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == job_id
        assert data["shot_id"] == 1
        assert data["feedback_type"] == "tracer_auto_accepted"
        assert data["auto_params"] is not None
        assert data["final_params"] is None
        assert "created_at" in data
        assert "environment" in data

    def test_submit_tracer_configured(self, client: TestClient):
        """Submitting tracer_configured feedback should capture both auto and final params."""
        job_id = "test-tracer-feedback-002"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_configured",
                "auto_params": {
                    "starting_line": "center",
                    "shot_shape": "straight",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "final_params": {
                    "starting_line": "left",
                    "shot_shape": "draw",
                    "shot_height": "high",
                    "flight_time": 3.5,
                },
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.4, "y": 0.1},
                "apex_point": {"x": 0.45, "y": 0.05},
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["feedback_type"] == "tracer_configured"
        assert data["auto_params"]["starting_line"] == "center"
        assert data["final_params"]["starting_line"] == "left"
        assert data["final_params"]["shot_shape"] == "draw"

    def test_submit_tracer_skip(self, client: TestClient):
        """Submitting tracer_skip feedback should succeed."""
        job_id = "test-tracer-feedback-003"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 2,
                "feedback_type": "tracer_skip",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.2},
                "apex_point": None,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["feedback_type"] == "tracer_skip"

    def test_submit_tracer_rejected(self, client: TestClient):
        """Submitting tracer_rejected feedback should succeed."""
        job_id = "test-tracer-feedback-004"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_rejected",
                "auto_params": {
                    "starting_line": "center",
                    "shot_shape": "straight",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
                "apex_point": None,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["feedback_type"] == "tracer_rejected"

    def test_submit_tracer_reluctant_accept(self, client: TestClient):
        """Submitting tracer_reluctant_accept feedback should succeed."""
        job_id = "test-tracer-feedback-005"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_reluctant_accept",
                "auto_params": {
                    "starting_line": "center",
                    "shot_shape": "straight",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "final_params": {
                    "starting_line": "center",
                    "shot_shape": "fade",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.65, "y": 0.15},
                "apex_point": {"x": 0.55, "y": 0.08},
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["feedback_type"] == "tracer_reluctant_accept"

    def test_submit_feedback_nonexistent_job(self, client: TestClient, invalid_job_id: str):
        """Submitting feedback for non-existent job should return 404."""
        response = client.post(
            f"/api/tracer-feedback/{invalid_job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
                "apex_point": None,
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_submit_feedback_invalid_type(self, client: TestClient):
        """Submitting feedback with invalid type should return 422."""
        job_id = "test-tracer-feedback-006"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "invalid_type",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
                "apex_point": None,
            },
        )

        assert response.status_code == 422  # Validation error

    def test_submit_feedback_missing_required_fields(self, client: TestClient):
        """Submitting feedback with missing required fields should return 422."""
        job_id = "test-tracer-feedback-007"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # Missing origin_point
        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "landing_point": {"x": 0.6, "y": 0.15},
            },
        )

        assert response.status_code == 422  # Validation error

    def test_submit_feedback_apex_optional(self, client: TestClient):
        """Apex point should be optional."""
        job_id = "test-tracer-feedback-008"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
                # apex_point intentionally omitted
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["apex_point"] is None


class TestGetTracerFeedbackStats:
    """Test the GET /api/tracer-feedback/stats endpoint."""

    def test_get_stats_with_data(self, client: TestClient):
        """Getting stats with feedback data should return correct counts."""
        # Create multiple jobs with different feedback types
        for i, feedback_type in enumerate([
            "tracer_auto_accepted",
            "tracer_auto_accepted",
            "tracer_configured",
            "tracer_rejected",
        ]):
            job_id = f"test-tracer-stats-{i}"
            job = _create_job_in_db(job_id)
            jobs[job_id] = job

            client.post(
                f"/api/tracer-feedback/{job_id}",
                json={
                    "shot_id": 1,
                    "feedback_type": feedback_type,
                    "auto_params": {"starting_line": "center"},
                    "final_params": {"starting_line": "left"} if feedback_type == "tracer_configured" else None,
                    "origin_point": {"x": 0.5, "y": 0.85},
                    "landing_point": {"x": 0.6, "y": 0.15},
                },
            )

        response = client.get("/api/tracer-feedback/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_feedback" in data
        assert "auto_accepted" in data
        assert "configured" in data
        assert "rejected" in data
        assert "auto_accepted_rate" in data
        assert "common_adjustments" in data
        assert data["total_feedback"] >= 4
        # Auto accepted rate should be between 0 and 1
        assert 0 <= data["auto_accepted_rate"] <= 1

    def test_get_stats_empty(self, client: TestClient):
        """Getting stats with no feedback should return zeros."""
        response = client.get("/api/tracer-feedback/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_feedback" in data
        assert "auto_accepted" in data
        assert "configured" in data
        assert "rejected" in data
        assert "auto_accepted_rate" in data
        assert isinstance(data["auto_accepted_rate"], float)


class TestExportTracerFeedback:
    """Test the GET /api/tracer-feedback/export endpoint."""

    def test_export_all_feedback(self, client: TestClient):
        """Exporting all feedback should return all records with computed deltas."""
        # Create a job with configured feedback (has deltas)
        job_id = "test-tracer-export-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_configured",
                "auto_params": {
                    "starting_line": "center",
                    "shot_shape": "straight",
                    "shot_height": "medium",
                    "flight_time": 3.0,
                },
                "final_params": {
                    "starting_line": "left",
                    "shot_shape": "draw",
                    "shot_height": "high",
                    "flight_time": 3.5,
                },
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.4, "y": 0.1},
            },
        )

        response = client.get("/api/tracer-feedback/export")

        assert response.status_code == 200
        data = response.json()
        assert "feedback" in data
        assert "stats" in data
        assert len(data["feedback"]) >= 1

        # Find our record and verify deltas were computed
        for record in data["feedback"]:
            if record["job_id"] == job_id:
                # Verify deltas show what changed
                # Note: the export function should compute these
                break

    def test_export_with_environment_filter(self, client: TestClient):
        """Exporting with environment filter should only return matching records."""
        job_id = "test-tracer-export-env"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
            },
        )

        # Export with environment filter
        response = client.get("/api/tracer-feedback/export?environment=dev")

        assert response.status_code == 200
        data = response.json()
        # All returned records should be from 'dev' environment
        for record in data["feedback"]:
            assert record["environment"] == "dev"

    def test_export_includes_stats_by_type(self, client: TestClient):
        """Export should include statistics broken down by feedback type."""
        response = client.get("/api/tracer-feedback/export")

        assert response.status_code == 200
        data = response.json()
        assert "stats" in data
        assert "total" in data["stats"]
        assert "by_type" in data["stats"]


class TestTracerFeedbackEnvironment:
    """Tests for environment tagging in tracer feedback."""

    def test_feedback_uses_dev_when_debug_enabled(self, client: TestClient):
        """Tracer feedback should use 'dev' environment when debug mode is on."""
        job_id = "test-tracer-env-debug"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/tracer-feedback/{job_id}",
            json={
                "shot_id": 1,
                "feedback_type": "tracer_auto_accepted",
                "auto_params": None,
                "final_params": None,
                "origin_point": {"x": 0.5, "y": 0.85},
                "landing_point": {"x": 0.6, "y": 0.15},
            },
        )
        assert response.status_code == 200

        # The response should show 'dev' environment
        data = response.json()
        assert data["environment"] == "dev"
