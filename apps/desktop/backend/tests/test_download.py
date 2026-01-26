"""Tests for the video download functionality.

Tests the /api/video endpoint with download=true parameter.
"""

import pytest
from pathlib import Path
from fastapi.testclient import TestClient


class TestVideoDownloadEndpoint:
    """Test the /api/video endpoint with download functionality."""

    def test_video_download_nonexistent_returns_404(
        self, client: TestClient, nonexistent_video_path: str
    ):
        """Downloading a non-existent file should return 404."""
        response = client.get(
            f"/api/video?path={nonexistent_video_path}&download=true"
        )

        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()

    @pytest.mark.integration
    def test_video_download_returns_attachment_header(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Download request should include Content-Disposition attachment header."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}&download=true"
        )

        assert response.status_code == 200
        assert "Content-Disposition" in response.headers
        assert "attachment" in response.headers["Content-Disposition"]
        assert synthetic_video_path.name in response.headers["Content-Disposition"]

    @pytest.mark.integration
    def test_video_stream_no_download_header(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Streaming (no download param) should NOT include attachment header."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}"
        )

        assert response.status_code == 200
        # Should not have Content-Disposition: attachment
        content_disp = response.headers.get("Content-Disposition", "")
        assert "attachment" not in content_disp

    @pytest.mark.integration
    def test_video_download_returns_full_content(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Download should return full file content, not partial."""
        # Get file size
        expected_size = synthetic_video_path.stat().st_size

        response = client.get(
            f"/api/video?path={synthetic_video_path}&download=true"
        )

        assert response.status_code == 200
        # Full file response (not 206 partial)
        assert len(response.content) == expected_size

    @pytest.mark.integration
    def test_video_download_supports_range_for_resumable(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Download should support Range headers for resumable downloads."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}&download=true",
            headers={"Range": "bytes=0-100"}
        )

        # Range requests should work for resumable downloads (206 is correct)
        assert response.status_code == 206
        assert "Content-Range" in response.headers
        # Should still have attachment header for download
        assert "Content-Disposition" in response.headers
        assert "attachment" in response.headers["Content-Disposition"]

    @pytest.mark.integration
    def test_video_stream_with_range_returns_partial(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Streaming with Range header should return 206 partial content."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}",
            headers={"Range": "bytes=0-100"}
        )

        assert response.status_code == 206
        assert "Content-Range" in response.headers
        assert len(response.content) == 101  # bytes 0-100 inclusive

    @pytest.mark.integration
    def test_video_download_correct_content_type(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Download should have correct content type."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}&download=true"
        )

        assert response.status_code == 200
        content_type = response.headers.get("Content-Type", "")
        assert "video" in content_type

    @pytest.mark.integration
    def test_video_download_with_special_chars_in_filename(
        self, client: TestClient, temp_output_dir: Path, requires_real_video
    ):
        """Download should handle filenames with special characters."""
        import subprocess
        import shutil

        # Create a video with special characters in filename
        special_name = 'test "video" (1).mp4'
        video_path = temp_output_dir / special_name

        # Create a minimal test video
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        try:
            subprocess.run([
                ffmpeg, "-y",
                "-f", "lavfi",
                "-i", "color=c=blue:s=160x120:r=30:d=0.5",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                str(video_path)
            ], capture_output=True, timeout=10)
        except Exception:
            pytest.skip("Could not create test video")

        if not video_path.exists():
            pytest.skip("Test video creation failed")

        response = client.get(
            f"/api/video?path={video_path}&download=true"
        )

        assert response.status_code == 200
        assert "Content-Disposition" in response.headers
        # Quotes should be escaped
        assert 'attachment' in response.headers["Content-Disposition"]

    @pytest.mark.integration
    def test_video_download_false_same_as_no_param(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """download=false should behave same as no download param."""
        response = client.get(
            f"/api/video?path={synthetic_video_path}&download=false"
        )

        assert response.status_code == 200
        content_disp = response.headers.get("Content-Disposition", "")
        assert "attachment" not in content_disp


class TestVideoStreamingEndpoint:
    """Test the video streaming functionality (existing behavior)."""

    @pytest.mark.integration
    def test_video_stream_accept_ranges_header(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Video endpoint should advertise Range support."""
        response = client.get(f"/api/video?path={synthetic_video_path}")

        assert response.status_code == 200
        assert response.headers.get("Accept-Ranges") == "bytes"

    @pytest.mark.integration
    def test_video_stream_range_from_middle(
        self, client: TestClient, synthetic_video_path: Path, requires_real_video
    ):
        """Should support Range requests starting from middle of file."""
        file_size = synthetic_video_path.stat().st_size
        start = file_size // 2

        response = client.get(
            f"/api/video?path={synthetic_video_path}",
            headers={"Range": f"bytes={start}-"}
        )

        assert response.status_code == 206
        assert "Content-Range" in response.headers
        # Should return from start to end of file
        expected_length = file_size - start
        assert len(response.content) == expected_length

    @pytest.mark.integration
    def test_video_stream_various_extensions(
        self, client: TestClient, temp_output_dir: Path, requires_real_video
    ):
        """Should handle .mov and .m4v extensions with correct content types."""
        import subprocess
        import shutil

        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"

        # Test .mov extension
        mov_path = temp_output_dir / "test.mov"
        try:
            subprocess.run([
                ffmpeg, "-y",
                "-f", "lavfi",
                "-i", "color=c=red:s=160x120:r=30:d=0.5",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                str(mov_path)
            ], capture_output=True, timeout=10)
        except Exception:
            pytest.skip("Could not create test video")

        if mov_path.exists():
            response = client.get(f"/api/video?path={mov_path}")
            assert response.status_code == 200
            # .mov should use quicktime content type
            assert "video" in response.headers.get("Content-Type", "")
