# src/backend/tests/test_early_tracker.py
"""Tests for EarlyBallTracker."""

import pytest

from backend.detection.early_tracker import (
    EarlyBallTracker,
    EarlyDetection,
    DetectionCandidate,
    find_best_continuation,
    validate_track_velocity,
)


class TestDetectionCandidate:
    """Tests for DetectionCandidate operations."""

    def test_find_best_continuation_upward_motion(self):
        """Should prefer candidates moving upward."""
        prev = DetectionCandidate(
            frame_idx=0, x=100.0, y=500.0,
            color_score=0.8, motion_score=0.7,
        )

        # One moving up, one moving down
        candidates = [
            DetectionCandidate(
                frame_idx=1, x=100.0, y=400.0,  # Moving UP (good)
                color_score=0.8, motion_score=0.7,
            ),
            DetectionCandidate(
                frame_idx=1, x=100.0, y=550.0,  # Moving DOWN (bad)
                color_score=0.9, motion_score=0.8,
            ),
        ]

        best = find_best_continuation(prev, candidates, track_history=[])

        assert best is not None
        assert best.y == 400.0  # Should pick the upward-moving one

    def test_find_best_continuation_rejects_stationary(self):
        """Should reject candidates that haven't moved enough."""
        prev = DetectionCandidate(
            frame_idx=0, x=100.0, y=500.0,
            color_score=0.8, motion_score=0.7,
        )

        candidates = [
            DetectionCandidate(
                frame_idx=1, x=101.0, y=499.0,  # Barely moved
                color_score=0.9, motion_score=0.9,
            ),
        ]

        best = find_best_continuation(prev, candidates, track_history=[])

        assert best is None  # Should reject - not enough movement

    def test_find_best_continuation_allows_large_distance(self):
        """Should allow large distances (ball moves fast)."""
        prev = DetectionCandidate(
            frame_idx=0, x=100.0, y=500.0,
            color_score=0.8, motion_score=0.7,
        )

        candidates = [
            DetectionCandidate(
                frame_idx=1, x=110.0, y=400.0,  # 100px movement
                color_score=0.8, motion_score=0.7,
            ),
        ]

        best = find_best_continuation(prev, candidates, track_history=[])

        assert best is not None
        assert best.y == 400.0


class TestTrackValidation:
    """Tests for track validation."""

    def test_validate_track_accepts_decelerating(self):
        """Should accept tracks that decelerate (normal physics)."""
        track = [
            DetectionCandidate(0, 100, 500, 0.8, 0.7),
            DetectionCandidate(1, 100, 400, 0.8, 0.7),  # 100px
            DetectionCandidate(2, 100, 320, 0.8, 0.7),  # 80px (slowing)
            DetectionCandidate(3, 100, 260, 0.8, 0.7),  # 60px (slowing more)
        ]

        assert validate_track_velocity(track) is True

    def test_validate_track_rejects_sudden_direction_change(self):
        """Should reject tracks with sudden direction changes."""
        track = [
            DetectionCandidate(0, 100, 500, 0.8, 0.7),
            DetectionCandidate(1, 100, 400, 0.8, 0.7),  # Up
            DetectionCandidate(2, 200, 350, 0.8, 0.7),  # Up-right
            DetectionCandidate(3, 100, 300, 0.8, 0.7),  # Suddenly left (bad)
        ]

        assert validate_track_velocity(track) is False
