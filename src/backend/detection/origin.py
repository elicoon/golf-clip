"""Ball origin detection using multiple methods.

Uses geometric constraints and multiple detection methods to reliably
find the golf ball's starting position before impact.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from loguru import logger

from backend.detection.visual import BallDetector


@dataclass
class OriginDetection:
    """Result of ball origin detection."""

    x: float  # X coordinate in pixels
    y: float  # Y coordinate in pixels
    confidence: float  # 0-1, higher = more certain
    method: str  # Which method(s) found it
    golfer_bbox: Optional[tuple[float, float, float, float]] = None  # x1,y1,x2,y2


class BallOriginDetector:
    """Detects the golf ball's starting position using multiple methods.

    Methods:
    1. YOLO person detection - find golfer, estimate ball zone near feet
    2. Hough line detection - find club shaft, follow to ball
    3. YOLO ball detection - directly detect ball in the estimated zone

    If multiple methods agree, confidence is higher.
    """

    # Ball zone parameters (relative to golfer bbox)
    BALL_ZONE_BELOW_FEET = 0.05  # Ball is slightly below feet line
    BALL_ZONE_RADIUS_RATIO = 0.15  # Search radius as ratio of person height

    # Shaft detection parameters
    SHAFT_MIN_LENGTH = 50  # Minimum line length in pixels
    SHAFT_ANGLE_TOLERANCE = 30  # Degrees from vertical to consider as shaft

    # Agreement threshold for multi-method consensus
    AGREEMENT_DISTANCE = 50  # Pixels - if detections within this, they agree

    def __init__(self, ball_detector: Optional[BallDetector] = None):
        """Initialize the origin detector.

        Args:
            ball_detector: Optional existing BallDetector instance to reuse
        """
        self.ball_detector = ball_detector or BallDetector()

    def detect_origin(
        self,
        video_path: Path,
        strike_time: float,
        look_before: float = 0.5,
    ) -> Optional[OriginDetection]:
        """Detect ball origin position before impact.

        Args:
            video_path: Path to video file
            strike_time: Timestamp of ball strike (from audio detection)
            look_before: How many seconds before strike to look for ball

        Returns:
            OriginDetection with position and confidence, or None if not found
        """
        # Get frame just before impact
        target_time = strike_time - look_before
        frame = self._get_frame_at_time(video_path, target_time)
        if frame is None:
            logger.warning(f"Could not read frame at {target_time:.2f}s")
            return None

        frame_height, frame_width = frame.shape[:2]

        # Method 1: Find golfer and estimate ball zone
        golfer_result = self._detect_golfer_zone(frame)

        # Method 2: Detect shaft and follow to ball (if golfer found)
        shaft_result = None
        if golfer_result:
            shaft_result = self._detect_shaft_endpoint(
                frame,
                golfer_result["bbox"],
                golfer_result["feet_position"][1],  # feet_y
            )

        # Method 3: YOLO ball detection in zone
        ball_result = None
        search_zone = None
        if golfer_result:
            search_zone = golfer_result["ball_zone"]
        elif shaft_result:
            # Use shaft endpoint as center of search
            search_zone = self._zone_around_point(
                shaft_result["x"], shaft_result["y"],
                radius=100, frame_width=frame_width, frame_height=frame_height
            )

        if search_zone:
            ball_result = self._detect_ball_in_zone(frame, search_zone)

        # Combine results
        return self._combine_detections(
            golfer_result, shaft_result, ball_result, frame_width, frame_height
        )

    def detect_origin_from_frame(
        self,
        frame: np.ndarray,
    ) -> Optional[OriginDetection]:
        """Detect ball origin in a single frame.

        Args:
            frame: BGR image as numpy array

        Returns:
            OriginDetection or None
        """
        frame_height, frame_width = frame.shape[:2]

        # Method 1: Find golfer
        golfer_result = self._detect_golfer_zone(frame)

        # Method 2: Shaft detection
        shaft_result = None
        if golfer_result:
            shaft_result = self._detect_shaft_endpoint(
                frame,
                golfer_result["bbox"],
                golfer_result["feet_position"][1],  # feet_y
            )

        # Method 3: Ball detection
        ball_result = None
        if golfer_result:
            ball_result = self._detect_ball_in_zone(
                frame, golfer_result["ball_zone"]
            )

        return self._combine_detections(
            golfer_result, shaft_result, ball_result, frame_width, frame_height
        )

    def _get_frame_at_time(
        self, video_path: Path, timestamp: float
    ) -> Optional[np.ndarray]:
        """Extract a single frame from video at given timestamp."""
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0:
                return None

            frame_num = int(timestamp * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)

            ret, frame = cap.read()
            return frame if ret else None
        finally:
            cap.release()

    def _detect_golfer_zone(self, frame: np.ndarray) -> Optional[dict]:
        """Detect golfer and estimate ball zone near their feet.

        Returns dict with:
            - bbox: golfer bounding box (x1, y1, x2, y2)
            - feet_position: (x, y) estimated feet center
            - ball_zone: (x1, y1, x2, y2) search region for ball
        """
        # Use existing golfer detection
        golfer = self.ball_detector.detect_golfer_in_frame(frame)
        if golfer is None:
            logger.debug("No golfer detected in frame")
            return None

        x1, y1, x2, y2 = golfer.bbox
        person_height = y2 - y1
        person_width = x2 - x1

        # Feet are at bottom center of bbox
        feet_x = golfer.feet_position[0]
        feet_y = golfer.feet_position[1]

        # Ball zone: area around and slightly in front of feet
        # Golf ball is typically 6-12 inches in front of lead foot
        zone_radius = person_height * self.BALL_ZONE_RADIUS_RATIO
        zone_offset_y = person_height * self.BALL_ZONE_BELOW_FEET

        frame_height, frame_width = frame.shape[:2]

        # Ball zone extends horizontally around feet and slightly below
        zone_x1 = max(0, feet_x - zone_radius)
        zone_x2 = min(frame_width, feet_x + zone_radius)
        zone_y1 = max(0, feet_y - zone_radius / 2)  # Less room above
        zone_y2 = min(frame_height, feet_y + zone_offset_y + zone_radius / 2)

        logger.debug(
            f"Golfer detected at ({feet_x:.0f},{feet_y:.0f}), "
            f"ball zone: ({zone_x1:.0f},{zone_y1:.0f})-({zone_x2:.0f},{zone_y2:.0f})"
        )

        return {
            "bbox": golfer.bbox,
            "feet_position": (feet_x, feet_y),
            "ball_zone": (zone_x1, zone_y1, zone_x2, zone_y2),
            "confidence": golfer.confidence,
        }

    def _detect_shaft_endpoint(
        self,
        frame: np.ndarray,
        golfer_bbox: tuple[float, float, float, float],
        feet_y: float,
    ) -> Optional[dict]:
        """Detect club shaft using Hough lines and find where it points.

        Args:
            frame: Full frame
            golfer_bbox: (x1, y1, x2, y2) golfer bounding box
            feet_y: Y coordinate of golfer's feet (bottom of bbox)

        Returns:
            Dict with x, y of shaft endpoint (likely ball position)
        """
        gx1, gy1, gx2, gy2 = [int(v) for v in golfer_bbox]
        golfer_height = gy2 - gy1
        golfer_width = gx2 - gx1
        feet_x = (gx1 + gx2) / 2  # Approximate feet x position
        frame_height, frame_width = frame.shape[:2]

        # Search region: around the golfer, extending below feet where ball/club head are
        # Start from 20% down the golfer's body to capture full shaft
        search_x1 = max(0, gx1 - golfer_width)
        search_x2 = min(frame_width, gx2 + golfer_width)
        search_y1 = max(0, int(gy1 + golfer_height * 0.2))
        search_y2 = min(frame_height, int(feet_y + golfer_height * 0.15))

        # Extract search region
        region = frame[search_y1:search_y2, search_x1:search_x2]
        if region.size == 0:
            return None

        # Convert to grayscale and detect edges
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150, apertureSize=3)

        # Detect lines using Hough transform
        # Use longer minLineLength (80) to get better shaft segments
        lines = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=np.pi / 180,
            threshold=25,
            minLineLength=80,
            maxLineGap=15,
        )

        if lines is None:
            logger.debug("No lines detected in search region")
            return None

        # Find lines that could be the club shaft
        # Key constraints based on golf swing geometry:
        # 1. Shaft is diagonal (15-55° from vertical, going top-left to bottom-right)
        # 2. Bottom of shaft is near feet level (within 60px)
        # 3. Top should be within/near golfer's body horizontally
        # 4. Bottom should be near ball zone (within golfer_width of feet_x)
        shaft_candidates = []

        for line in lines:
            lx1, ly1, lx2, ly2 = line[0]

            # Convert to frame coordinates
            fx1, fy1 = search_x1 + lx1, search_y1 + ly1
            fx2, fy2 = search_x1 + lx2, search_y1 + ly2

            # Identify top and bottom endpoints (top = higher = smaller y)
            if fy1 > fy2:
                bottom_x, bottom_y = fx1, fy1
                top_x, top_y = fx2, fy2
            else:
                bottom_x, bottom_y = fx2, fy2
                top_x, top_y = fx1, fy1

            # Calculate line properties
            dx = fx2 - fx1
            dy = fy2 - fy1
            length = np.sqrt(dx ** 2 + dy ** 2)

            if length < 80:
                continue

            # Angle from vertical (in degrees)
            angle_from_vertical = abs(90 - abs(np.degrees(np.arctan2(dy, dx))))

            # Constraint 1: Must be diagonal (15-55° from vertical)
            if not (15 <= angle_from_vertical <= 55):
                continue

            # Constraint 2: Must go from top-left to bottom-right
            if top_x >= bottom_x:
                continue

            # Constraint 3: Bottom must be near feet level (within 60px)
            if abs(bottom_y - feet_y) > 60:
                continue

            # Constraint 4: Top should be within/near golfer's horizontal range
            horizontal_margin = golfer_width * 0.4
            if not (gx1 - horizontal_margin <= top_x <= gx2 + horizontal_margin):
                continue

            # Constraint 5: Bottom should be reachable from golfer (within 1.5x golfer_width)
            # Club head can extend quite far from body center, especially for right-handed golfers
            if abs(bottom_x - feet_x) > golfer_width * 1.5:
                continue

            vertical_extent = bottom_y - top_y
            shaft_candidates.append({
                "x": bottom_x,
                "y": bottom_y,
                "top_x": top_x,
                "top_y": top_y,
                "length": length,
                "angle": angle_from_vertical,
                "vertical_extent": vertical_extent,
            })

        if not shaft_candidates:
            logger.debug("No shaft-like lines found matching constraints")
            return None

        logger.debug(f"Found {len(shaft_candidates)} shaft candidates after filtering")

        # Pick the best shaft candidate - prefer longest line
        best = max(shaft_candidates, key=lambda s: s["length"])

        # Find the ball position relative to the shaft endpoint
        # The club head extends to the RIGHT of the shaft end (perpendicular),
        # and the ball sits just behind the club head
        # For a right-handed golfer: shaft bottom → club head is to the right
        clubhead_offset_x = 50  # Club head extends ~50px to the right of shaft end
        clubhead_offset_y = 20  # Slightly down (toward ground level)

        clubhead_x = best["x"] + clubhead_offset_x
        clubhead_y = best["y"] + clubhead_offset_y

        logger.debug(
            f"Shaft detected: bottom at ({best['x']:.0f},{best['y']:.0f}), "
            f"top at ({best['top_x']:.0f},{best['top_y']:.0f}), "
            f"length={best['length']:.0f}px, angle={best['angle']:.1f}°, "
            f"extended to clubhead at ({clubhead_x:.0f},{clubhead_y:.0f})"
        )

        return {
            **best,
            "x": clubhead_x,  # Override with extended position
            "y": clubhead_y,
            "shaft_bottom_x": best["x"],  # Keep original for reference
            "shaft_bottom_y": best["y"],
        }

    def _detect_ball_in_zone(
        self, frame: np.ndarray, zone: tuple[float, float, float, float]
    ) -> Optional[dict]:
        """Use YOLO to detect ball in a specific zone.

        Args:
            frame: Full frame
            zone: (x1, y1, x2, y2) search region

        Returns:
            Dict with ball position and confidence
        """
        # Run YOLO on full frame (more context helps detection)
        detection = self.ball_detector.detect_ball_in_frame(frame)

        if detection is None:
            logger.debug("No ball detected by YOLO")
            return None

        # Check if detection is within zone
        ball_x, ball_y = detection["center"]
        x1, y1, x2, y2 = zone

        if x1 <= ball_x <= x2 and y1 <= ball_y <= y2:
            logger.debug(
                f"Ball detected in zone at ({ball_x:.0f},{ball_y:.0f}), "
                f"conf={detection['confidence']:.3f}"
            )
            return {
                "x": ball_x,
                "y": ball_y,
                "confidence": detection["confidence"],
            }

        logger.debug(
            f"Ball detected at ({ball_x:.0f},{ball_y:.0f}) but outside zone"
        )
        return None

    def _zone_around_point(
        self,
        x: float,
        y: float,
        radius: float,
        frame_width: int,
        frame_height: int,
    ) -> tuple[float, float, float, float]:
        """Create a search zone around a point."""
        return (
            max(0, x - radius),
            max(0, y - radius),
            min(frame_width, x + radius),
            min(frame_height, y + radius),
        )

    def _combine_detections(
        self,
        golfer_result: Optional[dict],
        shaft_result: Optional[dict],
        ball_result: Optional[dict],
        frame_width: int,
        frame_height: int,
    ) -> Optional[OriginDetection]:
        """Combine results from multiple detection methods.

        Priority:
        1. If ball detected by YOLO → use that (most direct)
        2. If shaft endpoint found → use that
        3. If only golfer found → estimate from feet position

        Confidence increases if multiple methods agree.
        """
        candidates = []
        methods = []

        if ball_result:
            candidates.append((ball_result["x"], ball_result["y"]))
            methods.append("yolo_ball")

        if shaft_result:
            candidates.append((shaft_result["x"], shaft_result["y"]))
            methods.append("shaft")

        if golfer_result:
            # Estimate ball position from feet (slightly in front)
            feet_x, feet_y = golfer_result["feet_position"]
            # Ball is typically at feet level, slightly offset horizontally
            est_x = feet_x
            est_y = feet_y + 10  # Slightly below feet line
            candidates.append((est_x, est_y))
            methods.append("golfer_feet")

        if not candidates:
            logger.debug("No origin candidates found by any method")
            return None

        # Check for agreement between methods
        if len(candidates) >= 2:
            # Calculate pairwise distances
            agreements = []
            for i in range(len(candidates)):
                for j in range(i + 1, len(candidates)):
                    dist = np.sqrt(
                        (candidates[i][0] - candidates[j][0]) ** 2 +
                        (candidates[i][1] - candidates[j][1]) ** 2
                    )
                    if dist < self.AGREEMENT_DISTANCE:
                        agreements.append((i, j, dist))

            if agreements:
                # Methods agree - average the agreeing positions
                agreeing_indices = set()
                for i, j, _ in agreements:
                    agreeing_indices.add(i)
                    agreeing_indices.add(j)

                agreeing_positions = [candidates[i] for i in agreeing_indices]
                final_x = sum(p[0] for p in agreeing_positions) / len(agreeing_positions)
                final_y = sum(p[1] for p in agreeing_positions) / len(agreeing_positions)

                agreeing_methods = [methods[i] for i in agreeing_indices]
                confidence = min(1.0, 0.5 + 0.2 * len(agreeing_methods))

                logger.info(
                    f"Ball origin: ({final_x:.0f},{final_y:.0f}) - "
                    f"methods agree: {agreeing_methods}, confidence={confidence:.2f}"
                )

                return OriginDetection(
                    x=final_x,
                    y=final_y,
                    confidence=confidence,
                    method="+".join(agreeing_methods),
                    golfer_bbox=golfer_result["bbox"] if golfer_result else None,
                )

        # No agreement - use priority order
        if ball_result:
            # Direct YOLO detection is most reliable
            confidence = min(0.7, ball_result["confidence"] * 5)  # Scale up low YOLO conf
            method = "yolo_ball"
            x, y = ball_result["x"], ball_result["y"]
        elif shaft_result:
            confidence = 0.5
            method = "shaft"
            x, y = shaft_result["x"], shaft_result["y"]
        else:
            confidence = 0.3
            method = "golfer_feet"
            x, y = candidates[-1]  # Last candidate is feet estimate

        logger.info(
            f"Ball origin: ({x:.0f},{y:.0f}) - method={method}, confidence={confidence:.2f}"
        )

        return OriginDetection(
            x=x,
            y=y,
            confidence=confidence,
            method=method,
            golfer_bbox=golfer_result["bbox"] if golfer_result else None,
        )
