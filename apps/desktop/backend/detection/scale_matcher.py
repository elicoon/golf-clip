"""Multi-scale template matching for ball tracking.

As the golf ball travels away from the camera, it appears smaller.
This matcher creates a scale pyramid of the ball template and searches
at multiple scales to find the ball.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


# Default parameters
MIN_SCALE = 0.3  # Ball can shrink to 30% of template size
MAX_SCALE = 1.5  # Ball might be slightly larger than template
NUM_SCALES = 8   # Number of scales in pyramid
MIN_CORRELATION = 0.6  # Minimum correlation threshold


@dataclass
class ScaleMatch:
    """Result of a template match at a specific scale."""

    x: float  # X coordinate of match center
    y: float  # Y coordinate of match center
    scale: float  # Scale factor used (1.0 = original size)
    score: float  # Match correlation score (0-1)
    radius: float  # Estimated ball radius at this scale


class MultiScaleMatcher:
    """Multi-scale template matcher for tracking golf balls.

    Creates a pyramid of scaled templates and searches the frame
    at each scale, returning the best matches.
    """

    def __init__(
        self,
        min_scale: float = MIN_SCALE,
        max_scale: float = MAX_SCALE,
        num_scales: int = NUM_SCALES,
        min_correlation: float = MIN_CORRELATION,
    ):
        """Initialize the matcher.

        Args:
            min_scale: Minimum scale factor (template shrinks to this)
            max_scale: Maximum scale factor (template grows to this)
            num_scales: Number of scales in the pyramid
            min_correlation: Minimum correlation score to accept a match
        """
        self.min_scale = min_scale
        self.max_scale = max_scale
        self.num_scales = num_scales
        self.min_correlation = min_correlation

        # Scale pyramid: list of (scale, scaled_template, scaled_mask)
        self._scale_pyramid: List[Tuple[float, np.ndarray, Optional[np.ndarray]]] = []
        self._template_radius: float = 0.0

    def prepare_template(
        self,
        template_image: np.ndarray,
        template_mask: Optional[np.ndarray] = None,
    ) -> None:
        """Prepare the scale pyramid from a template image.

        Args:
            template_image: Grayscale template image (ball)
            template_mask: Optional mask for template (same size as template)
        """
        # Ensure template is grayscale
        if len(template_image.shape) == 3:
            template_image = cv2.cvtColor(template_image, cv2.COLOR_BGR2GRAY)

        # Estimate template radius (half of smaller dimension)
        h, w = template_image.shape[:2]
        self._template_radius = min(h, w) / 2.0

        # Create scale pyramid
        self._scale_pyramid = self._create_scale_pyramid(template_image, template_mask)

        logger.debug(
            f"Prepared template pyramid: {len(self._scale_pyramid)} scales, "
            f"range [{self.min_scale:.2f}, {self.max_scale:.2f}]"
        )

    def _create_scale_pyramid(
        self,
        template: np.ndarray,
        mask: Optional[np.ndarray],
    ) -> List[Tuple[float, np.ndarray, Optional[np.ndarray]]]:
        """Create a pyramid of scaled templates.

        Args:
            template: Original grayscale template
            mask: Optional template mask

        Returns:
            List of (scale, scaled_template, scaled_mask) tuples
        """
        pyramid = []
        h, w = template.shape[:2]

        # Generate scale factors (linearly spaced)
        scales = np.linspace(self.min_scale, self.max_scale, self.num_scales)

        for scale in scales:
            # Calculate new dimensions
            new_w = max(3, int(w * scale))
            new_h = max(3, int(h * scale))

            # Resize template
            scaled_template = cv2.resize(
                template, (new_w, new_h), interpolation=cv2.INTER_LINEAR
            )

            # Resize mask if provided
            scaled_mask = None
            if mask is not None:
                scaled_mask = cv2.resize(
                    mask, (new_w, new_h), interpolation=cv2.INTER_NEAREST
                )

            pyramid.append((scale, scaled_template, scaled_mask))

        return pyramid

    def match_in_region(
        self,
        frame_gray: np.ndarray,
        search_region: Tuple[int, int, int, int],
        expected_scale: Optional[float] = None,
    ) -> List[ScaleMatch]:
        """Search for template matches within a specific region.

        Args:
            frame_gray: Grayscale frame to search
            search_region: (x1, y1, x2, y2) bounding box to search within
            expected_scale: If provided, prioritize matches near this scale

        Returns:
            List of ScaleMatch objects, sorted by score (highest first)
        """
        x1, y1, x2, y2 = search_region

        # Clamp to frame bounds
        h, w = frame_gray.shape[:2]
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)

        # Extract region
        region = frame_gray[y1:y2, x1:x2]

        if region.size == 0:
            return []

        # Match in region
        matches = self._match_in_image(region, expected_scale)

        # Adjust coordinates to full frame
        for match in matches:
            match.x += x1
            match.y += y1

        return matches

    def match_full_frame(
        self,
        frame_gray: np.ndarray,
        exclude_region: Optional[Tuple[int, int, int, int]] = None,
    ) -> List[ScaleMatch]:
        """Search for template matches in the full frame.

        Args:
            frame_gray: Grayscale frame to search
            exclude_region: Optional (x1, y1, x2, y2) region to exclude from search

        Returns:
            List of ScaleMatch objects, sorted by score (highest first)
        """
        # Ensure grayscale
        if len(frame_gray.shape) == 3:
            frame_gray = cv2.cvtColor(frame_gray, cv2.COLOR_BGR2GRAY)

        matches = self._match_in_image(frame_gray)

        # Filter out matches in excluded region
        if exclude_region is not None:
            x1, y1, x2, y2 = exclude_region
            matches = [
                m for m in matches
                if not (x1 <= m.x <= x2 and y1 <= m.y <= y2)
            ]

        return matches

    def _match_in_image(
        self,
        image: np.ndarray,
        expected_scale: Optional[float] = None,
    ) -> List[ScaleMatch]:
        """Perform multi-scale template matching on an image.

        Args:
            image: Grayscale image to search
            expected_scale: If provided, prioritize matches near this scale

        Returns:
            List of ScaleMatch objects, sorted by score (highest first)
        """
        if not self._scale_pyramid:
            logger.warning("No template prepared - call prepare_template first")
            return []

        all_matches: List[ScaleMatch] = []
        h, w = image.shape[:2]

        for scale, template, mask in self._scale_pyramid:
            th, tw = template.shape[:2]

            # Skip if template is larger than image
            if tw > w or th > h:
                continue

            # Perform template matching
            result = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)

            # Find locations above threshold
            locations = np.where(result >= self.min_correlation)

            for y, x in zip(*locations):
                score = result[y, x]

                # Adjust score if expected scale provided
                adjusted_score = score
                if expected_scale is not None:
                    scale_penalty = abs(scale - expected_scale) * 0.2
                    adjusted_score = score - scale_penalty

                # Calculate center of match (template matching gives top-left)
                center_x = x + tw / 2.0
                center_y = y + th / 2.0

                # Estimated radius at this scale
                radius = self._template_radius * scale

                all_matches.append(ScaleMatch(
                    x=center_x,
                    y=center_y,
                    scale=scale,
                    score=adjusted_score,
                    radius=radius,
                ))

        # Apply non-maximum suppression
        if all_matches:
            all_matches = self._nms(all_matches, distance_threshold=15.0)

        # Sort by score (highest first)
        all_matches.sort(key=lambda m: m.score, reverse=True)

        return all_matches

    def _nms(
        self,
        matches: List[ScaleMatch],
        distance_threshold: float,
    ) -> List[ScaleMatch]:
        """Apply non-maximum suppression to remove duplicate matches.

        Keeps the highest-scoring match when multiple matches are
        within distance_threshold of each other.

        Args:
            matches: List of matches to filter
            distance_threshold: Maximum distance between matches to consider duplicates

        Returns:
            Filtered list of matches
        """
        if not matches:
            return []

        # Sort by score (highest first)
        sorted_matches = sorted(matches, key=lambda m: m.score, reverse=True)
        kept: List[ScaleMatch] = []

        for match in sorted_matches:
            # Check if this match is too close to any kept match
            is_duplicate = False
            for kept_match in kept:
                dist = np.sqrt(
                    (match.x - kept_match.x) ** 2 +
                    (match.y - kept_match.y) ** 2
                )
                if dist < distance_threshold:
                    is_duplicate = True
                    break

            if not is_duplicate:
                kept.append(match)

        return kept
