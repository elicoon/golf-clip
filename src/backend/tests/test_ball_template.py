"""Tests for ball template extraction."""

import numpy as np
import cv2
import pytest

from backend.detection.ball_template import BallTemplateExtractor, BallTemplate


class TestBallTemplateExtractor:
    """Tests for BallTemplateExtractor."""

    def test_circularity_perfect_circle(self):
        """Circularity of a perfect circle should be close to 1.0."""
        extractor = BallTemplateExtractor()
        # Create a perfect circle contour
        contour = np.array([
            [[50 + int(20 * np.cos(a)), 50 + int(20 * np.sin(a))]]
            for a in np.linspace(0, 2 * np.pi, 36)
        ], dtype=np.int32)
        circularity = extractor._calculate_circularity(contour)
        assert 0.9 < circularity <= 1.0, f"Expected ~1.0, got {circularity}"

    def test_brightness_filter_rejects_dark(self):
        """Dark blobs should be rejected."""
        extractor = BallTemplateExtractor(min_brightness=120)
        # A candidate with low brightness should be filtered
        candidates = [
            {"x": 100, "y": 100, "radius": 10, "brightness": 80, "circularity": 0.9},
            {"x": 200, "y": 200, "radius": 10, "brightness": 200, "circularity": 0.9},
        ]
        filtered = [c for c in candidates if c["brightness"] >= extractor.min_brightness]
        assert len(filtered) == 1
        assert filtered[0]["brightness"] == 200

    def test_extract_template_returns_ball_template(self):
        """Template extraction should return a BallTemplate with correct fields."""
        # Create synthetic frames: ball appears from nothing (simulating ball entering frame)
        # Frame 1: empty (ball just struck, about to appear)
        # Frame 2: ball appears at (105, 95)
        frame1 = np.zeros((200, 200, 3), dtype=np.uint8)
        frame2 = np.zeros((200, 200, 3), dtype=np.uint8)
        cv2.circle(frame2, (105, 95), 10, (255, 255, 255), -1)  # Ball appears

        extractor = BallTemplateExtractor()
        template = extractor._extract_from_frames(
            [frame1, frame2],
            origin_x=100,
            origin_y=100,
            max_distance=50,
        )

        assert template is not None
        assert isinstance(template, BallTemplate)
        assert template.radius > 0
        assert template.brightness > 100
        assert template.image is not None
        assert template.mask is not None


class TestBallTemplateCircularity:
    """Tests for circularity calculations."""

    def test_circularity_ellipse(self):
        """An ellipse should have lower circularity than a circle."""
        extractor = BallTemplateExtractor()

        # Create an elongated ellipse contour (2:1 aspect ratio)
        ellipse_contour = np.array([
            [[50 + int(30 * np.cos(a)), 50 + int(15 * np.sin(a))]]
            for a in np.linspace(0, 2 * np.pi, 36)
        ], dtype=np.int32)

        circularity = extractor._calculate_circularity(ellipse_contour)
        # Ellipse should have circularity significantly less than 1.0
        assert circularity < 0.85, f"Expected <0.85 for ellipse, got {circularity}"

    def test_circularity_small_contour(self):
        """Very small contours should return 0 circularity."""
        extractor = BallTemplateExtractor()

        # Create a very small contour (just 3 points forming a tiny triangle)
        small_contour = np.array([
            [[10, 10]],
            [[11, 10]],
            [[10, 11]],
        ], dtype=np.int32)

        circularity = extractor._calculate_circularity(small_contour)
        # Perimeter is very small, should handle gracefully
        assert 0 <= circularity <= 1.0


class TestBallTemplateSizeFiltering:
    """Tests for size filtering of ball candidates."""

    def test_rejects_too_small(self):
        """Candidates that are too small should be rejected."""
        extractor = BallTemplateExtractor(min_radius=8, max_radius=25)

        # Create frames: small ball appears (too small to detect)
        frame1 = np.zeros((200, 200, 3), dtype=np.uint8)
        frame2 = np.zeros((200, 200, 3), dtype=np.uint8)
        cv2.circle(frame2, (105, 95), 3, (255, 255, 255), -1)  # Too small

        template = extractor._extract_from_frames(
            [frame1, frame2],
            origin_x=100,
            origin_y=100,
            max_distance=50,
        )

        # Should return None because circle is too small
        assert template is None

    def test_rejects_too_large(self):
        """Candidates that are too large should be rejected."""
        extractor = BallTemplateExtractor(min_radius=8, max_radius=25)

        # Create frames: large object appears (too large to be a ball)
        frame1 = np.zeros((200, 200, 3), dtype=np.uint8)
        frame2 = np.zeros((200, 200, 3), dtype=np.uint8)
        cv2.circle(frame2, (100, 100), 40, (255, 255, 255), -1)  # Too large

        template = extractor._extract_from_frames(
            [frame1, frame2],
            origin_x=100,
            origin_y=100,
            max_distance=150,  # Increase distance to allow detection
        )

        # Should return None because circle is too large
        assert template is None


class TestBallTemplateDataclass:
    """Tests for the BallTemplate dataclass."""

    def test_ball_template_fields(self):
        """BallTemplate should have all required fields."""
        # Create a simple template
        image = np.zeros((20, 20, 3), dtype=np.uint8)
        mask = np.zeros((20, 20), dtype=np.uint8)

        template = BallTemplate(
            image=image,
            mask=mask,
            center=(10, 10),
            radius=10,
            brightness=200.0,
            frame_index=0,
            confidence=0.9,
        )

        assert template.image is not None
        assert template.mask is not None
        assert template.center == (10, 10)
        assert template.radius == 10
        assert template.brightness == 200.0
        assert template.frame_index == 0
        assert template.confidence == 0.9
