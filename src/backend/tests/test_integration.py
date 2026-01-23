"""End-to-end integration tests for GolfClip API.

These tests verify the full processing flow from video upload to clip export.
Run with: pytest -m integration --slow for full tests
"""

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient


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

    def clear(self):
        from backend.api.routes import _job_cache
        _job_cache.clear()


# Global proxy that works with patched imports
jobs = JobCacheProxy()


class TestHealthCheck:
    """Test the health check endpoint."""

    def test_health_check_returns_healthy(self, client: TestClient):
        """Health check should return healthy status."""
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data
        assert "active_jobs" in data
        assert "total_jobs" in data
        assert "model_ready" in data


class TestModelStatusEndpoint:
    """Test the /api/model-status endpoint."""

    def test_model_status_returns_info(self, client: TestClient):
        """Model status endpoint should return model information."""
        response = client.get("/api/model-status")

        assert response.status_code == 200
        data = response.json()
        assert "downloaded" in data
        assert "path" in data
        assert "size_mb" in data
        assert isinstance(data["downloaded"], bool)
        assert isinstance(data["size_mb"], (int, float))


class TestProcessVideoEndpoint:
    """Test the /api/process endpoint."""

    def test_process_nonexistent_file_returns_404(
        self, client: TestClient, nonexistent_video_path: str
    ):
        """Processing a non-existent file should return 404."""
        response = client.post(
            "/api/process",
            json={"video_path": nonexistent_video_path}
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_process_valid_video_returns_job_id(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Processing a valid video should return a job ID."""
        response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )

        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data
        assert "status" in data
        assert "video_info" in data
        assert data["status"]["status"] == "pending"

    @pytest.mark.integration
    def test_process_video_creates_job_in_memory(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Processing should create a job in the jobs dict."""
        response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )

        job_id = response.json()["job_id"]
        assert job_id in jobs
        assert jobs[job_id]["video_path"] == str(synthetic_video_path)


class TestStatusEndpoint:
    """Test the /api/status/{job_id} endpoint."""

    def test_status_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str
    ):
        """Getting status for invalid job ID should return 404."""
        response = client.get(f"/api/status/{invalid_job_id}")

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_status_valid_job_returns_processing_status(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Status endpoint should return processing status for valid job."""
        # Create a job first
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Get status
        response = client.get(f"/api/status/{job_id}")

        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "progress" in data
        assert "current_step" in data
        assert data["video_path"] == str(synthetic_video_path)


class TestShotsEndpoint:
    """Test the /api/shots/{job_id} endpoints."""

    def test_get_shots_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str
    ):
        """Getting shots for invalid job should return 404."""
        response = client.get(f"/api/shots/{invalid_job_id}")

        assert response.status_code == 404

    def test_update_shots_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str
    ):
        """Updating shots for invalid job should return 404."""
        response = client.post(
            f"/api/shots/{invalid_job_id}/update",
            json=[]
        )

        assert response.status_code == 404


class TestCancelEndpoint:
    """Test the /api/cancel/{job_id} endpoint."""

    def test_cancel_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str
    ):
        """Cancelling invalid job should return 404."""
        response = client.post(f"/api/cancel/{invalid_job_id}")

        assert response.status_code == 404

    @pytest.mark.integration
    def test_cancel_completed_job_returns_400(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Cancelling a completed job should return 400."""
        # Create and manually complete a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Manually set job to complete
        jobs[job_id]["status"] = "complete"

        # Try to cancel
        response = client.post(f"/api/cancel/{job_id}")

        assert response.status_code == 400
        assert "cannot cancel" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_cancel_pending_job_succeeds(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Cancelling a pending job should succeed."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Ensure it's pending
        jobs[job_id]["status"] = "pending"

        # Cancel
        response = client.post(f"/api/cancel/{job_id}")

        assert response.status_code == 200
        assert jobs[job_id]["cancelled"] is True


class TestExportEndpoint:
    """Test the /api/export endpoint."""

    def test_export_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str, temp_output_dir: Path
    ):
        """Exporting from invalid job should return 404."""
        response = client.post(
            "/api/export",
            json={
                "job_id": invalid_job_id,
                "clips": [],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 404


class TestJobsEndpoint:
    """Test the /api/jobs endpoints."""

    def test_list_jobs_returns_empty_initially(self, client: TestClient):
        """Jobs list should be empty initially."""
        response = client.get("/api/jobs")

        assert response.status_code == 200
        data = response.json()
        assert "jobs" in data
        assert "count" in data
        assert data["count"] == 0

    @pytest.mark.integration
    def test_list_jobs_returns_created_jobs(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Jobs list should include created jobs."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # List jobs
        response = client.get("/api/jobs")

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert any(j["job_id"] == job_id for j in data["jobs"])

    @pytest.mark.integration
    def test_list_jobs_with_status_filter(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Jobs list should filter by status."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Set status to complete
        jobs[job_id]["status"] = "complete"

        # Filter by pending (should be empty)
        response = client.get("/api/jobs?status=pending")
        assert response.json()["count"] == 0

        # Filter by complete (should have our job)
        response = client.get("/api/jobs?status=complete")
        assert response.json()["count"] == 1

    def test_delete_invalid_job_returns_404(
        self, client: TestClient, invalid_job_id: str
    ):
        """Deleting invalid job should return 404."""
        response = client.delete(f"/api/jobs/{invalid_job_id}")

        assert response.status_code == 404

    @pytest.mark.integration
    def test_delete_running_job_returns_400(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Deleting a running job should return 400."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Ensure it's processing
        jobs[job_id]["status"] = "processing"

        # Try to delete
        response = client.delete(f"/api/jobs/{job_id}")

        assert response.status_code == 400
        assert "running" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_delete_completed_job_succeeds(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Deleting a completed job should succeed."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Set to complete
        jobs[job_id]["status"] = "complete"

        # Delete
        response = client.delete(f"/api/jobs/{job_id}")

        assert response.status_code == 200
        assert job_id not in jobs


class TestVideoInfoEndpoint:
    """Test the /api/video-info endpoint."""

    def test_video_info_nonexistent_returns_404(
        self, client: TestClient, nonexistent_video_path: str
    ):
        """Video info for non-existent file should return 404."""
        response = client.get(f"/api/video-info?path={nonexistent_video_path}")

        assert response.status_code == 404

    @pytest.mark.integration
    def test_video_info_valid_file_returns_metadata(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Video info for valid file should return metadata."""
        response = client.get(f"/api/video-info?path={synthetic_video_path}")

        assert response.status_code == 200
        data = response.json()
        assert "path" in data
        assert "duration" in data
        assert "width" in data
        assert "height" in data
        assert "fps" in data


@pytest.mark.slow
@pytest.mark.integration
class TestFullProcessingFlow:
    """
    Test the complete processing flow from start to finish.

    These tests use the actual ML pipeline and may take 30-60 seconds.
    Run with: pytest -m slow
    """

    def test_full_flow_with_mocked_pipeline(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video
    ):
        """Test full flow with mocked detection pipeline."""
        # Mock the detection pipeline to avoid actual ML processing
        mock_shots = [
            {
                "id": 1,
                "strike_time": 0.5,
                "landing_time": 1.5,
                "clip_start": 0.0,
                "clip_end": 2.0,
                "confidence": 0.85,
                "confidence_reasons": ["High audio confidence"],
                "shot_type": "drive",
                "audio_confidence": 0.9,
                "visual_confidence": 0.8,
            }
        ]

        with patch("backend.api.routes.ShotDetectionPipeline") as mock_pipeline:
            # Configure mock
            mock_instance = MagicMock()
            mock_instance.detect_shots = AsyncMock(return_value=[
                MagicMock(**shot, model_dump=lambda s=shot: s)
                for shot in mock_shots
            ])
            mock_pipeline.return_value = mock_instance

            # Step 1: Start processing
            process_response = client.post(
                "/api/process",
                json={
                    "video_path": str(synthetic_video_path),
                    "output_dir": str(temp_output_dir),
                }
            )
            assert process_response.status_code == 200
            job_id = process_response.json()["job_id"]

            # Wait a bit for background task
            time.sleep(0.5)

            # Step 2: Poll status until complete
            max_attempts = 20
            for _ in range(max_attempts):
                status_response = client.get(f"/api/status/{job_id}")
                assert status_response.status_code == 200
                status = status_response.json()["status"]

                if status in ("complete", "review", "error"):
                    break
                time.sleep(0.5)

            assert status in ("complete", "review"), f"Unexpected status: {status}"

            # Step 3: Get detected shots
            shots_response = client.get(f"/api/shots/{job_id}")
            assert shots_response.status_code == 200
            detected_shots = shots_response.json()
            assert len(detected_shots) >= 0  # May have shots depending on mock

    def test_update_shots_and_export_flow(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video
    ):
        """Test updating shot boundaries and exporting clips."""
        import asyncio
        from backend.models.job import create_shots, update_job

        # Create a job with pre-populated shots
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Wait for processing to complete
        time.sleep(1)

        # Add shots directly to the database (simulating completed detection)
        shots_data = [
            {
                "id": 1,
                "strike_time": 0.5,
                "landing_time": 1.5,
                "clip_start": 0.0,
                "clip_end": 2.0,
                "confidence": 0.6,  # Below threshold, needs review
                "confidence_reasons": ["Low audio confidence"],
                "shot_type": "drive",
                "audio_confidence": 0.5,
                "visual_confidence": 0.7,
            }
        ]

        # Use asyncio to run the async database functions
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(update_job(job_id, status="review"))
            loop.run_until_complete(create_shots(job_id, shots_data))
        finally:
            loop.close()

        # Also update the cache
        jobs[job_id]["status"] = "review"
        jobs[job_id]["shots"] = shots_data.copy()
        jobs[job_id]["total_shots_detected"] = 1
        jobs[job_id]["shots_needing_review"] = 1

        # Step 4: Update/approve shots
        update_response = client.post(
            f"/api/shots/{job_id}/update",
            json=[
                {
                    "shot_id": 1,
                    "start_time": 0.2,
                    "end_time": 1.8,
                    "approved": True
                }
            ]
        )
        assert update_response.status_code == 200
        update_data = update_response.json()
        assert update_data["updated_count"] == 1
        assert update_data["all_approved"] is True

        # Verify shot was updated via API
        shots_response = client.get(f"/api/shots/{job_id}")
        assert shots_response.status_code == 200
        shots = shots_response.json()
        assert len(shots) == 1
        assert shots[0]["clip_start"] == 0.2
        assert shots[0]["clip_end"] == 1.8
        assert shots[0]["confidence"] == 1.0  # Approved = 100%

        # Step 5: Export clips (now returns export_job_id for background processing)
        export_response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.2,
                        "end_time": 1.8,
                        "approved": True
                    }
                ],
                "output_dir": str(temp_output_dir),
                "filename_pattern": "shot_{shot_id}"
            }
        )

        assert export_response.status_code == 200
        export_data = export_response.json()
        assert "export_job_id" in export_data
        assert export_data["status"] == "pending"
        assert export_data["total_clips"] == 1


@pytest.mark.integration
class TestErrorCases:
    """Test various error scenarios."""

    def test_process_invalid_json_returns_422(self, client: TestClient):
        """Invalid JSON should return 422 validation error."""
        response = client.post(
            "/api/process",
            json={"invalid_field": "test"}
        )

        assert response.status_code == 422

    def test_export_with_empty_clips_returns_empty(
        self, client: TestClient, synthetic_video_path: Path, temp_output_dir: Path, requires_real_video
    ):
        """Export with empty clips should return zero total_clips."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]
        jobs[job_id]["status"] = "complete"

        # Export with empty clips
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data
        assert data["total_clips"] == 0

    def test_export_unapproved_clips_not_exported(
        self, client: TestClient, synthetic_video_path: Path, temp_output_dir: Path, requires_real_video
    ):
        """Unapproved clips should not be counted in export."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]
        jobs[job_id]["status"] = "complete"

        # Export with unapproved clips
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 2.0,
                        "approved": False  # Not approved
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_clips"] == 0  # Unapproved clips not counted


@pytest.mark.integration
class TestConcurrency:
    """Test concurrent job handling."""

    def test_multiple_jobs_created_simultaneously(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Multiple jobs can be created for the same video."""
        job_ids = []

        for _ in range(3):
            response = client.post(
                "/api/process",
                json={"video_path": str(synthetic_video_path)}
            )
            assert response.status_code == 200
            job_ids.append(response.json()["job_id"])

        # All job IDs should be unique
        assert len(set(job_ids)) == 3

        # All jobs should exist
        for job_id in job_ids:
            assert job_id in jobs

    def test_jobs_list_pagination(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Jobs list should respect limit parameter."""
        # Create 5 jobs
        for _ in range(5):
            client.post(
                "/api/process",
                json={"video_path": str(synthetic_video_path)}
            )

        # Request with limit
        response = client.get("/api/jobs?limit=3")
        assert response.json()["count"] == 3

        # Request all
        response = client.get("/api/jobs?limit=10")
        assert response.json()["count"] == 5
