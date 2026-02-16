# Early Ball Detection & UI Improvements - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve early ball detection (first 0.5s) using layered detection and add apex point marking + status tracker UI.

**Architecture:** Layered detection pipeline (physics-guided cones → color family matching → multi-frame validation) with progressive search expansion. UI adds apex marking step and visual status tracker component.

**Tech Stack:** Python/OpenCV (backend), React/TypeScript (frontend), HSV color space for matching.

---

## Task 1: Create Color Family Module

**Files:**
- Create: `src/backend/detection/color_family.py`
- Test: `src/backend/tests/test_color_family.py`

**Step 1: Write the failing test for ColorFamily enum and classifier**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_color_family.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'backend.detection.color_family'"

**Step 3: Write minimal implementation**

```python
# src/backend/detection/color_family.py
"""Color family detection and matching for golf ball tracking.

Uses HSV color space for robust matching across lighting conditions.
Supports white, orange, yellow, pink, green, and other ball colors.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

import cv2
import numpy as np
from loguru import logger


class ColorFamily(Enum):
    """Color families for golf balls."""
    WHITE = "white"
    ORANGE = "orange"
    YELLOW = "yellow"
    PINK = "pink"
    GREEN = "green"
    BLUE = "blue"
    OTHER = "other"


@dataclass
class ColorTemplate:
    """Extracted color template from a golf ball."""
    family: ColorFamily
    hue: int  # 0-180 (OpenCV HSV range)
    saturation: int  # 0-255
    value: int  # 0-255
    hue_std: float = 0.0  # Standard deviation for tolerance
    sat_std: float = 0.0
    val_std: float = 0.0


def classify_ball_color(hue: int, saturation: int, value: int) -> ColorFamily:
    """
    Classify ball into color family based on HSV values.

    Args:
        hue: 0-180 (OpenCV HSV range)
        saturation: 0-255
        value: 0-255

    Returns:
        ColorFamily enum value
    """
    # White ball: low saturation, high value
    if saturation < 30 and value > 150:
        return ColorFamily.WHITE

    # Gray/silver ball: low saturation, medium value - treat as white family
    if saturation < 40 and 80 < value <= 150:
        return ColorFamily.WHITE

    # Colored balls: classify by hue (OpenCV uses 0-180 range)
    if 5 <= hue <= 18:  # Orange
        return ColorFamily.ORANGE
    elif 20 <= hue <= 35:  # Yellow (OpenCV yellow is ~25-35)
        return ColorFamily.YELLOW
    elif 40 <= hue <= 75:  # Green
        return ColorFamily.GREEN
    elif 155 <= hue <= 180 or 0 <= hue < 5:  # Pink/Magenta (wraps around)
        return ColorFamily.PINK
    elif 100 <= hue <= 130:  # Blue (rare but possible)
        return ColorFamily.BLUE
    else:
        return ColorFamily.OTHER


def extract_color_template(
    frame: np.ndarray,
    origin_x: int,
    origin_y: int,
    crop_size: int = 40,
) -> Optional[ColorTemplate]:
    """
    Extract ball color template from a frame.

    Should be called on a frame where the ball is stationary (e.g., 0.5s before impact).

    Args:
        frame: BGR frame from video
        origin_x: Ball center X position (pixels)
        origin_y: Ball center Y position (pixels)
        crop_size: Size of region to crop around ball

    Returns:
        ColorTemplate if successful, None if extraction fails
    """
    height, width = frame.shape[:2]

    # Calculate crop bounds with boundary checking
    half_size = crop_size // 2
    x1 = max(0, origin_x - half_size)
    x2 = min(width, origin_x + half_size)
    y1 = max(0, origin_y - half_size)
    y2 = min(height, origin_y + half_size)

    if x2 - x1 < 10 or y2 - y1 < 10:
        logger.warning(f"Crop region too small: {x2-x1}x{y2-y1}")
        return None

    # Crop and convert to HSV
    ball_region = frame[y1:y2, x1:x2]
    ball_hsv = cv2.cvtColor(ball_region, cv2.COLOR_BGR2HSV)

    # Use center region (inner 50%) to avoid edge effects
    inner_margin = crop_size // 4
    center_hsv = ball_hsv[inner_margin:-inner_margin, inner_margin:-inner_margin]

    if center_hsv.size == 0:
        logger.warning("Center region is empty")
        return None

    # Compute median values (robust to outliers)
    hue = int(np.median(center_hsv[:, :, 0]))
    saturation = int(np.median(center_hsv[:, :, 1]))
    value = int(np.median(center_hsv[:, :, 2]))

    # Compute standard deviations for adaptive tolerance
    hue_std = float(np.std(center_hsv[:, :, 0]))
    sat_std = float(np.std(center_hsv[:, :, 1]))
    val_std = float(np.std(center_hsv[:, :, 2]))

    family = classify_ball_color(hue, saturation, value)

    logger.info(
        f"Extracted color template: family={family.value}, "
        f"HSV=({hue}, {saturation}, {value}), "
        f"std=({hue_std:.1f}, {sat_std:.1f}, {val_std:.1f})"
    )

    return ColorTemplate(
        family=family,
        hue=hue,
        saturation=saturation,
        value=value,
        hue_std=hue_std,
        sat_std=sat_std,
        val_std=val_std,
    )


def compute_color_match_score(
    pixel_hsv: Tuple[int, int, int],
    template: ColorTemplate,
    elapsed_sec: float,
) -> float:
    """
    Score how well a pixel matches the ball's color family.

    Args:
        pixel_hsv: (H, S, V) tuple for the pixel (OpenCV ranges)
        template: ColorTemplate from extract_color_template
        elapsed_sec: Seconds since ball was struck (affects tolerance)

    Returns:
        Score from 0.0 (no match) to 1.0 (perfect match)
    """
    h, s, v = pixel_hsv

    # Adaptive tolerance - widens as ball gets farther
    time_factor = 1.0 + elapsed_sec * 0.5  # 1.0 → 1.25 over 0.5s

    # Base tolerances
    hue_tolerance = 20 * time_factor
    sat_tolerance = 100 * time_factor  # 40% of 255
    val_tolerance = 127 * time_factor  # 50% of 255

    # Special handling for white balls
    if template.family == ColorFamily.WHITE:
        # White balls: low saturation, variable value
        # Can get darker (shadows) but shouldn't get more saturated

        # Reject if too saturated (can't be white)
        max_sat = 50 * time_factor
        if s > max_sat:
            return 0.0

        # Score based on value similarity
        val_diff = abs(v - template.value)
        score = max(0.0, 1.0 - (val_diff / val_tolerance))

        # Bonus for low saturation
        sat_score = max(0.0, 1.0 - (s / max_sat))
        score = 0.7 * score + 0.3 * sat_score

        return score

    # Colored balls: match on hue primarily
    # Hue wraps around at 180, so handle that
    hue_diff = abs(h - template.hue)
    hue_diff = min(hue_diff, 180 - hue_diff)  # Handle wrap-around

    if hue_diff > hue_tolerance:
        return 0.0  # Wrong color family entirely

    # Compute component scores
    hue_score = max(0.0, 1.0 - (hue_diff / hue_tolerance))
    sat_diff = abs(s - template.saturation)
    sat_score = max(0.0, 1.0 - (sat_diff / sat_tolerance))
    val_diff = abs(v - template.value)
    val_score = max(0.0, 1.0 - (val_diff / val_tolerance))

    # Weighted combination: hue matters most, then value, then saturation
    return 0.5 * hue_score + 0.3 * val_score + 0.2 * sat_score
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_color_family.py -v`
Expected: PASS (all tests)

**Step 5: Commit**

```bash
git add src/backend/detection/color_family.py src/backend/tests/test_color_family.py
git commit -m "feat(detection): add color family module for ball color matching

- Add ColorFamily enum and ColorTemplate dataclass
- Implement classify_ball_color for HSV-based classification
- Implement extract_color_template for template extraction
- Implement compute_color_match_score with adaptive tolerance
- Support white, orange, yellow, pink, green ball colors"
```

---

## Task 2: Create Search Expansion Module

**Files:**
- Create: `src/backend/detection/search_expansion.py`
- Test: `src/backend/tests/test_search_expansion.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_search_expansion.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write minimal implementation**

```python
# src/backend/detection/search_expansion.py
"""Progressive search expansion strategy for ball detection.

Starts with tight constraint-based corridors and expands if ball not found.
Prefers false positives (which can be filtered) over false negatives.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

from loguru import logger


@dataclass
class ExpansionLevel:
    """Configuration for a search expansion level."""
    name: str
    width_multiplier: Optional[float]  # None = maximum expansion


class SearchExpansionStrategy:
    """
    Progressive search expansion to avoid false negatives.

    Pass 1: Tight corridor based on user constraints (~50px wide)
    Pass 2: 2x expansion (~100px wide)
    Pass 3: 3x expansion (~150px wide)
    Pass 4: Maximum expansion (1/3 frame width, full vertical above origin)
    """

    EXPANSION_LEVELS: List[ExpansionLevel] = [
        ExpansionLevel(name="tight", width_multiplier=1.0),
        ExpansionLevel(name="medium", width_multiplier=2.0),
        ExpansionLevel(name="wide", width_multiplier=3.0),
        ExpansionLevel(name="maximum", width_multiplier=None),
    ]

    def __init__(
        self,
        origin: Tuple[float, float],
        frame_width: int,
        frame_height: int,
    ):
        """
        Initialize expansion strategy.

        Args:
            origin: Ball origin (x, y) in normalized coords (0-1)
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels
        """
        self.origin_x, self.origin_y = origin
        self.frame_width = frame_width
        self.frame_height = frame_height

        # Maximum search region (1/3 width, full vertical above origin)
        self.max_half_width = frame_width // 6  # 1/3 width = 1/6 on each side
        self.max_top = 0  # Top of frame
        self.max_bottom = int(origin[1] * frame_height) + 50  # Slightly below origin

    def get_search_region(
        self,
        expansion_level: int,
        elapsed_sec: float,
        base_region: Tuple[int, int, int, int],
    ) -> Tuple[int, int, int, int]:
        """
        Get search region for given expansion level.

        Args:
            expansion_level: 0-3 (tight to maximum)
            elapsed_sec: Time since strike (for time-based expansion)
            base_region: The tight constraint-based region (x1, y1, x2, y2)

        Returns:
            Expanded search region (x1, y1, x2, y2)
        """
        if expansion_level >= len(self.EXPANSION_LEVELS):
            expansion_level = len(self.EXPANSION_LEVELS) - 1

        level = self.EXPANSION_LEVELS[expansion_level]

        if level.width_multiplier is None:
            # Maximum expansion: 1/3 frame width, full vertical above origin
            origin_px_x = int(self.origin_x * self.frame_width)

            return (
                max(0, origin_px_x - self.max_half_width),
                self.max_top,
                min(self.frame_width, origin_px_x + self.max_half_width),
                self.max_bottom,
            )

        # Progressive expansion from base region
        x1, y1, x2, y2 = base_region
        center_x = (x1 + x2) // 2
        center_y = (y1 + y2) // 2
        half_width = (x2 - x1) // 2
        half_height = (y2 - y1) // 2

        # Expand by multiplier
        mult = level.width_multiplier
        new_half_width = int(half_width * mult)
        new_half_height = int(half_height * mult)

        # Clamp to frame bounds
        return (
            max(0, center_x - new_half_width),
            max(0, center_y - new_half_height),
            min(self.frame_width, center_x + new_half_width),
            min(self.frame_height, center_y + new_half_height),
        )

    def get_validation_thresholds(self, expansion_level: int) -> dict:
        """
        Get validation thresholds for given expansion level.

        Wider searches need stricter validation to filter noise.

        Args:
            expansion_level: 0-3

        Returns:
            Dict with threshold values
        """
        base_thresholds = {
            "min_color_score": 0.4,
            "min_track_confidence": 0.3,
            "min_direction_score": 0.5,
        }

        # Increase thresholds at wider levels
        strictness_multiplier = 1.0 + (expansion_level * 0.1)

        return {
            "min_color_score": min(0.7, base_thresholds["min_color_score"] * strictness_multiplier),
            "min_track_confidence": min(0.6, base_thresholds["min_track_confidence"] * strictness_multiplier),
            "min_direction_score": min(0.7, base_thresholds["min_direction_score"] * strictness_multiplier),
        }


def calculate_refined_search_corridor(
    origin: Tuple[float, float],
    apex: Optional[Tuple[float, float]],
    landing: Tuple[float, float],
    shot_shape: str,
    starting_line: str,
    shot_height: str,
    elapsed_sec: float,
    total_flight_time: float,
    frame_width: int,
    frame_height: int,
) -> Tuple[int, int, int, int]:
    """
    Calculate tight search region for a given time based on known endpoints.

    Uses user-marked points to constrain where the ball must have traveled.

    Args:
        origin: Ball origin (x, y) in normalized coords (0-1)
        apex: Ball apex (x, y) in normalized coords, or None
        landing: Ball landing (x, y) in normalized coords
        shot_shape: "hook", "draw", "straight", "fade", "slice"
        starting_line: "left", "center", "right"
        shot_height: "low", "medium", "high"
        elapsed_sec: Time since strike
        total_flight_time: Total expected flight time
        frame_width: Frame width in pixels
        frame_height: Frame height in pixels

    Returns:
        Search region (x1, y1, x2, y2) in pixels
    """
    origin_x, origin_y = origin
    landing_x, landing_y = landing

    # Estimate apex timing
    apex_time_ratio = 0.45
    apex_time = total_flight_time * apex_time_ratio

    if apex:
        apex_x, apex_y = apex

        if elapsed_sec <= apex_time:
            # Ascending: interpolate origin → apex
            t = elapsed_sec / apex_time if apex_time > 0 else 0
            # Ease-out for deceleration going up
            t_eased = 1 - (1 - t) ** 2

            expected_x = origin_x + (apex_x - origin_x) * t_eased
            expected_y = origin_y + (apex_y - origin_y) * t_eased
        else:
            # Descending: interpolate apex → landing
            t = (elapsed_sec - apex_time) / (total_flight_time - apex_time)
            t = min(1.0, max(0.0, t))

            expected_x = apex_x + (landing_x - apex_x) * t
            expected_y = apex_y + (landing_y - apex_y) * t
    else:
        # No apex marked - interpolate origin → landing with parabolic assumption
        t = elapsed_sec / total_flight_time if total_flight_time > 0 else 0
        t = min(1.0, max(0.0, t))

        # Parabolic height based on shot_height
        height_factors = {"low": 0.15, "medium": 0.30, "high": 0.45}
        height_factor = height_factors.get(shot_height, 0.30)

        # Parabola peaks at t=0.5
        parabola_y = -4 * height_factor * t * (1 - t)

        expected_x = origin_x + (landing_x - origin_x) * t
        expected_y = origin_y + (landing_y - origin_y) * t + parabola_y

    # Apply shot shape curve offset (most pronounced at mid-flight)
    curve_offsets = {
        "hook": -0.08,
        "draw": -0.04,
        "straight": 0.0,
        "fade": 0.04,
        "slice": 0.08,
    }
    curve_offset = curve_offsets.get(shot_shape, 0.0)

    # Curve is most pronounced at mid-flight
    flight_progress = elapsed_sec / total_flight_time if total_flight_time > 0 else 0
    curve_amount = curve_offset * 4 * flight_progress * (1 - flight_progress)
    expected_x += curve_amount

    # Apply starting line offset (affects early trajectory more)
    start_offsets = {"left": -0.03, "center": 0.0, "right": 0.03}
    start_offset = start_offsets.get(starting_line, 0.0)

    early_factor = max(0, 1 - elapsed_sec / 0.5)  # Fades over first 0.5s
    expected_x += start_offset * early_factor

    # Convert to pixels
    expected_px_x = int(expected_x * frame_width)
    expected_px_y = int(expected_y * frame_height)

    # Create search window around expected position
    # Window is small because we have good constraints
    window_half_size = int(50 + elapsed_sec * 60)  # 50px → 80px over 0.5s

    return (
        max(0, expected_px_x - window_half_size),
        max(0, expected_px_y - window_half_size),
        min(frame_width, expected_px_x + window_half_size),
        min(frame_height, expected_px_y + window_half_size),
    )
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_search_expansion.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backend/detection/search_expansion.py src/backend/tests/test_search_expansion.py
git commit -m "feat(detection): add progressive search expansion module

- Add SearchExpansionStrategy with 4 expansion levels
- Implement calculate_refined_search_corridor for constraint-based corridors
- Support shot shape and starting line offsets
- Stricter validation thresholds at wider expansion levels"
```

---

## Task 3: Create Early Ball Tracker Module

**Files:**
- Create: `src/backend/detection/early_tracker.py`
- Test: `src/backend/tests/test_early_tracker.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_early_tracker.py
"""Tests for EarlyBallTracker."""

import numpy as np
import pytest
from unittest.mock import Mock, patch, MagicMock

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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_early_tracker.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write minimal implementation**

```python
# src/backend/detection/early_tracker.py
"""Early ball tracking for the first 0.5 seconds after impact.

Uses layered detection:
1. Physics-guided search cones
2. Color family matching
3. Multi-frame validation

Designed to minimize false negatives - prefers finding something over finding nothing.
"""

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

from backend.detection.color_family import (
    ColorFamily,
    ColorTemplate,
    compute_color_match_score,
    extract_color_template,
)
from backend.detection.search_expansion import (
    SearchExpansionStrategy,
    calculate_refined_search_corridor,
)


@dataclass
class DetectionCandidate:
    """A candidate ball detection in a single frame."""
    frame_idx: int
    x: float
    y: float
    color_score: float
    motion_score: float
    physics_score: float = 0.0
    combined_score: float = 0.0
    radius: float = 10.0


@dataclass
class EarlyDetection:
    """A validated ball detection in the early flight window."""
    timestamp: float  # Seconds from video start
    x: float  # X position in pixels
    y: float  # Y position in pixels
    confidence: float  # Combined confidence score
    color_score: float
    motion_score: float
    physics_score: float


@dataclass
class ValidatedTrack:
    """A validated sequence of ball detections."""
    detections: List[DetectionCandidate]
    confidence: float
    velocity: Tuple[float, float] = (0.0, 0.0)


# Movement constraints
MIN_MOVEMENT = 10  # Minimum pixels per frame
MAX_MOVEMENT = 200  # Maximum pixels per frame
MIN_UPWARD_RATIO = 0.5  # At least 50% of movement should be upward
MAX_DIRECTION_CHANGE = math.radians(25)  # 25 degrees max per frame


def find_best_continuation(
    prev: DetectionCandidate,
    candidates: List[DetectionCandidate],
    track_history: List[DetectionCandidate],
) -> Optional[DetectionCandidate]:
    """
    Find the candidate most likely to be the same ball.

    Key insight: Ball moves FAST. Don't constrain distance, constrain DIRECTION.

    Args:
        prev: Previous detection
        candidates: Candidates in current frame
        track_history: Previous detections for direction estimation

    Returns:
        Best matching candidate, or None if no valid continuation
    """
    if not candidates:
        return None

    # Calculate expected direction from track history
    if len(track_history) >= 2:
        recent_dx = track_history[-1].x - track_history[-2].x
        recent_dy = track_history[-1].y - track_history[-2].y
        expected_direction = math.atan2(recent_dy, recent_dx)
        has_expected_direction = True
    else:
        expected_direction = -math.pi / 2  # Straight up
        has_expected_direction = False

    best_candidate = None
    best_score = 0.0

    for candidate in candidates:
        dx = candidate.x - prev.x
        dy = candidate.y - prev.y
        distance = math.sqrt(dx**2 + dy**2)

        # Distance sanity check (very permissive)
        if distance < MIN_MOVEMENT or distance > MAX_MOVEMENT:
            continue

        # Must be moving upward (dy < 0 in screen coords)
        if dy >= 0:
            continue

        # Check upward ratio
        upward_component = abs(dy)
        horizontal_component = abs(dx)
        total = upward_component + horizontal_component
        upward_ratio = upward_component / total if total > 0 else 0

        if upward_ratio < MIN_UPWARD_RATIO:
            continue

        # Calculate actual direction
        actual_direction = math.atan2(dy, dx)

        # Direction consistency score
        if has_expected_direction:
            direction_diff = abs(actual_direction - expected_direction)
            direction_diff = min(direction_diff, 2 * math.pi - direction_diff)
            # Allow up to ~30° deviation
            direction_score = max(0.0, 1.0 - direction_diff / (math.pi / 6))
        else:
            # No history - reward upward movement
            direction_diff = abs(actual_direction - (-math.pi / 2))
            direction_score = max(0.0, 1.0 - direction_diff / (math.pi / 3))

        # Color consistency score
        color_score = candidate.color_score

        # Combined score: direction matters most
        combined_score = 0.6 * direction_score + 0.4 * color_score

        if combined_score > best_score:
            best_score = combined_score
            best_candidate = candidate

    return best_candidate if best_score > 0.3 else None


def validate_track_velocity(track: List[DetectionCandidate]) -> bool:
    """
    Validate that velocity changes are physically plausible.

    Ball should generally decelerate and not change direction suddenly.

    Args:
        track: List of detections to validate

    Returns:
        True if track is plausible, False otherwise
    """
    if len(track) < 3:
        return True  # Not enough data to validate

    velocities = []
    directions = []

    for i in range(1, len(track)):
        dx = track[i].x - track[i - 1].x
        dy = track[i].y - track[i - 1].y

        velocity = math.sqrt(dx**2 + dy**2)
        direction = math.atan2(dy, dx)

        velocities.append(velocity)
        directions.append(direction)

    # Check 1: Ball shouldn't speed up repeatedly
    velocity_increases = 0
    for i in range(1, len(velocities)):
        if velocities[i] > velocities[i - 1] * 1.3:  # 30% tolerance
            velocity_increases += 1

    if velocity_increases > len(velocities) // 2:
        return False

    # Check 2: Direction should be consistent
    for i in range(1, len(directions)):
        direction_change = abs(directions[i] - directions[i - 1])
        direction_change = min(direction_change, 2 * math.pi - direction_change)

        if direction_change > MAX_DIRECTION_CHANGE:
            return False

    return True


class EarlyBallTracker:
    """
    Detects ball in the first 0.5 seconds after impact.

    Uses layered detection:
    1. Physics-guided search cones
    2. Color family matching
    3. Multi-frame validation
    """

    # Detection parameters
    DETECTION_WINDOW_SEC = 0.5
    MIN_REQUIRED_DETECTIONS = 5
    DIFF_THRESHOLD = 15
    MIN_CONTOUR_AREA = 5
    MAX_CONTOUR_AREA = 500

    def __init__(
        self,
        video_path: Path,
        origin_x: float,
        origin_y: float,
        strike_time: float,
        frame_width: int,
        frame_height: int,
        fps: float = 60.0,
    ):
        """
        Initialize the early ball tracker.

        Args:
            video_path: Path to video file
            origin_x: Ball origin X (pixels)
            origin_y: Ball origin Y (pixels)
            strike_time: When ball was struck (seconds)
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels
            fps: Video frame rate
        """
        self.video_path = video_path
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.strike_time = strike_time
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.fps = fps

        self.color_template: Optional[ColorTemplate] = None
        self.validated_track: Optional[ValidatedTrack] = None

    def detect(
        self,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> List[EarlyDetection]:
        """
        Run detection pipeline without constraints.

        Returns:
            List of validated ball detections
        """
        return self.detect_with_constraints(
            apex=None,
            landing=None,
            shot_shape="straight",
            starting_line="center",
            shot_height="medium",
            flight_time=3.0,
            progress_callback=progress_callback,
        )

    def detect_with_constraints(
        self,
        apex: Optional[Tuple[float, float]],
        landing: Optional[Tuple[float, float]],
        shot_shape: str,
        starting_line: str,
        shot_height: str,
        flight_time: float,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> List[EarlyDetection]:
        """
        Run detection pipeline with user-provided constraints.

        Args:
            apex: Apex point (x, y) normalized, or None
            landing: Landing point (x, y) normalized, or None
            shot_shape: "hook", "draw", "straight", "fade", "slice"
            starting_line: "left", "center", "right"
            shot_height: "low", "medium", "high"
            flight_time: Expected flight duration
            progress_callback: Called with (percent, message)

        Returns:
            List of validated ball detections
        """
        def emit_progress(percent: int, message: str):
            if progress_callback:
                progress_callback(percent, message)

        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {self.video_path}")
            return []

        try:
            emit_progress(5, "Extracting ball color template...")

            # Step 1: Extract color template
            self.color_template = self._extract_color_template(cap)
            if not self.color_template:
                logger.warning("Failed to extract color template")
                # Continue anyway with motion-only detection

            emit_progress(15, "Running detection passes...")

            # Step 2: Progressive expansion detection
            expansion = SearchExpansionStrategy(
                origin=(self.origin_x / self.frame_width,
                        self.origin_y / self.frame_height),
                frame_width=self.frame_width,
                frame_height=self.frame_height,
            )

            best_detections: List[EarlyDetection] = []
            best_confidence = 0.0
            expansion_level_used = 0

            for level in range(4):
                level_name = SearchExpansionStrategy.EXPANSION_LEVELS[level].name
                emit_progress(20 + level * 15, f"Detection pass {level + 1}/4 ({level_name})...")

                candidates_by_frame = self._detect_all_frames(
                    cap=cap,
                    expansion=expansion,
                    level=level,
                    apex=apex,
                    landing=landing,
                    shot_shape=shot_shape,
                    starting_line=starting_line,
                    shot_height=shot_height,
                    flight_time=flight_time,
                )

                tracks = self._validate_tracks(candidates_by_frame)

                if tracks:
                    best_track = max(tracks, key=lambda t: t.confidence)
                    detections = self._track_to_detections(best_track)

                    logger.info(
                        f"Level {level} ({level_name}): {len(detections)} detections, "
                        f"confidence={best_track.confidence:.2f}"
                    )

                    if len(detections) >= self.MIN_REQUIRED_DETECTIONS:
                        self.validated_track = best_track
                        expansion_level_used = level
                        emit_progress(90, f"Found {len(detections)} detections")
                        return detections

                    if best_track.confidence > best_confidence:
                        best_detections = detections
                        best_confidence = best_track.confidence
                        expansion_level_used = level

            emit_progress(95, "Finalizing results...")

            if best_detections:
                logger.info(
                    f"Best result: {len(best_detections)} detections at level {expansion_level_used}"
                )

            return best_detections

        finally:
            cap.release()

    def _extract_color_template(self, cap: cv2.VideoCapture) -> Optional[ColorTemplate]:
        """Extract ball color from frame 0.5s before strike."""
        template_time = self.strike_time - 0.5
        if template_time < 0:
            template_time = 0

        frame_idx = int(template_time * self.fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

        ret, frame = cap.read()
        if not ret:
            logger.warning("Could not read template frame")
            return None

        return extract_color_template(
            frame,
            int(self.origin_x),
            int(self.origin_y),
        )

    def _detect_all_frames(
        self,
        cap: cv2.VideoCapture,
        expansion: SearchExpansionStrategy,
        level: int,
        apex: Optional[Tuple[float, float]],
        landing: Optional[Tuple[float, float]],
        shot_shape: str,
        starting_line: str,
        shot_height: str,
        flight_time: float,
    ) -> Dict[int, List[DetectionCandidate]]:
        """Detect candidates in all frames at given expansion level."""
        candidates_by_frame: Dict[int, List[DetectionCandidate]] = {}

        start_frame = int(self.strike_time * self.fps)
        end_frame = int((self.strike_time + self.DETECTION_WINDOW_SEC) * self.fps)

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        prev_gray = None

        for frame_idx in range(start_frame, end_frame):
            ret, frame = cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            elapsed = (frame_idx - start_frame) / self.fps
            rel_frame = frame_idx - start_frame

            # Get base search region
            if landing:
                base_region = calculate_refined_search_corridor(
                    origin=(self.origin_x / self.frame_width,
                            self.origin_y / self.frame_height),
                    apex=apex,
                    landing=landing,
                    shot_shape=shot_shape,
                    starting_line=starting_line,
                    shot_height=shot_height,
                    elapsed_sec=elapsed,
                    total_flight_time=flight_time,
                    frame_width=self.frame_width,
                    frame_height=self.frame_height,
                )
            else:
                # Default cone-based region
                base_region = self._get_default_search_region(elapsed)

            # Expand based on level
            search_region = expansion.get_search_region(level, elapsed, base_region)

            # Detect in this region
            frame_candidates = self._detect_in_frame(
                gray, hsv, prev_gray, search_region, elapsed, rel_frame
            )

            if frame_candidates:
                candidates_by_frame[rel_frame] = frame_candidates

            prev_gray = gray.copy()

        return candidates_by_frame

    def _get_default_search_region(self, elapsed: float) -> Tuple[int, int, int, int]:
        """Get default cone-based search region."""
        # Expand with time
        half_width = int(40 + elapsed * 120)
        height_above = int(50 + elapsed * 500)

        return (
            max(0, int(self.origin_x) - half_width),
            max(0, int(self.origin_y) - height_above),
            min(self.frame_width, int(self.origin_x) + half_width),
            min(self.frame_height, int(self.origin_y) + 50),
        )

    def _detect_in_frame(
        self,
        gray: np.ndarray,
        hsv: np.ndarray,
        prev_gray: Optional[np.ndarray],
        search_region: Tuple[int, int, int, int],
        elapsed: float,
        frame_idx: int,
    ) -> List[DetectionCandidate]:
        """Detect ball candidates in a single frame."""
        candidates = []
        x1, y1, x2, y2 = search_region

        # Motion detection
        if prev_gray is not None:
            diff = cv2.absdiff(prev_gray, gray)
            _, thresh = cv2.threshold(diff, self.DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)

            # Apply search region mask
            mask = np.zeros_like(thresh)
            mask[y1:y2, x1:x2] = 255
            thresh = cv2.bitwise_and(thresh, mask)

            # Morphological cleanup
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

            # Find contours
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            for contour in contours:
                area = cv2.contourArea(contour)
                if self.MIN_CONTOUR_AREA <= area <= self.MAX_CONTOUR_AREA:
                    M = cv2.moments(contour)
                    if M["m00"] > 0:
                        cx = M["m10"] / M["m00"]
                        cy = M["m01"] / M["m00"]

                        # Color score
                        color_score = 0.5  # Default if no template
                        if self.color_template:
                            pixel_hsv = hsv[int(cy), int(cx)]
                            color_score = compute_color_match_score(
                                tuple(pixel_hsv),
                                self.color_template,
                                elapsed,
                            )

                        # Motion score based on brightness change
                        motion_score = min(1.0, area / 100)

                        candidates.append(DetectionCandidate(
                            frame_idx=frame_idx,
                            x=cx,
                            y=cy,
                            color_score=color_score,
                            motion_score=motion_score,
                        ))

        return candidates

    def _validate_tracks(
        self,
        candidates_by_frame: Dict[int, List[DetectionCandidate]],
    ) -> List[ValidatedTrack]:
        """Validate and link detections into tracks."""
        tracks = []

        for start_frame in sorted(candidates_by_frame.keys()):
            for start_candidate in candidates_by_frame[start_frame]:
                track = [start_candidate]

                # Try to extend track
                for next_frame in range(start_frame + 1, start_frame + 20):
                    if next_frame not in candidates_by_frame:
                        continue

                    best_match = find_best_continuation(
                        track[-1],
                        candidates_by_frame[next_frame],
                        track,
                    )

                    if best_match:
                        track.append(best_match)

                # Validate track
                if len(track) >= 3 and validate_track_velocity(track):
                    confidence = self._compute_track_confidence(track)
                    if confidence > 0.3:
                        tracks.append(ValidatedTrack(
                            detections=track,
                            confidence=confidence,
                        ))

        # Return non-overlapping tracks with best confidence
        return self._select_best_tracks(tracks)

    def _compute_track_confidence(self, track: List[DetectionCandidate]) -> float:
        """Compute confidence score for a track."""
        scores = []

        # Length score
        length_score = min(1.0, len(track) / 10.0)
        scores.append(length_score * 0.3)

        # Direction consistency
        directions = []
        for i in range(1, len(track)):
            dy = track[i].y - track[i - 1].y
            directions.append(dy < 0)

        direction_score = sum(directions) / len(directions) if directions else 0
        scores.append(direction_score * 0.3)

        # Color score average
        avg_color = np.mean([d.color_score for d in track])
        scores.append(avg_color * 0.4)

        return sum(scores)

    def _select_best_tracks(self, tracks: List[ValidatedTrack]) -> List[ValidatedTrack]:
        """Select non-overlapping tracks with best confidence."""
        if not tracks:
            return []

        # Sort by confidence
        tracks.sort(key=lambda t: t.confidence, reverse=True)

        selected = []
        used_frames = set()

        for track in tracks:
            track_frames = {d.frame_idx for d in track.detections}
            if not track_frames.intersection(used_frames):
                selected.append(track)
                used_frames.update(track_frames)

        return selected

    def _track_to_detections(self, track: ValidatedTrack) -> List[EarlyDetection]:
        """Convert validated track to list of EarlyDetection objects."""
        detections = []

        for det in track.detections:
            timestamp = self.strike_time + (det.frame_idx / self.fps)
            detections.append(EarlyDetection(
                timestamp=timestamp,
                x=det.x,
                y=det.y,
                confidence=det.color_score * 0.5 + det.motion_score * 0.5,
                color_score=det.color_score,
                motion_score=det.motion_score,
                physics_score=det.physics_score,
            ))

        return detections
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_early_tracker.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backend/detection/early_tracker.py src/backend/tests/test_early_tracker.py
git commit -m "feat(detection): add EarlyBallTracker for first 0.5s detection

- Implement layered detection pipeline
- Add direction-based track validation (allows 10-200px movement)
- Support progressive search expansion
- Integrate color family matching and motion detection"
```

---

## Task 4: Create PointStatusTracker Component

**Files:**
- Create: `src/frontend/src/components/PointStatusTracker.tsx`

**Step 1: Create the component**

```typescript
// src/frontend/src/components/PointStatusTracker.tsx
import { useCallback } from 'react'

interface PointStatusTrackerProps {
  targetPoint: { x: number; y: number } | null
  landingPoint: { x: number; y: number } | null
  apexPoint: { x: number; y: number } | null
  markingStep: 'target' | 'landing' | 'apex' | 'configure'
  onClearPoint: (point: 'target' | 'landing' | 'apex') => void
}

type StatusState = 'active' | 'complete' | 'pending' | 'optional' | 'ready'

export function PointStatusTracker({
  targetPoint,
  landingPoint,
  apexPoint,
  markingStep,
  onClearPoint,
}: PointStatusTrackerProps) {
  const getStatus = useCallback(
    (
      point: { x: number; y: number } | null,
      step: string,
      isOptional: boolean = false
    ): StatusState => {
      if (point) return 'complete'
      if (markingStep === step) return 'active'
      if (isOptional) return 'optional'
      return 'pending'
    },
    [markingStep]
  )

  const targetStatus = getStatus(targetPoint, 'target')
  const landingStatus = getStatus(landingPoint, 'landing')
  const apexStatus = getStatus(apexPoint, 'apex', true)
  const configStatus: StatusState =
    markingStep === 'configure'
      ? 'active'
      : targetPoint && landingPoint
      ? 'ready'
      : 'pending'

  return (
    <div className="point-status-tracker">
      <StatusItem
        label="Target"
        status={targetStatus}
        icon="⊕"
        point={targetPoint}
        onClear={() => onClearPoint('target')}
      />

      <StatusConnector complete={!!targetPoint} />

      <StatusItem
        label="Landing"
        status={landingStatus}
        icon="↓"
        point={landingPoint}
        onClear={() => onClearPoint('landing')}
      />

      <StatusConnector complete={!!landingPoint} />

      <StatusItem
        label="Apex"
        status={apexStatus}
        icon="◇"
        point={apexPoint}
        isOptional
        onClear={() => onClearPoint('apex')}
      />

      <StatusConnector complete={!!landingPoint} />

      <StatusItem label="Generate" status={configStatus} icon="▶" isAction />
    </div>
  )
}

interface StatusItemProps {
  label: string
  status: StatusState
  icon: string
  point?: { x: number; y: number } | null
  isOptional?: boolean
  isAction?: boolean
  onClear?: () => void
}

function StatusItem({
  label,
  status,
  icon,
  point,
  isOptional,
  isAction,
  onClear,
}: StatusItemProps) {
  return (
    <div className={`status-item status-${status}`}>
      <div className="status-icon">{status === 'complete' ? '✓' : icon}</div>
      <div className="status-label">
        {label}
        {isOptional && <span className="optional-tag">optional</span>}
      </div>
      {point && onClear && !isAction && (
        <button
          className="status-clear"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          title={`Clear ${label.toLowerCase()}`}
        >
          ×
        </button>
      )}
    </div>
  )
}

function StatusConnector({ complete }: { complete: boolean }) {
  return (
    <div className={`status-connector ${complete ? 'complete' : ''}`}>
      <div className="connector-line" />
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/frontend/src/components/PointStatusTracker.tsx
git commit -m "feat(ui): add PointStatusTracker component

- Show visual progress for target, landing, apex marking
- Support active, complete, pending, optional states
- Add clear buttons for marked points
- Animated pulse on active step"
```

---

## Task 5: Add CSS for PointStatusTracker

**Files:**
- Modify: `src/frontend/src/styles/global.css`

**Step 1: Add CSS at end of file**

```css
/* ============================================
   Point Status Tracker
   ============================================ */

.point-status-tracker {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: var(--border-radius);
  margin-bottom: 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-radius: 6px;
  position: relative;
  min-width: 70px;
  transition: all var(--transition-fast);
}

.status-item.status-active {
  background: rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
}

.status-item.status-complete {
  background: rgba(34, 197, 94, 0.2);
}

.status-item.status-pending {
  opacity: 0.5;
}

.status-item.status-optional {
  opacity: 0.6;
}

.status-item.status-ready {
  background: rgba(34, 197, 94, 0.3);
}

.status-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border: 2px solid currentColor;
  transition: all var(--transition-fast);
}

.status-complete .status-icon {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-bg);
}

.status-active .status-icon {
  border-color: #3b82f6;
  color: #3b82f6;
  animation: status-pulse 1.5s infinite;
}

@keyframes status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(59, 130, 246, 0);
  }
}

.status-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: center;
}

.optional-tag {
  display: block;
  font-size: 9px;
  color: var(--color-text-muted);
  font-weight: normal;
  text-transform: lowercase;
}

.status-clear {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: rgba(239, 68, 68, 0.8);
  color: white;
  font-size: 10px;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.status-item:hover .status-clear {
  opacity: 1;
}

.status-connector {
  width: 24px;
  height: 2px;
  position: relative;
}

.connector-line {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-bg-tertiary);
  transform: translateY(-50%);
  transition: background var(--transition-fast);
}

.status-connector.complete .connector-line {
  background: var(--color-primary);
}
```

**Step 2: Commit**

```bash
git add src/frontend/src/styles/global.css
git commit -m "style: add CSS for PointStatusTracker component

- Status states: active, complete, pending, optional, ready
- Animated pulse for active state
- Clear button appears on hover
- Connected line shows progress"
```

---

## Task 6: Update ClipReview with Apex Marking and Status Tracker

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`

**Step 1: Add imports and apex state**

At the top of the file, add import:
```typescript
import { PointStatusTracker } from './PointStatusTracker'
```

**Step 2: Add apex state (after line 68)**

Add new state variable after `targetPoint`:
```typescript
// Apex point marking state (optional)
const [apexPoint, setApexPoint] = useState<{x: number, y: number} | null>(null)
```

**Step 3: Update MarkingStep type (around line 71)**

Change:
```typescript
type MarkingStep = 'target' | 'landing' | 'configure'
```
To:
```typescript
type MarkingStep = 'target' | 'landing' | 'apex' | 'configure'
```

**Step 4: Update reset effect (around line 110-122)**

Add `setApexPoint(null)` to the reset effect.

**Step 5: Update handleCanvasClick (around line 572-583)**

Change to include apex step:
```typescript
const handleCanvasClick = useCallback((x: number, y: number) => {
  if (loadingState === 'loading' || trajectoryProgress !== null) return

  if (markingStep === 'target') {
    setTargetPoint({ x, y })
    setMarkingStep('landing')
  } else if (markingStep === 'landing') {
    setLandingPoint({ x, y })
    setMarkingStep('apex')
  } else if (markingStep === 'apex') {
    setApexPoint({ x, y })
    setMarkingStep('configure')
  }
}, [loadingState, trajectoryProgress, markingStep])
```

**Step 6: Update clearMarking (around line 601-615)**

Add `setApexPoint(null)`:
```typescript
const clearMarking = useCallback(() => {
  if (eventSourceRef.current) {
    eventSourceRef.current.close()
    eventSourceRef.current = null
  }

  setTargetPoint(null)
  setLandingPoint(null)
  setApexPoint(null)
  setMarkingStep('target')
  setTrajectory(null)
  setTrajectoryProgress(null)
  setTrajectoryMessage('')
  setDetectionWarnings([])
  setTrajectoryError(null)
}, [])
```

**Step 7: Add handleClearPoint function (after clearMarking)**

```typescript
const handleClearPoint = useCallback((point: 'target' | 'landing' | 'apex') => {
  if (point === 'target') {
    setTargetPoint(null)
    setLandingPoint(null)
    setApexPoint(null)
    setMarkingStep('target')
  } else if (point === 'landing') {
    setLandingPoint(null)
    setApexPoint(null)
    setMarkingStep('landing')
  } else if (point === 'apex') {
    setApexPoint(null)
    if (markingStep === 'configure') {
      // Stay in configure - user can re-mark apex
    } else {
      setMarkingStep('apex')
    }
  }
  setTrajectory(null)
}, [markingStep])
```

**Step 8: Update generateTrajectoryWithConfig (around line 504-570)**

Add apex parameters:
```typescript
const params = new URLSearchParams({
  landing_x: landingX.toString(),
  landing_y: landingY.toString(),
  target_x: targetPoint.x.toString(),
  target_y: targetPoint.y.toString(),
  starting_line: startingLine,
  shot_shape: shotShape,
  shot_height: shotHeight,
  flight_time: flightTime.toString(),
  ...(apexPoint && {
    apex_x: apexPoint.x.toString(),
    apex_y: apexPoint.y.toString(),
  }),
})
```

**Step 9: Update instruction banner (around line 781-804)**

Add apex step:
```typescript
{markingStep === 'apex' && (
  <>
    <span className="step-badge">Step 3</span>
    <span>Click the highest point of ball flight (optional)</span>
    <button
      className="btn-skip-inline"
      onClick={() => setMarkingStep('configure')}
    >
      Skip
    </button>
    <button className="btn-reset-inline" onClick={clearMarking}>
      Reset
    </button>
  </>
)}
{markingStep === 'configure' && (
  <>
    <span className="step-badge">Step 4</span>
    <span>Select trajectory settings and click Generate</span>
  </>
)}
```

**Step 10: Add PointStatusTracker to JSX (after marking-instruction div)**

```typescript
<PointStatusTracker
  targetPoint={targetPoint}
  landingPoint={landingPoint}
  apexPoint={apexPoint}
  markingStep={markingStep}
  onClearPoint={handleClearPoint}
/>
```

**Step 11: Update TrajectoryEditor props (around line 910-927)**

Add apexPoint prop:
```typescript
<TrajectoryEditor
  videoRef={videoRef}
  trajectory={trajectory}
  currentTime={currentTime}
  showTracer={showTracer}
  disabled={trajectoryProgress !== null}
  landingPoint={landingPoint}
  targetPoint={targetPoint}
  apexPoint={apexPoint}
  onCanvasClick={handleCanvasClick}
  onTrajectoryUpdate={(points) => {
    // ... existing code
  }}
/>
```

**Step 12: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat(ui): add apex marking and status tracker to ClipReview

- Add optional apex marking as step 3
- Integrate PointStatusTracker component
- Add skip button for apex step
- Pass apex point to trajectory generation API
- Update clear/reset logic for all three points"
```

---

## Task 7: Update TrajectoryEditor to Render Apex Marker

**Files:**
- Modify: `src/frontend/src/components/TrajectoryEditor.tsx`

**Step 1: Add apexPoint to props interface (around line 23)**

```typescript
apexPoint?: { x: number; y: number } | null
```

**Step 2: Add apexPoint to destructured props (around line 44)**

```typescript
apexPoint,
```

**Step 3: Add apex marker rendering in the render function (after landing marker, around line 275)**

```typescript
// Draw apex marker (gold diamond)
if (apexPoint) {
  const markerX = apexPoint.x * canvasSize.width
  const markerY = apexPoint.y * canvasSize.height
  const size = 12

  ctx.save()
  ctx.shadowColor = 'rgba(255, 215, 0, 0.8)'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ffd700'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 2

  // Diamond shape
  ctx.beginPath()
  ctx.moveTo(markerX, markerY - size)
  ctx.lineTo(markerX + size, markerY)
  ctx.lineTo(markerX, markerY + size)
  ctx.lineTo(markerX - size, markerY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}
```

**Step 4: Add apexPoint to useEffect dependencies (around line 411)**

Add `apexPoint` to the dependency array.

**Step 5: Commit**

```bash
git add src/frontend/src/components/TrajectoryEditor.tsx
git commit -m "feat(ui): add apex marker rendering to TrajectoryEditor

- Add apexPoint prop
- Render gold diamond marker at apex position
- Add glow effect for visibility"
```

---

## Task 8: Update API to Accept Apex Parameter

**Files:**
- Modify: `src/backend/api/routes.py`

**Step 1: Add apex parameters to generate_trajectory_sse (around line 1293)**

Add after `flight_time` parameter:
```python
apex_x: Optional[float] = Query(None, ge=0, le=1, description="Apex X coordinate (0-1), optional"),
apex_y: Optional[float] = Query(None, ge=0, le=1, description="Apex Y coordinate (0-1), optional"),
```

**Step 2: Pass apex to trajectory generation (around line 1380)**

Update the call to `generate_configured_trajectory`:
```python
# Build apex tuple if provided
apex = (apex_x, apex_y) if apex_x is not None and apex_y is not None else None

trajectory_data = tracker.generate_configured_trajectory(
    origin=origin_point,
    target=(target_x, target_y),
    landing=(landing_x, landing_y),
    starting_line=starting_line,
    shot_shape=shot_shape,
    shot_height=shot_height,
    strike_time=strike_time,
    flight_time=flight_time,
    apex=apex,
)
```

**Step 3: Commit**

```bash
git add src/backend/api/routes.py
git commit -m "feat(api): add apex parameter to trajectory generation endpoint

- Add optional apex_x, apex_y query parameters
- Pass apex to generate_configured_trajectory"
```

---

## Task 9: Update Tracker to Support Apex-Constrained Trajectory

**Files:**
- Modify: `src/backend/detection/tracker.py`

**Step 1: Add apex parameter to generate_configured_trajectory (around line 1622)**

Update function signature:
```python
def generate_configured_trajectory(
    self,
    origin: Tuple[float, float],
    target: Tuple[float, float],
    landing: Tuple[float, float],
    starting_line: str,
    shot_shape: str,
    shot_height: str,
    strike_time: float,
    flight_time: Optional[float] = None,
    apex: Optional[Tuple[float, float]] = None,
) -> Optional[dict]:
```

**Step 2: Add apex handling at start of function (after parameter extraction)**

```python
if apex:
    return self._generate_apex_constrained_trajectory(
        origin=origin,
        apex=apex,
        landing=landing,
        strike_time=strike_time,
        flight_time=flight_time or 3.0,
    )
```

**Step 3: Add new method _generate_apex_constrained_trajectory (after generate_configured_trajectory)**

```python
def _generate_apex_constrained_trajectory(
    self,
    origin: Tuple[float, float],
    apex: Tuple[float, float],
    landing: Tuple[float, float],
    strike_time: float,
    flight_time: float,
) -> Optional[dict]:
    """
    Generate trajectory that passes through origin, apex, and landing.

    Uses two quadratic Bezier segments:
    - Segment 1: origin → apex (ascending)
    - Segment 2: apex → landing (descending)
    """
    origin_x, origin_y = origin
    apex_x, apex_y = apex
    landing_x, landing_y = landing

    # Apex timing (typically 40-50% of flight)
    apex_time_ratio = 0.45
    apex_time = flight_time * apex_time_ratio

    # Control points for smooth curve
    ctrl1_x = origin_x + (apex_x - origin_x) * 0.5
    ctrl1_y = origin_y - (origin_y - apex_y) * 0.3

    ctrl2_x = apex_x + (landing_x - apex_x) * 0.5
    ctrl2_y = apex_y + (landing_y - apex_y) * 0.3

    sample_rate = 60.0
    points = []
    apex_idx = 0
    min_y = origin_y

    # Ascending segment
    ascending_duration = apex_time
    num_ascending = int(ascending_duration * sample_rate)

    for i in range(num_ascending):
        t = i / num_ascending if num_ascending > 0 else 0

        x = (1 - t) ** 2 * origin_x + 2 * (1 - t) * t * ctrl1_x + t ** 2 * apex_x
        y = (1 - t) ** 2 * origin_y + 2 * (1 - t) * t * ctrl1_y + t ** 2 * apex_y

        if y < min_y:
            min_y = y
            apex_idx = len(points)

        points.append({
            "timestamp": strike_time + (t * ascending_duration),
            "x": max(0.0, min(1.0, x)),
            "y": max(0.0, min(1.0, y)),
            "confidence": 0.90,
            "interpolated": True,
        })

    # Descending segment
    descending_duration = flight_time - apex_time
    num_descending = int(descending_duration * sample_rate)

    for i in range(num_descending + 1):
        t = i / num_descending if num_descending > 0 else 0

        x = (1 - t) ** 2 * apex_x + 2 * (1 - t) * t * ctrl2_x + t ** 2 * landing_x
        y = (1 - t) ** 2 * apex_y + 2 * (1 - t) * t * ctrl2_y + t ** 2 * landing_y

        if y < min_y:
            min_y = y
            apex_idx = len(points)

        points.append({
            "timestamp": strike_time + apex_time + (t * descending_duration),
            "x": max(0.0, min(1.0, x)),
            "y": max(0.0, min(1.0, y)),
            "confidence": 0.90,
            "interpolated": True,
        })

    # Ensure exact endpoints
    if points:
        points[0]["x"], points[0]["y"] = origin_x, origin_y
        points[-1]["x"], points[-1]["y"] = landing_x, landing_y

    if len(points) < 2:
        return None

    logger.info(
        f"Generated apex-constrained trajectory: {len(points)} points, "
        f"apex=({apex_x:.3f}, {apex_y:.3f})"
    )

    return {
        "points": points,
        "apex_point": {
            "timestamp": strike_time + apex_time,
            "x": apex_x,
            "y": apex_y,
        },
        "landing_point": {
            "timestamp": strike_time + flight_time,
            "x": landing_x,
            "y": landing_y,
        },
        "confidence": 0.90,
        "method": "apex_constrained",
        "flight_duration": flight_time,
    }
```

**Step 4: Commit**

```bash
git add src/backend/detection/tracker.py
git commit -m "feat(detection): add apex-constrained trajectory generation

- Add apex parameter to generate_configured_trajectory
- Implement _generate_apex_constrained_trajectory using two Bezier segments
- Trajectory passes exactly through user-marked apex point"
```

---

## Task 10: Integration Test

**Files:**
- Create: `src/backend/tests/test_early_detection_integration.py`

**Step 1: Write integration test**

```python
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
```

**Step 2: Run tests**

Run: `cd /Users/ecoon/golf-clip/src/backend && python -m pytest tests/test_early_detection_integration.py -v`
Expected: PASS

**Step 3: Commit**

```bash
git add src/backend/tests/test_early_detection_integration.py
git commit -m "test: add integration tests for early detection and apex trajectory

- Test progressive expansion coverage
- Test apex-constrained trajectory passes through apex point"
```

---

## Summary

This plan implements:

1. **Color Family Module** - HSV-based ball color detection supporting white, orange, yellow, pink, green balls
2. **Search Expansion Module** - Progressive expansion from tight corridor to 1/3 frame width
3. **Early Ball Tracker** - 0.5s detection window with layered detection (physics + color + validation)
4. **PointStatusTracker Component** - Visual progress indicator for marking flow
5. **Apex Marking** - Optional step 3 in marking flow
6. **API Updates** - Accept apex parameter in trajectory generation
7. **Apex-Constrained Trajectory** - Two-segment Bezier curve through user-marked apex

Total: 10 tasks, ~40 commits

---

Plan complete and saved to `docs/plans/2026-01-25-early-ball-detection-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
