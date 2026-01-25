"""Test track_with_landing_point trajectory generation."""

import pytest
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.detection.tracker import ConstrainedBallTracker
from backend.detection.origin import OriginDetection


class TestTrackWithLandingPoint:
    """Tests for track_with_landing_point method."""

    def test_generates_trajectory_ending_at_landing(self):
        """Trajectory should end at the user-marked landing point."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(
            x=500,
            y=800,
            confidence=0.9,
            method="test",
        )

        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        assert "points" in result
        assert len(result["points"]) > 0

        # Last point should be at landing position
        last_point = result["points"][-1]
        assert abs(last_point["x"] - 0.7) < 0.01
        assert abs(last_point["y"] - 0.85) < 0.01

    def test_trajectory_starts_at_origin(self):
        """Trajectory should start at the detected origin."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(
            x=960,
            y=900,
            confidence=0.9,
            method="test",
        )

        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.6, 0.9),
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        first_point = result["points"][0]

        expected_x = 960 / 1920  # 0.5
        expected_y = 900 / 1080  # ~0.833
        assert abs(first_point["x"] - expected_x) < 0.01
        assert abs(first_point["y"] - expected_y) < 0.01

    def test_trajectory_has_apex_above_endpoints(self):
        """Trajectory apex should be above both origin and landing."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(x=500, y=900, confidence=0.9, method="test")

        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        assert "apex_point" in result

        apex_y = result["apex_point"]["y"]
        origin_y = result["points"][0]["y"]
        landing_y = result["points"][-1]["y"]

        assert apex_y < origin_y, "Apex should be above origin"
        assert apex_y < landing_y, "Apex should be above landing"

    def test_progress_callback_is_called(self):
        """Progress callback should be called during generation."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(x=500, y=900, confidence=0.9, method="test")

        progress_calls = []
        def progress_cb(percent, message):
            progress_calls.append((percent, message))

        with patch.object(tracker, 'track_flight', return_value=[]):
            tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
                progress_callback=progress_cb,
            )

        assert len(progress_calls) > 0
        assert any(p[0] > 0 for p in progress_calls)

    def test_warning_callback_invoked_when_early_detection_fails(self):
        """Warning callback should be called when early detections unavailable."""
        tracker = ConstrainedBallTracker()
        origin = OriginDetection(x=500, y=900, confidence=0.9, method="test")

        warnings = []
        def warning_cb(code, message):
            warnings.append((code, message))

        with patch.object(tracker, 'track_flight', return_value=[]):  # Return empty list
            tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
                warning_callback=warning_cb,
            )

        assert len(warnings) > 0
        assert any("early_ball_detection_failed" in w[0] for w in warnings)
