# src/backend/tests/test_color_family.py
"""Tests for color family detection and matching."""

import numpy as np
import pytest
from backend.detection.color_family import (
    ColorFamily,
    ColorTemplate,
    classify_ball_color,
    extract_color_template,
    compute_color_match_score,
)


class TestColorFamilyClassification:
    """Tests for classify_ball_color function."""

    def test_white_ball_high_value_low_saturation(self):
        """White ball: high value, low saturation."""
        # HSV: any hue, low sat (<30), high value (>150)
        result = classify_ball_color(hue=90, saturation=20, value=200)
        assert result == ColorFamily.WHITE

    def test_orange_ball(self):
        """Orange ball: hue in 10-35 range."""
        result = classify_ball_color(hue=15, saturation=180, value=220)
        assert result == ColorFamily.ORANGE

    def test_yellow_ball(self):
        """Yellow ball: hue in 40-70 range."""
        result = classify_ball_color(hue=30, saturation=200, value=230)
        assert result == ColorFamily.YELLOW

    def test_pink_ball(self):
        """Pink ball: hue in 155-180 or 0-5 range."""
        result = classify_ball_color(hue=170, saturation=150, value=200)
        assert result == ColorFamily.PINK

    def test_green_ball(self):
        """Green ball: hue in 40-75 range."""
        result = classify_ball_color(hue=60, saturation=180, value=180)
        assert result == ColorFamily.GREEN


class TestColorMatchScore:
    """Tests for compute_color_match_score function."""

    def test_exact_match_returns_high_score(self):
        """Exact color match should return score near 1.0."""
        template = ColorTemplate(
            family=ColorFamily.ORANGE,
            hue=15,
            saturation=180,
            value=220,
        )
        # Exact same values
        score = compute_color_match_score(
            pixel_hsv=(15, 180, 220),
            template=template,
            elapsed_sec=0.0,
        )
        assert score >= 0.9

    def test_different_hue_returns_low_score(self):
        """Different hue family should return low score."""
        template = ColorTemplate(
            family=ColorFamily.ORANGE,
            hue=15,
            saturation=180,
            value=220,
        )
        # Blue hue (completely different)
        score = compute_color_match_score(
            pixel_hsv=(110, 180, 220),
            template=template,
            elapsed_sec=0.0,
        )
        assert score < 0.3

    def test_tolerance_increases_with_time(self):
        """Score should be more forgiving at later times."""
        template = ColorTemplate(
            family=ColorFamily.ORANGE,
            hue=15,
            saturation=180,
            value=220,
        )
        # Slightly different value
        pixel = (15, 150, 180)  # Lower sat and value

        score_early = compute_color_match_score(pixel, template, elapsed_sec=0.0)
        score_late = compute_color_match_score(pixel, template, elapsed_sec=0.5)

        # Later time should be more forgiving
        assert score_late >= score_early

    def test_white_ball_allows_value_variation(self):
        """White balls should allow significant value variation."""
        template = ColorTemplate(
            family=ColorFamily.WHITE,
            hue=0,
            saturation=15,
            value=230,
        )
        # Darker white (in shadow)
        score = compute_color_match_score(
            pixel_hsv=(0, 20, 160),
            template=template,
            elapsed_sec=0.2,
        )
        assert score >= 0.5  # Should still match

    def test_white_ball_rejects_saturated_pixels(self):
        """White ball matching should reject saturated pixels."""
        template = ColorTemplate(
            family=ColorFamily.WHITE,
            hue=0,
            saturation=15,
            value=230,
        )
        # High saturation = not white
        score = compute_color_match_score(
            pixel_hsv=(0, 150, 230),
            template=template,
            elapsed_sec=0.0,
        )
        assert score < 0.2
