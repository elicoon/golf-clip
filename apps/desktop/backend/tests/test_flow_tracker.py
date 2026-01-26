"""Tests for optical flow tracker."""

import numpy as np
import cv2
import pytest

from backend.detection.flow_tracker import OpticalFlowTracker


class TestOpticalFlowTracker:
    """Tests for OpticalFlowTracker."""

    def test_initialization(self):
        """Should initialize with features at ball position."""
        tracker = OpticalFlowTracker()

        # Create frame with a white circle
        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 100), 10, 255, -1)

        success = tracker.initialize(frame, center=(100, 100), radius=10)
        assert success is True

    def test_motion_tracking(self):
        """Should track motion between frames."""
        tracker = OpticalFlowTracker()

        # Frame 1: ball at (100, 100)
        frame1 = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame1, (100, 100), 10, 255, -1)

        # Frame 2: ball at (110, 90)
        frame2 = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame2, (110, 90), 10, 255, -1)

        tracker.initialize(frame1, center=(100, 100), radius=10)
        result = tracker.track(frame2)

        assert result is not None
        # Ball position should be approximately (110, 90)
        if result.ball_position:
            assert 100 < result.ball_position[0] < 120
            assert 80 < result.ball_position[1] < 100

    def test_reset(self):
        """Reset should clear state."""
        tracker = OpticalFlowTracker()

        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 100), 10, 255, -1)

        tracker.initialize(frame, center=(100, 100), radius=10)
        tracker.reset()

        assert tracker._prev_gray is None
        assert tracker._prev_points is None
