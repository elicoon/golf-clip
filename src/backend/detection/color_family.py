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
    # Expanded thresholds to catch more white balls in varied lighting
    if saturation < 50 and value > 140:
        return ColorFamily.WHITE

    # Gray/silver ball: low saturation, medium value - treat as white family
    # Also catches white balls in shadows or motion blur
    if saturation < 60 and 70 < value <= 140:
        return ColorFamily.WHITE

    # Very bright pixels (overexposed) - likely white ball highlights
    if value > 220 and saturation < 80:
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
    # Add validation that frame is BGR (3 channels)
    if len(frame.shape) != 3 or frame.shape[2] != 3:
        logger.warning(f"Frame must be BGR with 3 channels, got shape {frame.shape}")
        return None

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
    # More aggressive widening for early frames where detection is critical
    time_factor = 1.0 + elapsed_sec * 0.8  # 1.0 → 1.4 over 0.5s

    # Base tolerances
    hue_tolerance = 25 * time_factor
    sat_tolerance = 120 * time_factor  # ~47% of 255
    val_tolerance = 140 * time_factor  # ~55% of 255

    # Special handling for white balls - MUCH more permissive
    if template.family == ColorFamily.WHITE:
        # White balls in flight can appear:
        # - Very bright (overexposed)
        # - Slightly gray (motion blur)
        # - Slightly tinted (sky reflection)
        # - Darker (shadows)

        # More permissive saturation threshold for white balls
        # Motion blur can add slight color tint
        max_sat = 80 * time_factor
        if s > max_sat:
            # Still give partial score for slightly saturated pixels
            # (could be sky reflection or motion blur)
            sat_penalty = (s - max_sat) / 100
            if sat_penalty > 0.5:
                return 0.0
            return max(0.0, 0.3 - sat_penalty)

        # Score based on value similarity with wider tolerance
        val_diff = abs(v - template.value)

        # Very bright pixels (v > 200) get bonus - likely the ball highlight
        if v > 200:
            score = 0.9
        elif v > 150:
            # Good brightness range for white ball
            score = max(0.0, 1.0 - (val_diff / (val_tolerance * 1.2)))
        else:
            # Darker - could be shadowed ball or false positive
            score = max(0.0, 0.8 - (val_diff / val_tolerance))

        # Bonus for low saturation (more "white")
        sat_score = max(0.0, 1.0 - (s / max_sat))
        score = 0.6 * score + 0.4 * sat_score

        # Minimum score floor for anything reasonably bright and unsaturated
        # This helps catch white balls that don't perfectly match template
        if v > 130 and s < 60:
            score = max(score, 0.5)

        return min(1.0, score)

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
