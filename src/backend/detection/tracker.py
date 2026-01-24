"""Constraint-based ball tracking using trajectory cones and motion detection.

Uses geometric constraints and motion detection to track golf balls in flight,
which YOLO fails to detect reliably due to size and motion blur.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from loguru import logger

from backend.detection.origin import BallOriginDetector, OriginDetection


@dataclass
class TrajectoryPoint:
    """A single point in the ball's trajectory."""

    timestamp: float  # Seconds from video start
    x: float  # X coordinate in pixels
    y: float  # Y coordinate in pixels
    confidence: float  # 0-1, detection confidence
    method: str  # How this point was detected


@dataclass
class TrajectoryCone:
    """Defines the valid region where the ball can be at a given time."""

    origin_x: float  # Cone origin (ball starting position)
    origin_y: float
    min_angle: float  # Minimum angle in degrees (0 = right, 90 = up)
    max_angle: float  # Maximum angle in degrees
    min_distance: float  # Minimum distance from origin (pixels)
    max_distance: float  # Maximum distance from origin (pixels)

    def contains_point(self, x: float, y: float) -> bool:
        """Check if a point is within this cone."""
        dx = x - self.origin_x
        dy = self.origin_y - y  # Flip y since image coords are inverted

        distance = np.sqrt(dx**2 + dy**2)
        if distance < self.min_distance or distance > self.max_distance:
            return False

        # Calculate angle (0 = right, 90 = up, 180 = left)
        angle = np.degrees(np.arctan2(dy, dx))
        if angle < 0:
            angle += 360  # Normalize to 0-360

        # Check if angle is within cone bounds
        # Handle wrap-around for angles near 0/360
        if self.min_angle <= self.max_angle:
            return self.min_angle <= angle <= self.max_angle
        else:
            # Cone wraps around 0/360
            return angle >= self.min_angle or angle <= self.max_angle

    def get_mask(self, frame_width: int, frame_height: int) -> np.ndarray:
        """Generate a binary mask for this cone region."""
        mask = np.zeros((frame_height, frame_width), dtype=np.uint8)

        # Create cone as a filled polygon
        # Sample points along the cone boundaries
        num_points = 50
        points = []

        # Add origin point
        points.append((int(self.origin_x), int(self.origin_y)))

        # Add points along the min_angle edge
        for i in range(num_points + 1):
            dist = self.min_distance + (self.max_distance - self.min_distance) * i / num_points
            angle_rad = np.radians(self.min_angle)
            x = self.origin_x + dist * np.cos(angle_rad)
            y = self.origin_y - dist * np.sin(angle_rad)  # Flip y
            points.append((int(x), int(y)))

        # Add points along the arc at max_distance
        angle_step = (self.max_angle - self.min_angle) / num_points
        for i in range(num_points + 1):
            angle = self.min_angle + angle_step * i
            angle_rad = np.radians(angle)
            x = self.origin_x + self.max_distance * np.cos(angle_rad)
            y = self.origin_y - self.max_distance * np.sin(angle_rad)
            points.append((int(x), int(y)))

        # Add points along the max_angle edge (going back toward origin)
        for i in range(num_points, -1, -1):
            dist = self.min_distance + (self.max_distance - self.min_distance) * i / num_points
            angle_rad = np.radians(self.max_angle)
            x = self.origin_x + dist * np.cos(angle_rad)
            y = self.origin_y - dist * np.sin(angle_rad)
            points.append((int(x), int(y)))

        # Draw filled polygon
        pts = np.array(points, dtype=np.int32)
        cv2.fillPoly(mask, [pts], 255)

        return mask


class TrajectoryConeSolver:
    """Computes the valid trajectory cone for each frame based on time elapsed.

    For a camera BEHIND the golfer looking at the target:
    - Ball moves AWAY from camera (into the frame)
    - Trajectory appears mostly VERTICAL (up then down)
    - Minimal horizontal movement in frame
    - The "cone" is really a narrow vertical band
    """

    # From behind-ball camera perspective:
    # The ball goes UP (decreasing y) then DOWN (increasing y)
    # With minimal left/right drift
    CENTER_ANGLE = 90  # Straight up in image coords (0=right, 90=up, 180=left)

    # Narrow horizontal cone - ball doesn't move much left/right
    INITIAL_CONE_WIDTH = 40  # Degrees - narrow since mostly vertical motion
    NARROWING_RATE = 20  # Degrees per second of narrowing
    MIN_CONE_WIDTH = 15  # Degrees - stay fairly narrow

    # Vertical speed in image (pixels per second)
    # Ball appears to rise quickly then slow, then descend
    MIN_VERTICAL_SPEED = 50  # Minimum upward speed
    MAX_VERTICAL_SPEED = 400  # Maximum (fast drives go up quickly)

    def __init__(
        self,
        origin_x: float,
        origin_y: float,
    ):
        """Initialize the cone solver.

        Args:
            origin_x: Ball starting X position (pixels)
            origin_y: Ball starting Y position (pixels)
        """
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.center_angle = self.CENTER_ANGLE  # Straight up

        # Track detected trajectory - but don't use for refinement
        # (false positives can throw off the cone badly)
        self.detected_points: list[TrajectoryPoint] = []

    def get_cone_at_time(
        self,
        elapsed_time: float,
        frame_width: int,
        frame_height: int,
    ) -> TrajectoryCone:
        """Compute the trajectory cone for a given time after impact.

        For behind-ball camera: the ball goes UP initially, then DOWN.
        The cone is a narrow vertical band above the origin.

        Args:
            elapsed_time: Seconds since ball impact
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels

        Returns:
            TrajectoryCone defining valid ball positions
        """
        # Compute cone width - narrow since motion is mostly vertical
        cone_width = self.INITIAL_CONE_WIDTH - (elapsed_time * self.NARROWING_RATE)
        cone_width = max(cone_width, self.MIN_CONE_WIDTH)

        # Cone bounds - centered on straight up (90 degrees)
        min_angle = self.center_angle - cone_width / 2
        max_angle = self.center_angle + cone_width / 2

        # Distance constraints
        # For behind-ball view, "distance" is mostly vertical (upward movement)
        # The ball rises for ~1-2 seconds, then descends
        # Typical apex time is around 2-3 seconds for a driver

        min_distance = elapsed_time * self.MIN_VERTICAL_SPEED * 0.3
        max_distance = elapsed_time * self.MAX_VERTICAL_SPEED * 1.2

        # Clamp to frame height (ball goes up toward top of frame)
        max_distance = min(max_distance, frame_height)

        logger.debug(
            f"Cone at t={elapsed_time:.2f}s: angles=[{min_angle:.1f}°,{max_angle:.1f}°], "
            f"dist=[{min_distance:.0f},{max_distance:.0f}px], width={cone_width:.1f}°"
        )

        return TrajectoryCone(
            origin_x=self.origin_x,
            origin_y=self.origin_y,
            min_angle=min_angle,
            max_angle=max_angle,
            min_distance=min_distance,
            max_distance=max_distance,
        )

    def add_detection(self, point: TrajectoryPoint) -> None:
        """Record a detected point (for logging/analysis only).

        Note: We don't refine the cone based on detections because
        false positives can throw off the cone badly.

        Args:
            point: Detected trajectory point
        """
        self.detected_points.append(point)


class ConstrainedBallTracker:
    """Tracks golf ball using motion detection within trajectory cone constraints.

    Strategy:
    1. Focus on first 6 frames (~100ms at 60fps) where ball is most visible
    2. Prioritize bright candidates that are above origin and centered
    3. Use early detections to establish expected trajectory path
    4. Track consistency - later detections should follow established path
    """

    # Motion detection parameters
    DIFF_THRESHOLD = 15  # Brightness difference threshold
    MIN_CONTOUR_AREA = 5  # Minimum blob area (pixels)
    MAX_CONTOUR_AREA = 300  # Maximum blob area (golf ball is small)

    # Search region (for behind-ball camera view)
    SEARCH_HALF_WIDTH = 150  # Horizontal search range from origin
    SEARCH_HEIGHT_ABOVE = 500  # How far above origin to search
    SEARCH_HEIGHT_BELOW = 50  # Small buffer below origin

    # Candidate scoring weights
    BRIGHTNESS_WEIGHT = 0.4  # Prefer bright candidates (white ball)
    VERTICAL_WEIGHT = 0.3  # Prefer candidates above origin
    CENTERED_WEIGHT = 0.2  # Prefer horizontally centered candidates
    CONSISTENCY_WEIGHT = 0.3  # Prefer candidates consistent with prior detections

    # Minimum brightness for a valid ball candidate
    MIN_BRIGHTNESS = 100

    def __init__(self, origin_detector: Optional[BallOriginDetector] = None):
        """Initialize the tracker.

        Args:
            origin_detector: Optional BallOriginDetector instance to reuse
        """
        self.origin_detector = origin_detector or BallOriginDetector()
        self.last_detection: Optional[TrajectoryPoint] = None

    def track_flight(
        self,
        video_path: Path,
        origin: OriginDetection,
        strike_time: float,
        end_time: Optional[float] = None,
        max_flight_duration: float = 5.0,
    ) -> list[TrajectoryPoint]:
        """Track ball flight from origin using constrained motion detection.

        Strategy:
        1. Use simple rectangular search region (vertical band above origin)
        2. Score candidates by brightness, position, and consistency
        3. Establish trajectory in first 6 frames, then track along path

        Args:
            video_path: Path to video file
            origin: Detected ball origin position
            strike_time: Timestamp of ball strike (seconds)
            end_time: Optional end time to stop tracking
            max_flight_duration: Maximum flight time to track (seconds)

        Returns:
            List of TrajectoryPoint objects representing the ball's path
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return []

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0:
                logger.error("Invalid FPS in video")
                return []

            # Define search region (vertical band above origin)
            search_x1 = max(0, int(origin.x - self.SEARCH_HALF_WIDTH))
            search_x2 = min(frame_width, int(origin.x + self.SEARCH_HALF_WIDTH))
            search_y1 = max(0, int(origin.y - self.SEARCH_HEIGHT_ABOVE))
            search_y2 = min(frame_height, int(origin.y + self.SEARCH_HEIGHT_BELOW))

            logger.info(
                f"Search region: x=[{search_x1},{search_x2}], y=[{search_y1},{search_y2}]"
            )

            # Calculate frame range
            start_frame = int(strike_time * fps)
            if end_time is not None:
                end_frame = min(int(end_time * fps), total_frames)
            else:
                end_frame = min(int((strike_time + max_flight_duration) * fps), total_frames)

            logger.info(
                f"Tracking flight from frame {start_frame} to {end_frame} "
                f"({(end_frame - start_frame) / fps:.2f}s)"
            )

            # Seek to start
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            trajectory: list[TrajectoryPoint] = []
            prev_gray = None
            self.last_detection = None

            for frame_idx in range(start_frame, end_frame):
                ret, frame = cap.read()
                if not ret:
                    break

                current_time = frame_idx / fps
                elapsed = current_time - strike_time
                frame_number = frame_idx - start_frame + 1

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                if prev_gray is not None and elapsed > 0:
                    # Detect motion in search region
                    detection = self._detect_ball_in_region(
                        prev_gray,
                        gray,
                        origin.x,
                        origin.y,
                        search_x1,
                        search_y1,
                        search_x2,
                        search_y2,
                        frame_number,
                    )

                    if detection is not None:
                        point = TrajectoryPoint(
                            timestamp=current_time,
                            x=detection["x"],
                            y=detection["y"],
                            confidence=detection["confidence"],
                            method=detection["method"],
                        )
                        trajectory.append(point)
                        self.last_detection = point

                        logger.debug(
                            f"Frame {frame_number}: ({detection['x']:.0f},{detection['y']:.0f}) "
                            f"conf={detection['confidence']:.2f} method={detection['method']}"
                        )

                prev_gray = gray

            logger.info(f"Tracked {len(trajectory)} raw points in ball flight")

            # Post-process: filter out inconsistent detections
            filtered = self._filter_trajectory(trajectory, fps)
            logger.info(f"After filtering: {len(filtered)} points")

            return filtered

        finally:
            cap.release()

    def _filter_trajectory(
        self,
        trajectory: list[TrajectoryPoint],
        fps: float,
    ) -> list[TrajectoryPoint]:
        """Filter trajectory to keep only reliable early detections.

        Strategy:
        1. Focus on first 10 frames (~150ms at 60fps) where ball is most visible
        2. Keep only high-confidence points
        3. Require continuity - no large jumps between consecutive points

        Args:
            trajectory: Raw trajectory points
            fps: Video framerate

        Returns:
            Filtered trajectory points (reliable early detections only)
        """
        if len(trajectory) < 2:
            return trajectory

        # Get the start time from first detection
        if not trajectory:
            return trajectory
        start_time = trajectory[0].timestamp

        # Keep only points from first 200ms with confidence >= 0.6
        early_pts = [
            pt for pt in trajectory
            if (pt.timestamp - start_time) <= 0.2 and pt.confidence >= 0.6
        ]

        if len(early_pts) < 2:
            # Not enough early points, return any high-confidence points
            return [pt for pt in trajectory if pt.confidence >= 0.7]

        # Calculate trajectory baseline from early points
        avg_x = sum(pt.x for pt in early_pts) / len(early_pts)

        logger.debug(f"Early trajectory: {len(early_pts)} points, avg_x={avg_x:.0f}")

        # Filter to keep continuous trajectory
        filtered = []
        max_jump = 80  # Max pixels between consecutive points (strict)
        max_x_deviation = 60  # Max horizontal deviation from average

        last_good = None
        for pt in early_pts:
            # Check horizontal deviation
            x_dev = abs(pt.x - avg_x)
            if x_dev > max_x_deviation:
                logger.debug(f"Filtered point at t={pt.timestamp:.3f}: x_dev={x_dev:.0f}")
                continue

            # Check for large jumps
            if last_good is not None:
                dist = np.sqrt((pt.x - last_good.x)**2 + (pt.y - last_good.y)**2)
                if dist > max_jump:
                    logger.debug(f"Filtered point at t={pt.timestamp:.3f}: jump={dist:.0f}")
                    continue

            filtered.append(pt)
            last_good = pt

        return filtered

    def _detect_ball_in_region(
        self,
        prev_gray: np.ndarray,
        curr_gray: np.ndarray,
        origin_x: float,
        origin_y: float,
        search_x1: int,
        search_y1: int,
        search_x2: int,
        search_y2: int,
        frame_number: int,
    ) -> Optional[dict]:
        """Detect ball using frame differencing with smart candidate scoring.

        Strategy:
        1. Find motion blobs via frame differencing
        2. Score each candidate based on:
           - Brightness (ball is white)
           - Position relative to origin (above = rising ball)
           - Horizontal centering (ball mostly goes vertical)
           - Consistency with previous detection
        3. Return highest-scoring candidate above threshold

        Args:
            prev_gray: Previous frame (grayscale)
            curr_gray: Current frame (grayscale)
            origin_x, origin_y: Ball origin position
            search_x1, search_y1, search_x2, search_y2: Search region bounds
            frame_number: Current frame number (1-indexed from strike)

        Returns:
            Dict with x, y, confidence, method if ball detected, else None
        """
        # Create search region mask
        mask = np.zeros_like(prev_gray)
        mask[search_y1:search_y2, search_x1:search_x2] = 255

        # Frame differencing
        diff = cv2.absdiff(prev_gray, curr_gray)
        diff_masked = cv2.bitwise_and(diff, diff, mask=mask)

        # Threshold
        _, thresh = cv2.threshold(diff_masked, self.DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Extract candidates
        candidates = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if self.MIN_CONTOUR_AREA <= area <= self.MAX_CONTOUR_AREA:
                M = cv2.moments(contour)
                if M["m00"] > 0:
                    cx = M["m10"] / M["m00"]
                    cy = M["m01"] / M["m00"]

                    # Get brightness at this location
                    mask_contour = np.zeros_like(curr_gray)
                    cv2.drawContours(mask_contour, [contour], -1, 255, -1)
                    brightness = cv2.mean(curr_gray, mask=mask_contour)[0]

                    # Skip dim candidates (ball is white)
                    if brightness < self.MIN_BRIGHTNESS:
                        continue

                    # Calculate position relative to origin
                    dx = cx - origin_x
                    dy = cy - origin_y  # Negative = above origin

                    candidates.append({
                        "x": cx,
                        "y": cy,
                        "area": area,
                        "brightness": brightness,
                        "dx": dx,
                        "dy": dy,
                    })

        if not candidates:
            return None

        # Score candidates
        def score_candidate(cand: dict) -> float:
            score = 0.0

            # Brightness score (0-1, normalized assuming 255 max)
            brightness_score = cand["brightness"] / 255.0
            score += brightness_score * self.BRIGHTNESS_WEIGHT

            # Vertical score: prefer candidates above origin (dy < 0)
            # Ball should be rising in first frames
            if cand["dy"] < 0:
                # Higher score for being above origin
                vertical_score = min(abs(cand["dy"]) / 200.0, 1.0)
            else:
                # Penalize being below origin in early frames
                vertical_score = -0.5 if frame_number <= 6 else 0.0
            score += vertical_score * self.VERTICAL_WEIGHT

            # Centered score: prefer candidates with small dx
            # Ball trajectory is mostly vertical in behind-ball view
            centered_score = 1.0 - min(abs(cand["dx"]) / self.SEARCH_HALF_WIDTH, 1.0)
            score += centered_score * self.CENTERED_WEIGHT

            # Consistency score: prefer candidates near previous detection
            if self.last_detection is not None:
                dist = np.sqrt(
                    (cand["x"] - self.last_detection.x) ** 2 +
                    (cand["y"] - self.last_detection.y) ** 2
                )
                # Expect ball to move ~10-50px per frame
                if dist < 100:
                    consistency_score = 1.0 - (dist / 100.0)
                else:
                    consistency_score = -0.5  # Penalize large jumps
                score += consistency_score * self.CONSISTENCY_WEIGHT

            return score

        # Sort by score
        candidates.sort(key=score_candidate, reverse=True)
        best = candidates[0]
        best_score = score_candidate(best)

        # Determine confidence based on score and frame number
        if frame_number <= 6:
            # Early frames: higher confidence if bright and above origin
            if best["brightness"] >= 140 and best["dy"] < -50:
                confidence = 0.8
            elif best["brightness"] >= 120 and best["dy"] < 0:
                confidence = 0.6
            else:
                confidence = 0.4
        else:
            # Later frames: rely more on consistency
            if self.last_detection is not None:
                dist = np.sqrt(
                    (best["x"] - self.last_detection.x) ** 2 +
                    (best["y"] - self.last_detection.y) ** 2
                )
                if dist < 50:
                    confidence = 0.7
                elif dist < 100:
                    confidence = 0.5
                else:
                    confidence = 0.3
            else:
                confidence = 0.4

        return {
            "x": best["x"],
            "y": best["y"],
            "confidence": confidence,
            "method": "motion_diff",
        }

    def visualize_cone(
        self,
        frame: np.ndarray,
        cone: TrajectoryCone,
        trajectory: list[TrajectoryPoint],
        alpha: float = 0.3,
    ) -> np.ndarray:
        """Draw trajectory cone and detected points on frame for debugging.

        Args:
            frame: BGR frame to draw on
            cone: Trajectory cone to visualize
            trajectory: Detected trajectory points
            alpha: Transparency for cone overlay

        Returns:
            Frame with visualization overlay
        """
        output = frame.copy()
        frame_height, frame_width = frame.shape[:2]

        # Draw cone as semi-transparent overlay
        cone_mask = cone.get_mask(frame_width, frame_height)
        cone_overlay = np.zeros_like(frame)
        cone_overlay[cone_mask > 0] = [0, 255, 255]  # Yellow cone
        output = cv2.addWeighted(output, 1.0, cone_overlay, alpha, 0)

        # Draw origin point
        cv2.circle(output, (int(cone.origin_x), int(cone.origin_y)), 10, (0, 0, 255), -1)

        # Draw trajectory points
        for i, pt in enumerate(trajectory):
            color = (0, 255, 0) if pt.confidence > 0.5 else (0, 165, 255)
            cv2.circle(output, (int(pt.x), int(pt.y)), 5, color, -1)

            # Connect points with line
            if i > 0:
                prev_pt = trajectory[i - 1]
                cv2.line(
                    output,
                    (int(prev_pt.x), int(prev_pt.y)),
                    (int(pt.x), int(pt.y)),
                    (255, 255, 255), 2
                )

        return output
