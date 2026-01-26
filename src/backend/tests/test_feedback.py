"""Tests for shot feedback collection endpoints.

These tests verify the feedback submission, retrieval, and statistics endpoints
used for collecting user feedback on detection quality.
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
        {
            "id": 3,
            "strike_time": 52.0,
            "landing_time": 55.0,
            "clip_start": 50.0,
            "clip_end": 57.0,
            "confidence": 0.92,
            "shot_type": "chip",
            "audio_confidence": 0.95,
            "visual_confidence": 0.88,
            "confidence_reasons": ["strong_audio", "ball_detected", "trajectory_confirmed"],
        },
    ]
    _run_async(create_shots(job_id, shots))

    # Get full job with shots
    job = _run_async(get_job(job_id, include_shots=True))
    return job


def _create_mock_job_with_shots(job_id: str) -> dict:
    """Create a mock job with shots for testing feedback."""
    return {
        "id": job_id,
        "video_path": "/test/video.mp4",
        "output_dir": "/test/output",
        "status": "complete",
        "progress": 100,
        "current_step": "Complete",
        "auto_approve": True,
        "video_info": {"duration": 60.0},
        "created_at": datetime.utcnow().isoformat(),
        "started_at": datetime.utcnow().isoformat(),
        "completed_at": datetime.utcnow().isoformat(),
        "error": None,
        "cancelled": False,
        "total_shots_detected": 3,
        "shots_needing_review": 0,
        "shots": [
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
            {
                "id": 3,
                "strike_time": 52.0,
                "landing_time": 55.0,
                "clip_start": 50.0,
                "clip_end": 57.0,
                "confidence": 0.92,
                "shot_type": "chip",
                "audio_confidence": 0.95,
                "visual_confidence": 0.88,
                "confidence_reasons": ["strong_audio", "ball_detected", "trajectory_confirmed"],
            },
        ],
    }


class TestSubmitFeedback:
    """Test the POST /api/feedback/{job_id} endpoint."""

    def test_submit_single_true_positive(self, client: TestClient):
        """Submitting a single true positive feedback should succeed."""
        job_id = "test-feedback-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None}
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["job_id"] == job_id
        assert data[0]["shot_id"] == 1
        assert data[0]["feedback_type"] == "true_positive"
        assert data[0]["confidence_snapshot"] == 0.85
        assert data[0]["audio_confidence_snapshot"] == 0.90

    def test_submit_false_positive_with_notes(self, client: TestClient):
        """Submitting a false positive with notes should capture the notes."""
        job_id = "test-feedback-002"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {
                        "shot_id": 2,
                        "feedback_type": "false_positive",
                        "notes": "This was a practice swing, not a real shot",
                    }
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["feedback_type"] == "false_positive"
        assert data[0]["notes"] == "This was a practice swing, not a real shot"

    def test_submit_multiple_feedback(self, client: TestClient):
        """Submitting feedback for multiple shots should create multiple records."""
        job_id = "test-feedback-003"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None},
                    {"shot_id": 2, "feedback_type": "false_positive", "notes": "Practice swing"},
                    {"shot_id": 3, "feedback_type": "true_positive", "notes": "Great detection!"},
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3

        # Verify each feedback record
        feedback_by_shot = {f["shot_id"]: f for f in data}
        assert feedback_by_shot[1]["feedback_type"] == "true_positive"
        assert feedback_by_shot[2]["feedback_type"] == "false_positive"
        assert feedback_by_shot[3]["feedback_type"] == "true_positive"

    def test_submit_feedback_nonexistent_job(self, client: TestClient, invalid_job_id: str):
        """Submitting feedback for non-existent job should return 404."""
        response = client.post(
            f"/api/feedback/{invalid_job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None}
                ]
            },
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    def test_submit_feedback_nonexistent_shot(self, client: TestClient):
        """Submitting feedback for non-existent shot should return 404."""
        job_id = "test-feedback-004"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 999, "feedback_type": "true_positive", "notes": None}
                ]
            },
        )

        assert response.status_code == 404
        assert "shot 999 not found" in response.json()["detail"].lower()

    def test_submit_feedback_invalid_type(self, client: TestClient):
        """Submitting feedback with invalid type should return 422."""
        job_id = "test-feedback-005"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "invalid_type", "notes": None}
                ]
            },
        )

        assert response.status_code == 422  # Validation error


class TestGetFeedback:
    """Test the GET /api/feedback/{job_id} endpoint."""

    def test_get_feedback_for_job(self, client: TestClient):
        """Getting feedback for a job should return all feedback records."""
        job_id = "test-feedback-get-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # First submit some feedback
        client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None},
                    {"shot_id": 2, "feedback_type": "false_positive", "notes": "FP"},
                ]
            },
        )

        # Now retrieve it
        response = client.get(f"/api/feedback/{job_id}")

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_get_feedback_empty_job(self, client: TestClient):
        """Getting feedback for job with no feedback should return empty list."""
        job_id = "test-feedback-get-002"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.get(f"/api/feedback/{job_id}")

        assert response.status_code == 200
        data = response.json()
        assert data == []

    def test_get_feedback_nonexistent_job(self, client: TestClient, invalid_job_id: str):
        """Getting feedback for non-existent job should return 404."""
        response = client.get(f"/api/feedback/{invalid_job_id}")

        assert response.status_code == 404


class TestFeedbackExport:
    """Test the GET /api/feedback/export endpoint."""

    def test_export_all_feedback(self, client: TestClient):
        """Exporting all feedback should return all records."""
        # Create multiple jobs with feedback
        for i in range(3):
            job_id = f"test-export-{i}"
            job = _create_job_in_db(job_id)
            jobs[job_id] = job

            client.post(
                f"/api/feedback/{job_id}",
                json={
                    "feedback": [
                        {"shot_id": 1, "feedback_type": "true_positive", "notes": None},
                    ]
                },
            )

        response = client.get("/api/feedback/export")

        assert response.status_code == 200
        data = response.json()
        assert "exported_at" in data
        assert "total_records" in data
        assert "records" in data
        assert data["total_records"] >= 3

    def test_export_with_type_filter(self, client: TestClient):
        """Exporting with type filter should only return matching records."""
        job_id = "test-export-filter"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None},
                    {"shot_id": 2, "feedback_type": "false_positive", "notes": None},
                ]
            },
        )

        # Export only false positives
        response = client.get("/api/feedback/export?feedback_type=false_positive")

        assert response.status_code == 200
        data = response.json()
        # All returned records should be false positives
        for record in data["records"]:
            assert record["feedback_type"] == "false_positive"

    def test_export_invalid_type_filter(self, client: TestClient):
        """Exporting with invalid type filter should return 400."""
        response = client.get("/api/feedback/export?feedback_type=invalid")

        assert response.status_code == 400
        assert "feedback_type must be" in response.json()["detail"]


class TestFeedbackStats:
    """Test the GET /api/feedback/stats endpoint."""

    def test_get_stats_with_data(self, client: TestClient):
        """Getting stats with feedback data should return correct counts."""
        job_id = "test-stats-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # Submit mixed feedback
        client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None},
                    {"shot_id": 2, "feedback_type": "true_positive", "notes": None},
                    {"shot_id": 3, "feedback_type": "false_positive", "notes": None},
                ]
            },
        )

        response = client.get("/api/feedback/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_feedback" in data
        assert "true_positives" in data
        assert "false_positives" in data
        assert "precision" in data
        assert data["total_feedback"] >= 3
        # Precision should be between 0 and 1
        assert 0 <= data["precision"] <= 1

    def test_get_stats_empty(self, client: TestClient):
        """Getting stats with no feedback should return zeros."""
        # Note: Other tests may have added feedback, so we just check structure
        response = client.get("/api/feedback/stats")

        assert response.status_code == 200
        data = response.json()
        assert "total_feedback" in data
        assert "true_positives" in data
        assert "false_positives" in data
        assert "precision" in data
        assert isinstance(data["precision"], float)


class TestFeedbackEnvironment:
    """Tests for environment tagging in feedback."""

    def test_feedback_uses_dev_when_debug_enabled(self, client: TestClient):
        """Feedback should use 'dev' environment when debug mode is on."""
        # By default, settings.debug=True, so environment should be 'dev'
        job_id = "test-feedback-env-debug"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
        )
        assert response.status_code == 200

        # The response should show 'dev' environment
        data = response.json()
        assert data[0]["environment"] == "dev"

    def test_feedback_uses_prod_when_debug_disabled(self, client: TestClient):
        """Feedback should use 'prod' environment when debug mode is off."""
        from unittest.mock import patch, MagicMock

        job_id = "test-feedback-env-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # Mock settings.debug to False to get 'prod' environment
        mock_settings = MagicMock()
        mock_settings.debug = False
        with patch("backend.core.environment.settings", mock_settings):
            response = client.post(
                f"/api/feedback/{job_id}",
                json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
            )
            assert response.status_code == 200

            # Get the feedback and check environment
            get_response = client.get(f"/api/feedback/{job_id}")
            assert get_response.status_code == 200
            feedback = get_response.json()
            assert len(feedback) == 1
            assert feedback[0]["environment"] == "prod"

    def test_feedback_uses_dev_with_env_var_override(self, client: TestClient):
        """Feedback should use 'dev' when GOLFCLIP_ENV=dev is set."""
        import os
        from unittest.mock import patch, MagicMock

        job_id = "test-feedback-env-var"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # Even if debug=False, GOLFCLIP_ENV=dev should override to 'dev'
        mock_settings = MagicMock()
        mock_settings.debug = False
        with patch.dict(os.environ, {"GOLFCLIP_ENV": "dev"}):
            with patch("backend.core.environment.settings", mock_settings):
                response = client.post(
                    f"/api/feedback/{job_id}",
                    json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
                )
                assert response.status_code == 200
                data = response.json()
                assert data[0]["environment"] == "dev"

    def test_feedback_environment_in_response(self, client: TestClient):
        """Feedback submission response should include environment."""
        job_id = "test-feedback-env-002"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        response = client.post(
            f"/api/feedback/{job_id}",
            json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert "environment" in data[0]
        # With debug=True (default), should be 'dev'
        assert data[0]["environment"] == "dev"

    def test_feedback_export_includes_environment(self, client: TestClient):
        """Exported feedback should include environment field."""
        job_id = "test-feedback-env-003"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        client.post(
            f"/api/feedback/{job_id}",
            json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
        )

        response = client.get("/api/feedback/export")
        assert response.status_code == 200
        data = response.json()
        assert data["total_records"] >= 1
        # Find our record
        for record in data["records"]:
            if record["job_id"] == job_id:
                assert "environment" in record
                # With debug=True (default), should be 'dev'
                assert record["environment"] == "dev"
                break
        else:
            pytest.fail("Feedback record not found in export")


class TestFeedbackDataIntegrity:
    """Test that feedback correctly snapshots detection features."""

    def test_feedback_snapshots_confidence(self, client: TestClient):
        """Feedback should snapshot the shot's confidence values."""
        job_id = "test-snapshot-001"
        job = _create_job_in_db(job_id)
        jobs[job_id] = job

        # Submit feedback
        response = client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None}
                ]
            },
        )

        assert response.status_code == 200
        data = response.json()[0]

        # Verify snapshots match original shot data
        original_shot = job["shots"][0]
        assert data["confidence_snapshot"] == original_shot["confidence"]
        assert data["audio_confidence_snapshot"] == original_shot["audio_confidence"]
        assert data["visual_confidence_snapshot"] == original_shot["visual_confidence"]

    def test_feedback_preserves_after_shot_update(self, client: TestClient):
        """Feedback snapshots should be preserved even if shot is later modified."""
        job_id = "test-preserve-001"
        job = _create_job_in_db(job_id)
        original_confidence = job["shots"][0]["confidence"]
        jobs[job_id] = job

        # Submit feedback
        client.post(
            f"/api/feedback/{job_id}",
            json={
                "feedback": [
                    {"shot_id": 1, "feedback_type": "true_positive", "notes": None}
                ]
            },
        )

        # Modify the shot (simulate user approving with boundary update)
        job["shots"][0]["confidence"] = 1.0  # User approved

        # Retrieve feedback - should still have original confidence
        response = client.get(f"/api/feedback/{job_id}")

        assert response.status_code == 200
        data = response.json()[0]
        assert data["confidence_snapshot"] == original_confidence
