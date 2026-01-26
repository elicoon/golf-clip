"""Trajectory assembler for ball tracking.

Takes individual frame detections and builds a coherent trajectory:
- Converts pixel coordinates to normalized (0-1) coordinates
- Fills small gaps with linear interpolation
- Finds apex (highest point)
- Smooths noisy detections
- Returns None if insufficient detections
"""

from dataclasses import dataclass, field
from typing import Optional

# Constants
MAX_GAP_FRAMES = 5  # Maximum gap to interpolate
MIN_POINTS_FOR_TRAJ = 6  # Minimum points needed for a valid trajectory
SMOOTHING_WINDOW = 3  # Window size for moving average smoothing


@dataclass
class TrajectoryPoint:
    """A single point in a trajectory."""

    timestamp: float  # Time offset from strike_time
    x: float  # Normalized x coordinate (0-1)
    y: float  # Normalized y coordinate (0-1)
    confidence: float  # Detection confidence (0-1)
    interpolated: bool = False  # True if this point was interpolated
    velocity: Optional[float] = None  # Velocity in normalized units per second


@dataclass
class AssembledTrajectory:
    """A fully assembled trajectory ready for storage/rendering."""

    points: list[TrajectoryPoint]
    start_time: float  # Timestamp of first point
    end_time: float  # Timestamp of last point
    avg_confidence: float  # Average confidence across all points
    gap_count: int  # Number of gaps that were interpolated
    total_distance: float  # Total trajectory distance in normalized units
    apex_index: int  # Index of the highest point (lowest y in screen coords)
    method: str = "detected"  # "detected", "physics", "hybrid"


@dataclass
class _RawDetection:
    """Internal representation of a raw detection."""

    frame_index: int
    x_pixels: Optional[float] = None
    y_pixels: Optional[float] = None
    confidence: float = 0.0
    is_detection: bool = False


class TrajectoryAssembler:
    """Assembles individual frame detections into a coherent trajectory."""

    def __init__(self, frame_width: int, frame_height: int, fps: float):
        """Initialize the assembler.

        Args:
            frame_width: Video frame width in pixels
            frame_height: Video frame height in pixels
            fps: Video frames per second
        """
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.fps = fps
        self._detections: list[_RawDetection] = []

    def add_detection(
        self, frame_index: int, x_pixels: float, y_pixels: float, confidence: float
    ) -> None:
        """Add a detected ball position.

        Args:
            frame_index: Frame number (0-indexed from start of tracking)
            x_pixels: X position in pixels
            y_pixels: Y position in pixels
            confidence: Detection confidence (0-1)
        """
        self._detections.append(
            _RawDetection(
                frame_index=frame_index,
                x_pixels=x_pixels,
                y_pixels=y_pixels,
                confidence=confidence,
                is_detection=True,
            )
        )

    def add_no_detection(self, frame_index: int) -> None:
        """Record that no detection was made for a frame (gap).

        Args:
            frame_index: Frame number where no detection occurred
        """
        self._detections.append(
            _RawDetection(
                frame_index=frame_index,
                is_detection=False,
            )
        )

    def assemble(self, strike_time: float) -> Optional[AssembledTrajectory]:
        """Assemble the trajectory from collected detections.

        Args:
            strike_time: Timestamp of the ball strike in seconds

        Returns:
            AssembledTrajectory if enough detections, None otherwise
        """
        if not self._detections:
            return None

        # Sort by frame index
        sorted_detections = sorted(self._detections, key=lambda d: d.frame_index)

        # Convert to trajectory points and interpolate gaps
        points, gap_count = self._process_detections(sorted_detections, strike_time)

        # Check minimum points
        if len(points) < MIN_POINTS_FOR_TRAJ:
            return None

        # Smooth the trajectory
        smoothed_points = self._smooth_trajectory(points)

        # Calculate velocities
        self._calculate_velocities(smoothed_points)

        # Find apex
        apex_index = self._find_apex(smoothed_points)

        # Calculate total distance
        total_distance = self._calculate_distance(smoothed_points)

        # Calculate average confidence (excluding interpolated points)
        detected_points = [p for p in smoothed_points if not p.interpolated]
        avg_confidence = (
            sum(p.confidence for p in detected_points) / len(detected_points)
            if detected_points
            else 0.0
        )

        return AssembledTrajectory(
            points=smoothed_points,
            start_time=smoothed_points[0].timestamp,
            end_time=smoothed_points[-1].timestamp,
            avg_confidence=avg_confidence,
            gap_count=gap_count,
            total_distance=total_distance,
            apex_index=apex_index,
            method="detected",
        )

    def _process_detections(
        self, sorted_detections: list[_RawDetection], strike_time: float
    ) -> tuple[list[TrajectoryPoint], int]:
        """Process raw detections into trajectory points with gap interpolation.

        Args:
            sorted_detections: Detections sorted by frame index
            strike_time: Timestamp of ball strike

        Returns:
            Tuple of (list of trajectory points, number of gaps filled)
        """
        points: list[TrajectoryPoint] = []
        gap_count = 0

        # Find all actual detections (not gaps)
        actual_detections = [d for d in sorted_detections if d.is_detection]

        if len(actual_detections) < 2:
            # Not enough detections to interpolate
            for det in actual_detections:
                if det.x_pixels is not None and det.y_pixels is not None:
                    points.append(
                        TrajectoryPoint(
                            timestamp=strike_time + det.frame_index / self.fps,
                            x=det.x_pixels / self.frame_width,
                            y=det.y_pixels / self.frame_height,
                            confidence=det.confidence,
                            interpolated=False,
                        )
                    )
            return points, gap_count

        # Process with interpolation
        prev_detection: Optional[_RawDetection] = None

        for det in sorted_detections:
            if det.is_detection and det.x_pixels is not None and det.y_pixels is not None:
                # Check if there's a gap to fill
                if prev_detection is not None:
                    gap_size = det.frame_index - prev_detection.frame_index - 1
                    if 0 < gap_size <= MAX_GAP_FRAMES:
                        # Interpolate the gap
                        gap_count += 1
                        for i in range(1, gap_size + 1):
                            t = i / (gap_size + 1)
                            interp_frame = prev_detection.frame_index + i
                            interp_x = prev_detection.x_pixels + t * (det.x_pixels - prev_detection.x_pixels)
                            interp_y = prev_detection.y_pixels + t * (det.y_pixels - prev_detection.y_pixels)
                            interp_conf = prev_detection.confidence + t * (det.confidence - prev_detection.confidence)

                            points.append(
                                TrajectoryPoint(
                                    timestamp=strike_time + interp_frame / self.fps,
                                    x=interp_x / self.frame_width,
                                    y=interp_y / self.frame_height,
                                    confidence=interp_conf,
                                    interpolated=True,
                                )
                            )

                # Add the actual detection
                points.append(
                    TrajectoryPoint(
                        timestamp=strike_time + det.frame_index / self.fps,
                        x=det.x_pixels / self.frame_width,
                        y=det.y_pixels / self.frame_height,
                        confidence=det.confidence,
                        interpolated=False,
                    )
                )
                prev_detection = det

        return points, gap_count

    def _smooth_trajectory(
        self, points: list[TrajectoryPoint]
    ) -> list[TrajectoryPoint]:
        """Apply moving average smoothing to reduce noise.

        Args:
            points: List of trajectory points

        Returns:
            Smoothed trajectory points
        """
        if len(points) <= SMOOTHING_WINDOW:
            return points

        smoothed = []
        half_window = SMOOTHING_WINDOW // 2

        for i, point in enumerate(points):
            # Get window bounds
            start = max(0, i - half_window)
            end = min(len(points), i + half_window + 1)
            window = points[start:end]

            # Calculate smoothed position (weighted by confidence)
            total_weight = sum(p.confidence for p in window)
            if total_weight > 0:
                smooth_x = sum(p.x * p.confidence for p in window) / total_weight
                smooth_y = sum(p.y * p.confidence for p in window) / total_weight
            else:
                smooth_x = point.x
                smooth_y = point.y

            smoothed.append(
                TrajectoryPoint(
                    timestamp=point.timestamp,
                    x=smooth_x,
                    y=smooth_y,
                    confidence=point.confidence,
                    interpolated=point.interpolated,
                )
            )

        return smoothed

    def _calculate_velocities(self, points: list[TrajectoryPoint]) -> None:
        """Calculate velocity for each point in place.

        Args:
            points: List of trajectory points to update
        """
        for i in range(1, len(points)):
            prev = points[i - 1]
            curr = points[i]
            dt = curr.timestamp - prev.timestamp
            if dt > 0:
                dx = curr.x - prev.x
                dy = curr.y - prev.y
                distance = (dx**2 + dy**2) ** 0.5
                curr.velocity = distance / dt
            else:
                curr.velocity = 0.0

        # First point velocity is same as second
        if len(points) > 1 and points[1].velocity is not None:
            points[0].velocity = points[1].velocity

    def _find_apex(self, points: list[TrajectoryPoint]) -> int:
        """Find the index of the apex (highest point).

        In screen coordinates, lower y = higher on screen.

        Args:
            points: List of trajectory points

        Returns:
            Index of the apex point
        """
        if not points:
            return 0

        min_y = float("inf")
        apex_index = 0

        for i, point in enumerate(points):
            if point.y < min_y:
                min_y = point.y
                apex_index = i

        return apex_index

    def _calculate_distance(self, points: list[TrajectoryPoint]) -> float:
        """Calculate total trajectory distance in normalized units.

        Args:
            points: List of trajectory points

        Returns:
            Total distance traveled
        """
        if len(points) < 2:
            return 0.0

        total = 0.0
        for i in range(1, len(points)):
            prev = points[i - 1]
            curr = points[i]
            dx = curr.x - prev.x
            dy = curr.y - prev.y
            total += (dx**2 + dy**2) ** 0.5

        return total
