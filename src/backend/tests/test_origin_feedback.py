"""Tests for origin feedback ML data collection system."""

import asyncio
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest


# Use a test database
TEST_DB_PATH = Path("/tmp/test_origin_feedback.db")


@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    """Set up test database for all tests in this module."""
    # Clean up any existing test database
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()

    with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
        # Initialize database
        from backend.core.database import init_db, close_db

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(init_db())
            yield
            loop.run_until_complete(close_db())
        finally:
            loop.close()

        # Clean up
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()


class TestOriginFeedbackStatsKeys:
    """Test that get_origin_feedback_stats returns correct keys for API."""

    def test_stats_returns_total_feedback_key(self):
        """BUG #1a: API expects 'total_feedback' but function returns 'total_corrections'."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from backend.models.trajectory import get_origin_feedback_stats

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                stats = loop.run_until_complete(get_origin_feedback_stats())

                # API expects 'total_feedback' key
                assert "total_feedback" in stats, (
                    f"Expected 'total_feedback' key but got keys: {list(stats.keys())}"
                )
            finally:
                loop.close()

    def test_stats_returns_correction_rate_key(self):
        """BUG #1b: API expects 'correction_rate' but function doesn't return it."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from backend.models.trajectory import get_origin_feedback_stats

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                stats = loop.run_until_complete(get_origin_feedback_stats())

                # API expects 'correction_rate' key
                assert "correction_rate" in stats, (
                    f"Expected 'correction_rate' key but got keys: {list(stats.keys())}"
                )
            finally:
                loop.close()


class TestOriginFeedbackExportKeys:
    """Test that export_origin_feedback returns correct keys for API."""

    def test_export_returns_exported_at_key(self):
        """BUG #2a: API expects 'exported_at' but function doesn't return it."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from backend.models.trajectory import export_origin_feedback

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                export_data = loop.run_until_complete(export_origin_feedback())

                # API expects 'exported_at' key
                assert "exported_at" in export_data, (
                    f"Expected 'exported_at' key but got keys: {list(export_data.keys())}"
                )
            finally:
                loop.close()

    def test_export_returns_total_records_key(self):
        """BUG #2b: API expects 'total_records' but function doesn't return it."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from backend.models.trajectory import export_origin_feedback

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                export_data = loop.run_until_complete(export_origin_feedback())

                # API expects 'total_records' key
                assert "total_records" in export_data, (
                    f"Expected 'total_records' key but got keys: {list(export_data.keys())}"
                )
            finally:
                loop.close()

    def test_export_returns_records_key(self):
        """BUG #2c: API expects 'records' but function returns 'feedback'."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from backend.models.trajectory import export_origin_feedback

            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                export_data = loop.run_until_complete(export_origin_feedback())

                # API expects 'records' key, not 'feedback'
                assert "records" in export_data, (
                    f"Expected 'records' key but got keys: {list(export_data.keys())}"
                )
            finally:
                loop.close()


class TestOriginFeedbackByMethodType:
    """Test that by_method returns correct type for Pydantic schema."""

    def test_stats_by_method_is_dict_of_ints(self):
        """BUG #3: Schema expects dict[str, int] but function returns dict[str, dict]."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from fastapi.testclient import TestClient
            from backend.main import app

            client = TestClient(app)

            # First create some feedback via the generate endpoint would be complex,
            # so let's verify the schema directly by checking the stats endpoint response
            response = client.get("/api/origin-feedback/stats")
            assert response.status_code == 200

            data = response.json()
            by_method = data.get("by_method", {})

            # Schema expects by_method to be dict[str, int]
            # Even if empty, verify structure is correct
            for method, value in by_method.items():
                assert isinstance(value, int), (
                    f"Expected by_method['{method}'] to be int, "
                    f"got {type(value).__name__}: {value}"
                )


class TestOriginFeedbackAPIIntegration:
    """Integration tests for the API endpoints."""

    def test_stats_endpoint_returns_valid_response(self):
        """Test that /origin-feedback/stats endpoint doesn't crash."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from fastapi.testclient import TestClient
            from backend.main import app

            client = TestClient(app)
            response = client.get("/api/origin-feedback/stats")

            # Should not return 500 error
            assert response.status_code == 200, (
                f"Expected 200 but got {response.status_code}: {response.text}"
            )

    def test_export_endpoint_returns_valid_response(self):
        """Test that /origin-feedback/export endpoint doesn't crash."""
        with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
            from fastapi.testclient import TestClient
            from backend.main import app

            client = TestClient(app)
            response = client.get("/api/origin-feedback/export")

            # Should not return 500 error
            assert response.status_code == 200, (
                f"Expected 200 but got {response.status_code}: {response.text}"
            )
