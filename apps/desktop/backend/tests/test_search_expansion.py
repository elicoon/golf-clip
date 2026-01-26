# src/backend/tests/test_search_expansion.py
"""Tests for progressive search expansion strategy."""

import pytest
from backend.detection.search_expansion import (
    SearchExpansionStrategy,
    calculate_refined_search_corridor,
)


class TestSearchExpansionStrategy:
    """Tests for SearchExpansionStrategy class."""

    def test_level_0_tight_search(self):
        """Level 0 should return tight search region."""
        strategy = SearchExpansionStrategy(
            origin=(0.5, 0.8),  # Normalized coords
            frame_width=1920,
            frame_height=1080,
        )

        base_region = (900, 700, 1000, 800)  # 100x100 base
        region = strategy.get_search_region(
            expansion_level=0,
            elapsed_sec=0.1,
            base_region=base_region,
        )

        # Level 0 = 1x, should be same as base
        x1, y1, x2, y2 = region
        assert x2 - x1 <= 120  # Allow small expansion for time
        assert y2 - y1 <= 120

    def test_level_3_maximum_expansion(self):
        """Level 3 should return maximum expansion (1/3 width)."""
        strategy = SearchExpansionStrategy(
            origin=(0.5, 0.8),
            frame_width=1920,
            frame_height=1080,
        )

        base_region = (900, 700, 1000, 800)
        region = strategy.get_search_region(
            expansion_level=3,
            elapsed_sec=0.1,
            base_region=base_region,
        )

        x1, y1, x2, y2 = region

        # Width should be ~1/3 of frame (640px)
        width = x2 - x1
        assert 500 <= width <= 700

        # Should extend from top to near origin
        assert y1 == 0  # Top of frame
        assert y2 >= int(0.8 * 1080)  # At or below origin

    def test_expansion_increases_with_level(self):
        """Higher levels should have larger regions."""
        strategy = SearchExpansionStrategy(
            origin=(0.5, 0.8),
            frame_width=1920,
            frame_height=1080,
        )

        base_region = (900, 700, 1000, 800)
        regions = []

        for level in range(4):
            region = strategy.get_search_region(level, 0.1, base_region)
            width = region[2] - region[0]
            regions.append(width)

        # Each level should be larger than the previous
        assert regions[1] > regions[0]
        assert regions[2] > regions[1]
        assert regions[3] > regions[2]


class TestRefinedSearchCorridor:
    """Tests for calculate_refined_search_corridor function."""

    def test_corridor_follows_expected_path(self):
        """Corridor should be centered on interpolated position."""
        origin = (0.5, 0.85)
        landing = (0.55, 0.80)
        apex = (0.52, 0.20)

        # At t=0, should be near origin
        region = calculate_refined_search_corridor(
            origin=origin,
            apex=apex,
            landing=landing,
            shot_shape="straight",
            starting_line="center",
            shot_height="medium",
            elapsed_sec=0.0,
            total_flight_time=3.0,
            frame_width=1920,
            frame_height=1080,
        )

        x1, y1, x2, y2 = region
        center_x = (x1 + x2) / 2 / 1920
        center_y = (y1 + y2) / 2 / 1080

        # Center should be near origin at t=0
        assert abs(center_x - origin[0]) < 0.1
        assert abs(center_y - origin[1]) < 0.15

    def test_corridor_applies_shot_shape_offset(self):
        """Shot shape should offset the corridor horizontally."""
        origin = (0.5, 0.85)
        landing = (0.55, 0.80)

        # Draw vs fade should have different x positions
        draw_region = calculate_refined_search_corridor(
            origin=origin,
            apex=None,
            landing=landing,
            shot_shape="draw",
            starting_line="center",
            shot_height="medium",
            elapsed_sec=0.2,
            total_flight_time=3.0,
            frame_width=1920,
            frame_height=1080,
        )

        fade_region = calculate_refined_search_corridor(
            origin=origin,
            apex=None,
            landing=landing,
            shot_shape="fade",
            starting_line="center",
            shot_height="medium",
            elapsed_sec=0.2,
            total_flight_time=3.0,
            frame_width=1920,
            frame_height=1080,
        )

        draw_center_x = (draw_region[0] + draw_region[2]) / 2
        fade_center_x = (fade_region[0] + fade_region[2]) / 2

        # Draw curves left, fade curves right
        assert draw_center_x < fade_center_x
