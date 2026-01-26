# src/backend/tests/test_early_detection_integration.py
"""Integration tests for early ball detection pipeline."""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch
import numpy as np

from backend.detection.early_tracker import EarlyBallTracker, EarlyDetection
from backend.detection.color_family import ColorFamily, ColorTemplate


class TestEarlyTrackerIntegration:
    """Integration tests for EarlyBallTracker."""

    def test_detect_with_constraints_returns_detections(self):
        """Should return detections when given constraints."""
        # This test requires a mock video - skip if not available
        pytest.skip("Requires test video fixture")

    def test_progressive_expansion_increases_coverage(self):
        """Higher expansion levels should search larger regions."""
        from backend.detection.search_expansion import SearchExpansionStrategy

        strategy = SearchExpansionStrategy(
            origin=(0.5, 0.8),
            frame_width=1920,
            frame_height=1080,
        )

        base = (900, 700, 1000, 800)
        regions = [strategy.get_search_region(i, 0.1, base) for i in range(4)]

        # Each level should be larger
        widths = [r[2] - r[0] for r in regions]
        assert widths[1] > widths[0]
        assert widths[2] > widths[1]
        assert widths[3] > widths[2]

        # Level 3 should be ~1/3 of frame width
        assert 500 <= widths[3] <= 700


class TestApexConstrainedTrajectory:
    """Tests for apex-constrained trajectory generation."""

    def test_trajectory_passes_through_apex(self):
        """Generated trajectory should pass through marked apex."""
        from backend.detection.tracker import ConstrainedBallTracker

        tracker = ConstrainedBallTracker()

        origin = (0.5, 0.85)
        apex = (0.52, 0.15)
        landing = (0.55, 0.80)

        result = tracker._generate_apex_constrained_trajectory(
            origin=origin,
            apex=apex,
            landing=landing,
            strike_time=10.0,
            flight_time=3.0,
        )

        assert result is not None
        assert len(result["points"]) > 10

        # Apex point should match
        assert abs(result["apex_point"]["x"] - apex[0]) < 0.01
        assert abs(result["apex_point"]["y"] - apex[1]) < 0.01

        # Find point closest to apex in trajectory
        min_dist = float("inf")
        for p in result["points"]:
            dist = abs(p["x"] - apex[0]) + abs(p["y"] - apex[1])
            min_dist = min(min_dist, dist)

        # Should pass very close to apex
        assert min_dist < 0.05

    def test_trajectory_starts_at_origin(self):
        """Trajectory should start at origin point."""
        from backend.detection.tracker import ConstrainedBallTracker

        tracker = ConstrainedBallTracker()

        origin = (0.45, 0.90)
        apex = (0.50, 0.20)
        landing = (0.60, 0.85)

        result = tracker._generate_apex_constrained_trajectory(
            origin=origin,
            apex=apex,
            landing=landing,
            strike_time=5.0,
            flight_time=2.5,
        )

        assert result is not None
        first_point = result["points"][0]
        assert first_point["x"] == origin[0]
        assert first_point["y"] == origin[1]

    def test_trajectory_ends_at_landing(self):
        """Trajectory should end at landing point."""
        from backend.detection.tracker import ConstrainedBallTracker

        tracker = ConstrainedBallTracker()

        origin = (0.5, 0.85)
        apex = (0.55, 0.25)
        landing = (0.65, 0.80)

        result = tracker._generate_apex_constrained_trajectory(
            origin=origin,
            apex=apex,
            landing=landing,
            strike_time=10.0,
            flight_time=3.5,
        )

        assert result is not None
        last_point = result["points"][-1]
        assert last_point["x"] == landing[0]
        assert last_point["y"] == landing[1]

    def test_trajectory_metadata_is_correct(self):
        """Trajectory should include correct metadata."""
        from backend.detection.tracker import ConstrainedBallTracker

        tracker = ConstrainedBallTracker()

        result = tracker._generate_apex_constrained_trajectory(
            origin=(0.5, 0.85),
            apex=(0.52, 0.15),
            landing=(0.55, 0.80),
            strike_time=10.0,
            flight_time=3.0,
        )

        assert result is not None
        assert result["method"] == "apex_constrained"
        assert result["confidence"] == 0.90
        assert result["flight_duration"] == 3.0
        assert "apex_point" in result
        assert "landing_point" in result


class TestColorFamilyIntegration:
    """Integration tests for color family module."""

    def test_color_match_score_ranges(self):
        """Color match scores should be in valid range."""
        from backend.detection.color_family import (
            compute_color_match_score,
            ColorTemplate,
            ColorFamily,
        )

        template = ColorTemplate(
            family=ColorFamily.WHITE,
            hue=0,
            saturation=20,
            value=230,
        )

        # Test various pixels
        test_cases = [
            ((0, 10, 240), 0.0),  # Very similar white
            ((0, 20, 200), 0.0),  # Darker white
            ((0, 100, 230), 0.0), # More saturated - should reject
            ((30, 200, 200), 0.0), # Completely different color
        ]

        for pixel, _ in test_cases:
            score = compute_color_match_score(pixel, template, elapsed_sec=0.1)
            assert 0.0 <= score <= 1.0, f"Score {score} out of range for pixel {pixel}"
