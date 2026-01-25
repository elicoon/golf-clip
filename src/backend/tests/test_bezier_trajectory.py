"""Test Bezier-based trajectory generation with full configuration."""

import pytest
from backend.detection.tracker import ConstrainedBallTracker


class TestGenerateConfiguredTrajectory:
    """Tests for generate_configured_trajectory method."""

    def test_trajectory_starts_at_origin(self):
        """First point should be at origin."""
        tracker = ConstrainedBallTracker()
        result = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.55, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )

        assert result is not None
        first = result["points"][0]
        assert abs(first["x"] - 0.5) < 0.01
        assert abs(first["y"] - 0.85) < 0.01

    def test_trajectory_ends_at_landing(self):
        """Last point should be exactly at landing."""
        tracker = ConstrainedBallTracker()
        result = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.6, 0.75),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )

        last = result["points"][-1]
        assert abs(last["x"] - 0.6) < 0.001
        assert abs(last["y"] - 0.75) < 0.001

    def test_draw_curves_left(self):
        """Draw shot should curve left (negative x offset at apex)."""
        tracker = ConstrainedBallTracker()
        straight = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="medium",
            strike_time=10.0,
        )
        draw = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="draw",
            shot_height="medium",
            strike_time=10.0,
        )

        # Find midpoint of each trajectory
        straight_mid = straight["points"][len(straight["points"]) // 2]
        draw_mid = draw["points"][len(draw["points"]) // 2]

        # Draw should be left of straight (lower x)
        assert draw_mid["x"] < straight_mid["x"]

    def test_high_shot_has_higher_apex(self):
        """High shot should have lower y value at apex (higher on screen)."""
        tracker = ConstrainedBallTracker()
        low = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="low",
            strike_time=10.0,
        )
        high = tracker.generate_configured_trajectory(
            origin=(0.5, 0.85),
            target=(0.5, 0.3),
            landing=(0.5, 0.80),
            starting_line="center",
            shot_shape="straight",
            shot_height="high",
            strike_time=10.0,
        )

        # Find min y (apex) for each
        low_apex_y = min(p["y"] for p in low["points"])
        high_apex_y = min(p["y"] for p in high["points"])

        # High shot apex should be lower y (higher on screen)
        assert high_apex_y < low_apex_y

    def test_flight_duration_varies_by_height(self):
        """Flight duration should be 3s/4.5s/6s for low/medium/high."""
        tracker = ConstrainedBallTracker()

        for height, expected_duration in [("low", 3.0), ("medium", 4.5), ("high", 6.0)]:
            result = tracker.generate_configured_trajectory(
                origin=(0.5, 0.85),
                target=(0.5, 0.3),
                landing=(0.5, 0.80),
                starting_line="center",
                shot_shape="straight",
                shot_height=height,
                strike_time=10.0,
            )
            assert abs(result["flight_duration"] - expected_duration) < 0.1
