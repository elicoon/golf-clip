"""Tests for exporting shots without tracer overlay.

These tests verify that the per-shot render_tracer flag works correctly,
allowing users to export shots with or without tracer overlay on a per-shot basis.
"""

import asyncio
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


class JobCacheProxy:
    """Proxy to access job cache after import."""

    def __getitem__(self, key):
        from backend.api.routes import _job_cache
        return _job_cache[key]

    def __setitem__(self, key, value):
        from backend.api.routes import _job_cache
        _job_cache[key] = value


jobs = JobCacheProxy()


class TestExportNoTracer:
    """Test exporting shots without tracer overlay."""

    def test_export_shot_with_render_tracer_false(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test exporting a shot with render_tracer=False skips tracer rendering."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Export with per-shot render_tracer flag
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 1.0,
                        "approved": True,
                        "render_tracer": False,  # Explicitly disable tracer
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data
        assert data["total_clips"] == 1

    def test_export_shot_with_render_tracer_true(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test exporting a shot with render_tracer=True attempts tracer rendering."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Export with per-shot render_tracer flag enabled
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 1.0,
                        "approved": True,
                        "render_tracer": True,  # Enable tracer
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data
        assert data["total_clips"] == 1

    def test_export_mixed_render_tracer_flags(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test exporting multiple shots with different render_tracer values."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Export with mixed render_tracer flags
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 0.5,
                        "approved": True,
                        "render_tracer": True,  # With tracer
                    },
                    {
                        "shot_id": 2,
                        "start_time": 0.5,
                        "end_time": 1.0,
                        "approved": True,
                        "render_tracer": False,  # Without tracer
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data
        assert data["total_clips"] == 2

    def test_export_default_render_tracer_true(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test that render_tracer defaults to True for backwards compatibility."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Export without explicit render_tracer (should default to True)
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 1.0,
                        "approved": True,
                        # render_tracer not specified - should default to True
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data
        assert data["total_clips"] == 1

    def test_export_backwards_compatible_with_old_format(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test that old ClipBoundary format still works (backwards compatibility)."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Export using the old format without render_tracer
        response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 1.0,
                        "approved": True,
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert response.status_code == 200
        data = response.json()
        assert "export_job_id" in data


class TestExportJobWithPerShotTracer:
    """Test that the export job correctly handles per-shot render_tracer."""

    @pytest.mark.slow
    def test_export_job_respects_render_tracer_false(
        self,
        client: TestClient,
        synthetic_video_path: Path,
        temp_output_dir: Path,
        requires_real_video,
    ):
        """Test that export job correctly exports without tracer when render_tracer=False."""
        # Create a job
        process_response = client.post(
            "/api/process",
            json={"video_path": str(synthetic_video_path)}
        )
        job_id = process_response.json()["job_id"]

        # Mark job as complete
        jobs[job_id]["status"] = "complete"

        # Start export with render_tracer=False
        export_response = client.post(
            "/api/export",
            json={
                "job_id": job_id,
                "clips": [
                    {
                        "shot_id": 1,
                        "start_time": 0.0,
                        "end_time": 1.0,
                        "approved": True,
                        "render_tracer": False,
                    }
                ],
                "output_dir": str(temp_output_dir),
            }
        )

        assert export_response.status_code == 200
        export_job_id = export_response.json()["export_job_id"]

        # Wait for export to complete
        max_wait = 30
        waited = 0
        while waited < max_wait:
            status_response = client.get(f"/api/export/{export_job_id}/status")
            assert status_response.status_code == 200
            status = status_response.json()

            if status["status"] == "complete":
                break
            elif status["status"] == "error":
                pytest.fail(f"Export failed with errors: {status['errors']}")

            time.sleep(0.5)
            waited += 0.5

        assert status["status"] == "complete"
        assert status["exported_count"] == 1

        # Verify the file was created
        exported_files = status.get("exported", [])
        assert len(exported_files) == 1
        assert Path(exported_files[0]).exists()
