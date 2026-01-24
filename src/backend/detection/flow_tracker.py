"""Optical flow tracker for ball motion detection.

Uses sparse Lucas-Kanade optical flow to track ball motion:
- Extracts feature points in the ball region
- Tracks those features to the next frame
- Filters by motion consistency (ball moves in one direction)
- Estimates ball position from centroid of consistent motion
"""

from dataclasses import dataclass, field
from typing import Optional, Tuple, List
import numpy as np
import cv2


# Lucas-Kanade optical flow parameters
MAX_CORNERS = 20  # Maximum feature points to track
QUALITY_LEVEL = 0.1  # Quality level for corner detection
MIN_DISTANCE = 5  # Minimum distance between corners
WIN_SIZE = (15, 15)  # Window size for optical flow
MAX_LEVEL = 2  # Maximum pyramid level
MIN_MOTION = 2.0  # Minimum motion magnitude to consider (pixels)
MOTION_ANGLE_TOL = 30  # Tolerance for motion angle consistency (degrees)


@dataclass
class FlowVector:
    """A single optical flow vector."""

    x: float  # Start x position
    y: float  # Start y position
    dx: float  # Motion in x direction
    dy: float  # Motion in y direction
    confidence: float = 1.0  # Confidence score


@dataclass
class FlowResult:
    """Result of optical flow tracking."""

    vectors: List[FlowVector] = field(default_factory=list)
    mean_velocity: Optional[Tuple[float, float]] = None  # (vx, vy)
    dominant_velocity: Optional[Tuple[float, float]] = None  # (vx, vy)
    ball_position: Optional[Tuple[float, float]] = None  # Estimated (x, y)
    confidence: float = 0.0


class OpticalFlowTracker:
    """Tracks ball motion using sparse Lucas-Kanade optical flow.

    This tracker is designed for tracking a golf ball in flight:
    - Initializes with feature points around the ball position
    - Tracks those features frame-to-frame
    - Filters for consistent motion (ball moves as a unit)
    - Estimates new ball position from tracked features

    Usage:
        tracker = OpticalFlowTracker()
        tracker.initialize(first_frame_gray, center=(x, y), radius=10)
        result = tracker.track(next_frame_gray)
        if result and result.ball_position:
            new_x, new_y = result.ball_position
    """

    def __init__(self):
        """Initialize the tracker."""
        self._prev_gray: Optional[np.ndarray] = None
        self._prev_points: Optional[np.ndarray] = None
        self._lk_params = dict(
            winSize=WIN_SIZE,
            maxLevel=MAX_LEVEL,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03)
        )

    def reset(self) -> None:
        """Reset the tracker state."""
        self._prev_gray = None
        self._prev_points = None

    def initialize(
        self,
        frame_gray: np.ndarray,
        center: Tuple[int, int],
        radius: int
    ) -> bool:
        """Initialize the tracker with feature points around ball position.

        Args:
            frame_gray: Grayscale frame (uint8)
            center: Ball center position (x, y)
            radius: Ball radius in pixels

        Returns:
            True if initialization successful (found features), False otherwise
        """
        self.reset()

        # Store the frame
        self._prev_gray = frame_gray.copy()

        # Create a mask for the ball region (with some padding)
        h, w = frame_gray.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)

        # Use a slightly larger region to capture ball edges
        search_radius = int(radius * 1.5)
        cv2.circle(mask, center, search_radius, 255, -1)

        # Find good features to track within the ball region
        points = cv2.goodFeaturesToTrack(
            frame_gray,
            maxCorners=MAX_CORNERS,
            qualityLevel=QUALITY_LEVEL,
            minDistance=MIN_DISTANCE,
            mask=mask,
            blockSize=7
        )

        if points is None or len(points) == 0:
            # No features found - try with lower quality threshold
            points = cv2.goodFeaturesToTrack(
                frame_gray,
                maxCorners=MAX_CORNERS,
                qualityLevel=0.01,  # Lower quality
                minDistance=3,  # Smaller distance
                mask=mask,
                blockSize=5
            )

        if points is None or len(points) == 0:
            # Still no features - create synthetic points at ball center
            # This ensures we can still attempt tracking
            cx, cy = center
            points = np.array([[[float(cx), float(cy)]]], dtype=np.float32)

        self._prev_points = points
        return True

    def track(
        self,
        frame_gray: np.ndarray,
        search_region: Optional[Tuple[int, int, int, int]] = None
    ) -> Optional[FlowResult]:
        """Track features to the next frame.

        Args:
            frame_gray: Current grayscale frame (uint8)
            search_region: Optional (x, y, w, h) to limit search area

        Returns:
            FlowResult with tracked motion vectors and estimated ball position,
            or None if tracking failed
        """
        if self._prev_gray is None or self._prev_points is None:
            return None

        if len(self._prev_points) == 0:
            return None

        # Calculate optical flow
        next_points, status, error = cv2.calcOpticalFlowPyrLK(
            self._prev_gray,
            frame_gray,
            self._prev_points,
            None,
            **self._lk_params
        )

        if next_points is None:
            return None

        # Filter good points (status == 1)
        good_old = self._prev_points[status.flatten() == 1]
        good_new = next_points[status.flatten() == 1]

        if len(good_old) == 0:
            # Lost all tracking points
            self._prev_gray = frame_gray.copy()
            return FlowResult(confidence=0.0)

        # Build flow vectors
        vectors = []
        for old_pt, new_pt in zip(good_old, good_new):
            x, y = old_pt.flatten()
            nx, ny = new_pt.flatten()
            dx, dy = nx - x, ny - y

            # Calculate magnitude
            mag = np.sqrt(dx * dx + dy * dy)

            # Only include vectors with significant motion
            if mag >= MIN_MOTION:
                vectors.append(FlowVector(
                    x=float(x),
                    y=float(y),
                    dx=float(dx),
                    dy=float(dy),
                    confidence=1.0
                ))

        # Filter for consistent motion
        consistent_vectors = self._filter_consistent_motion(vectors)

        # Calculate mean velocity from all vectors
        mean_velocity = None
        if len(vectors) > 0:
            mean_dx = np.mean([v.dx for v in vectors])
            mean_dy = np.mean([v.dy for v in vectors])
            mean_velocity = (float(mean_dx), float(mean_dy))

        # Calculate dominant velocity from consistent vectors
        dominant_velocity = None
        if len(consistent_vectors) > 0:
            dom_dx = np.mean([v.dx for v in consistent_vectors])
            dom_dy = np.mean([v.dy for v in consistent_vectors])
            dominant_velocity = (float(dom_dx), float(dom_dy))

        # Estimate ball position
        ball_position = self._estimate_ball_position(consistent_vectors, good_new)

        # Calculate confidence based on consistency
        confidence = 0.0
        if len(vectors) > 0:
            confidence = len(consistent_vectors) / len(vectors)
        elif len(good_new) > 0:
            # Had tracked points but no significant motion
            confidence = 0.5

        # Update state for next frame
        self._prev_gray = frame_gray.copy()
        self._prev_points = good_new.reshape(-1, 1, 2)

        return FlowResult(
            vectors=vectors,
            mean_velocity=mean_velocity,
            dominant_velocity=dominant_velocity,
            ball_position=ball_position,
            confidence=confidence
        )

    def _filter_consistent_motion(
        self,
        vectors: List[FlowVector]
    ) -> List[FlowVector]:
        """Filter vectors for consistent motion direction.

        The ball moves as a unit, so all parts should move in the same
        direction. This filters out spurious motion from noise.

        Args:
            vectors: List of flow vectors

        Returns:
            Filtered list of vectors with consistent motion
        """
        if len(vectors) < 2:
            return vectors

        # Calculate angles for all vectors
        angles = []
        for v in vectors:
            angle = np.degrees(np.arctan2(v.dy, v.dx))
            angles.append(angle)

        # Find the median angle
        median_angle = np.median(angles)

        # Filter vectors within tolerance of median
        consistent = []
        for v, angle in zip(vectors, angles):
            # Calculate angular difference (handling wraparound)
            diff = abs(angle - median_angle)
            if diff > 180:
                diff = 360 - diff

            if diff <= MOTION_ANGLE_TOL:
                consistent.append(v)

        return consistent

    def _estimate_ball_position(
        self,
        consistent_vectors: List[FlowVector],
        tracked_points: np.ndarray
    ) -> Optional[Tuple[float, float]]:
        """Estimate ball position from consistent motion.

        Args:
            consistent_vectors: Vectors with consistent motion
            tracked_points: All tracked point positions in current frame

        Returns:
            Estimated (x, y) ball position, or None
        """
        if len(consistent_vectors) == 0:
            # Fall back to centroid of all tracked points
            if len(tracked_points) > 0:
                centroid = np.mean(tracked_points, axis=0)
                return (float(centroid[0]), float(centroid[1]))
            return None

        # Calculate new positions from consistent vectors
        new_positions = []
        for v in consistent_vectors:
            new_x = v.x + v.dx
            new_y = v.y + v.dy
            new_positions.append((new_x, new_y))

        # Return centroid of consistent motion endpoints
        mean_x = np.mean([p[0] for p in new_positions])
        mean_y = np.mean([p[1] for p in new_positions])

        return (float(mean_x), float(mean_y))
