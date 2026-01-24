"""Tests for multi-scale template matching."""

import numpy as np
import cv2
import pytest

from backend.detection.scale_matcher import MultiScaleMatcher, ScaleMatch


class TestMultiScaleMatcher:
    """Tests for MultiScaleMatcher."""

    def test_scale_pyramid_creation(self):
        """Pyramid should have correct number of scales."""
        matcher = MultiScaleMatcher(num_scales=5)
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        matcher.prepare_template(template)
        assert len(matcher._scale_pyramid) == 5

    def test_perfect_match_high_score(self):
        """Identical template should have score close to 1.0."""
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        frame = np.zeros((100, 100), dtype=np.uint8)
        frame[40:61, 40:61] = template

        matcher = MultiScaleMatcher(min_correlation=0.5)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) > 0
        assert matches[0].score > 0.9

    def test_scaled_match(self):
        """Should find ball at different scale."""
        # Create template (larger ball)
        template = np.zeros((31, 31), dtype=np.uint8)
        cv2.circle(template, (15, 15), 12, 255, -1)

        # Create frame with smaller ball
        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 80), 8, 255, -1)

        matcher = MultiScaleMatcher(min_scale=0.4, max_scale=1.2, min_correlation=0.5)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) > 0
        best = matches[0]
        assert 90 < best.x < 110, f"X position off: {best.x}"
        assert 70 < best.y < 90, f"Y position off: {best.y}"
        assert best.scale < 1.0, f"Scale should be < 1.0: {best.scale}"

    def test_no_match_below_threshold(self):
        """Should not return matches below threshold."""
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        # Frame with no ball
        frame = np.zeros((100, 100), dtype=np.uint8)

        matcher = MultiScaleMatcher(min_correlation=0.7)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) == 0
