"""Ball template extraction for tracking.

Extracts a template image of the golf ball from early frames after impact
to use for subsequent template matching during flight tracking.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


@dataclass
class BallTemplate:
    """Template of the golf ball extracted from video.

    Contains the ball image, mask, and properties needed for template matching.
    """

    image: np.ndarray  # BGR image of the ball region
    mask: np.ndarray  # Binary mask of the ball
    center: Tuple[int, int]  # Center position in the original frame
    radius: int  # Estimated radius in pixels
    brightness: float  # Average brightness of the ball
    frame_index: int  # Which frame this template was extracted from
    confidence: float  # Confidence score (0-1)


class BallTemplateExtractor:
    """Extracts ball template from early frames after impact.

    Uses motion differencing between consecutive frames to detect the ball,
    then applies brightness, size, and circularity filters to select the best
    candidate.

    The template can be used for template matching in subsequent frames
    where motion detection becomes unreliable.
    """

    # Default parameters for ball detection
    DEFAULT_MIN_BRIGHTNESS = 100  # Golf balls are white/bright
    DEFAULT_MIN_RADIUS = 8  # Minimum ball radius in pixels
    DEFAULT_MAX_RADIUS = 30  # Maximum ball radius in pixels
    DEFAULT_MIN_CIRCULARITY = 0.7  # Minimum circularity (1.0 = perfect circle)
    DEFAULT_DIFF_THRESHOLD = 15  # Motion detection threshold

    def __init__(
        self,
        min_brightness: float = DEFAULT_MIN_BRIGHTNESS,
        min_radius: int = DEFAULT_MIN_RADIUS,
        max_radius: int = DEFAULT_MAX_RADIUS,
        min_circularity: float = DEFAULT_MIN_CIRCULARITY,
        diff_threshold: int = DEFAULT_DIFF_THRESHOLD,
    ):
        """Initialize the template extractor.

        Args:
            min_brightness: Minimum average brightness for valid ball candidate
            min_radius: Minimum ball radius in pixels
            max_radius: Maximum ball radius in pixels
            min_circularity: Minimum circularity score (0-1)
            diff_threshold: Threshold for frame differencing
        """
        self.min_brightness = min_brightness
        self.min_radius = min_radius
        self.max_radius = max_radius
        self.min_circularity = min_circularity
        self.diff_threshold = diff_threshold

    def extract_template(
        self,
        video_path: Path,
        origin_x: float,
        origin_y: float,
        strike_time: float,
        search_frames: int = 6,
    ) -> Optional[BallTemplate]:
        """Extract ball template from video frames after strike.

        Args:
            video_path: Path to video file
            origin_x: X coordinate of ball origin (where ball starts)
            origin_y: Y coordinate of ball origin
            strike_time: Timestamp of ball strike (seconds)
            search_frames: Number of frames after strike to search

        Returns:
            BallTemplate if ball found, None otherwise
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0:
                logger.error("Invalid FPS in video")
                return None

            # Seek to strike frame
            start_frame = int(strike_time * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            # Read frames
            frames = []
            for i in range(search_frames + 1):  # +1 because we need pairs
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)

            if len(frames) < 2:
                logger.warning("Not enough frames to extract template")
                return None

            # Max distance the ball can travel in search_frames
            # Assuming ~500 px/s initial velocity at 60fps
            max_distance = (search_frames / fps) * 500 if fps > 0 else 100

            return self._extract_from_frames(
                frames, origin_x, origin_y, max_distance
            )

        finally:
            cap.release()

    def _extract_from_frames(
        self,
        frames: List[np.ndarray],
        origin_x: float,
        origin_y: float,
        max_distance: float,
    ) -> Optional[BallTemplate]:
        """Extract ball template from a list of frames.

        Uses motion differencing between consecutive frames to find moving
        objects, then applies filtering to find the ball.

        Args:
            frames: List of BGR frames
            origin_x: X coordinate of ball origin
            origin_y: Y coordinate of ball origin
            max_distance: Maximum distance from origin to search

        Returns:
            BallTemplate if ball found, None otherwise
        """
        if len(frames) < 2:
            return None

        best_template: Optional[BallTemplate] = None
        best_confidence = 0.0

        for i in range(len(frames) - 1):
            prev_gray = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)
            curr_gray = cv2.cvtColor(frames[i + 1], cv2.COLOR_BGR2GRAY)

            candidates = self._find_ball_candidates(
                prev_gray, curr_gray, origin_x, origin_y, max_distance
            )

            for candidate in candidates:
                template = self._create_template(
                    frames[i + 1], candidate, i + 1
                )
                if template and template.confidence > best_confidence:
                    best_template = template
                    best_confidence = template.confidence

        return best_template

    def _find_ball_candidates(
        self,
        prev_gray: np.ndarray,
        curr_gray: np.ndarray,
        origin_x: float,
        origin_y: float,
        max_distance: float,
    ) -> List[dict]:
        """Find ball candidates using frame differencing.

        Args:
            prev_gray: Previous frame (grayscale)
            curr_gray: Current frame (grayscale)
            origin_x: X coordinate of ball origin
            origin_y: Y coordinate of ball origin
            max_distance: Maximum distance from origin to search

        Returns:
            List of candidate dictionaries with position and properties
        """
        # Frame differencing
        diff = cv2.absdiff(prev_gray, curr_gray)

        # Threshold
        _, thresh = cv2.threshold(
            diff, self.diff_threshold, 255, cv2.THRESH_BINARY
        )

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(
            thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        candidates = []
        for contour in contours:
            # Calculate contour properties
            area = cv2.contourArea(contour)
            if area < 5:  # Skip very tiny contours
                continue

            # Get bounding circle
            (cx, cy), radius = cv2.minEnclosingCircle(contour)

            # Check distance from origin
            dist = np.sqrt((cx - origin_x) ** 2 + (cy - origin_y) ** 2)
            if dist > max_distance:
                continue

            # Check size constraints
            if radius < self.min_radius or radius > self.max_radius:
                continue

            # Calculate circularity
            circularity = self._calculate_circularity(contour)
            if circularity < self.min_circularity:
                continue

            # Get brightness at the contour location
            mask = np.zeros_like(curr_gray)
            cv2.drawContours(mask, [contour], -1, 255, -1)
            brightness = cv2.mean(curr_gray, mask=mask)[0]

            # Check brightness constraint
            if brightness < self.min_brightness:
                continue

            candidates.append({
                "x": int(cx),
                "y": int(cy),
                "radius": int(radius),
                "circularity": circularity,
                "brightness": brightness,
                "contour": contour,
                "distance": dist,
            })

        # Sort by confidence (combination of circularity and brightness)
        candidates.sort(
            key=lambda c: c["circularity"] * 0.5 + (c["brightness"] / 255) * 0.5,
            reverse=True,
        )

        return candidates

    def _calculate_circularity(self, contour: np.ndarray) -> float:
        """Calculate circularity of a contour.

        Circularity = 4 * pi * Area / Perimeter^2

        A perfect circle has circularity = 1.0

        Args:
            contour: OpenCV contour

        Returns:
            Circularity score between 0 and 1
        """
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)

        if perimeter == 0:
            return 0.0

        circularity = 4 * np.pi * area / (perimeter ** 2)

        # Clamp to [0, 1] range (can exceed 1 due to approximation errors)
        return min(max(circularity, 0.0), 1.0)

    def _create_template(
        self,
        frame: np.ndarray,
        candidate: dict,
        frame_index: int,
    ) -> Optional[BallTemplate]:
        """Create a BallTemplate from a candidate detection.

        Args:
            frame: BGR frame
            candidate: Candidate dictionary from _find_ball_candidates
            frame_index: Index of this frame in the sequence

        Returns:
            BallTemplate or None if extraction fails
        """
        cx = candidate["x"]
        cy = candidate["y"]
        radius = candidate["radius"]

        # Add padding around the ball for template matching
        padding = max(5, radius // 2)
        template_radius = radius + padding

        # Extract region around the ball
        frame_height, frame_width = frame.shape[:2]
        x1 = max(0, cx - template_radius)
        y1 = max(0, cy - template_radius)
        x2 = min(frame_width, cx + template_radius)
        y2 = min(frame_height, cy + template_radius)

        if x2 - x1 < 10 or y2 - y1 < 10:
            return None

        image = frame[y1:y2, x1:x2].copy()

        # Create circular mask
        mask_size = (y2 - y1, x2 - x1)
        mask = np.zeros(mask_size, dtype=np.uint8)
        mask_center = (cx - x1, cy - y1)
        cv2.circle(mask, mask_center, radius, 255, -1)

        # Calculate confidence based on circularity and brightness
        confidence = (
            candidate["circularity"] * 0.4 +
            min(candidate["brightness"] / 255, 1.0) * 0.4 +
            (1.0 - min(candidate["distance"] / 100, 1.0)) * 0.2
        )

        return BallTemplate(
            image=image,
            mask=mask,
            center=(cx, cy),
            radius=radius,
            brightness=candidate["brightness"],
            frame_index=frame_index,
            confidence=confidence,
        )
