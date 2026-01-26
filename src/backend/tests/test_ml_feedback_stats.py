"""Tests for feedback stats CLI."""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock

import pytest

from backend.ml.feedback_stats import (
    get_feedback_summary,
    get_available_stages,
    get_weekly_trend,
)


class TestFeedbackSummary:
    """Tests for feedback summary."""

    @pytest.mark.asyncio
    async def test_summary_with_data(self):
        """Should return correct counts and breakdown."""
        mock_feedback = [
            {"feedback_type": "true_positive", "environment": "prod"},
            {"feedback_type": "true_positive", "environment": "prod"},
            {"feedback_type": "false_positive", "environment": "prod"},
            {"feedback_type": "true_positive", "environment": "dev"},
        ]

        with patch("backend.ml.feedback_stats.get_all_feedback", new_callable=AsyncMock) as mock:
            mock.return_value = mock_feedback
            summary = await get_feedback_summary()

        assert summary["total"] == 4
        assert summary["prod"]["total"] == 3
        assert summary["prod"]["tp"] == 2
        assert summary["prod"]["fp"] == 1
        assert summary["dev"]["total"] == 1

    @pytest.mark.asyncio
    async def test_summary_empty(self):
        """Should handle no feedback gracefully."""
        with patch("backend.ml.feedback_stats.get_all_feedback", new_callable=AsyncMock) as mock:
            mock.return_value = []
            summary = await get_feedback_summary()

        assert summary["total"] == 0
        assert summary["prod"]["total"] == 0


class TestAvailableStages:
    """Tests for stage availability."""

    def test_no_stages_with_few_samples(self):
        """Should show no stages available with < 10 samples."""
        summary = {"prod": {"total": 5, "tp": 3, "fp": 2}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is False
        assert stages["stage_2"]["available"] is False
        assert stages["stage_3"]["available"] is False

    def test_stage_1_available(self):
        """Should show stage 1 available with >= 10 samples."""
        summary = {"prod": {"total": 15, "tp": 10, "fp": 5}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is False

    def test_stage_2_available(self):
        """Should show stage 2 available with >= 50 samples."""
        summary = {"prod": {"total": 60, "tp": 45, "fp": 15}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is True
        assert stages["stage_3"]["available"] is False

    def test_stage_3_available(self):
        """Should show stage 3 available with >= 200 samples."""
        summary = {"prod": {"total": 250, "tp": 200, "fp": 50}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is True
        assert stages["stage_3"]["available"] is True
