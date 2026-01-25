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
