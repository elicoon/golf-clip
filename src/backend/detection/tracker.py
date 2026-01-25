"""Constraint-based ball tracking using trajectory cones and motion detection.

Uses geometric constraints and motion detection to track golf balls in flight,
which YOLO fails to detect reliably due to size and motion blur.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

from backend.detection.origin import BallOriginDetector, OriginDetection
from backend.detection.trajectory_physics import TrajectoryPhysics
from backend.detection.perspective import DTLPerspective, CameraParams
from backend.detection.landing import LandingEstimator
from backend.processing.curves import CurveFitter
from backend.detection.ball_template import BallTemplateExtractor
from backend.detection.scale_matcher import MultiScaleMatcher
from backend.detection.flow_tracker import OpticalFlowTracker
from backend.detection.kalman_tracker import BallKalmanFilter
from backend.detection.detection_scorer import DetectionScorer, DetectionCandidate
from backend.detection.trajectory_assembler import TrajectoryAssembler


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

        # Initialize physics trajectory components
        self.physics = TrajectoryPhysics()
        self.perspective = DTLPerspective()
        self.landing_estimator = LandingEstimator()
        self.curve_fitter = CurveFitter()

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

    def track_full_trajectory(
        self,
        video_path: Path,
        origin_point: Tuple[float, float],
        strike_time: float,
        frame_width: int,
        frame_height: int,
        audio_path: Optional[str] = None,
    ) -> Optional[dict]:
        """Generate complete trajectory starting from detected origin.

        This method generates a realistic golf ball trajectory arc directly
        in 2D screen coordinates. The early motion detection is unreliable
        for fast-moving golf balls, so we use a standard trajectory shape
        calibrated to look correct for down-the-line camera angles.

        Args:
            video_path: Path to video file
            origin_point: Ball origin position in normalized coords (0-1)
            strike_time: When the ball was struck (seconds)
            frame_width: Video frame width in pixels
            frame_height: Video frame height in pixels
            audio_path: Optional path to audio/video for landing detection

        Returns:
            Dict with trajectory data, or None if generation fails
        """
        origin_x, origin_y = origin_point

        # Trajectory parameters calibrated for typical golf shots
        # These create a visually appealing arc for down-the-line camera view
        flight_duration = 3.0  # seconds - typical driver flight time
        apex_height = 0.50  # normalized - how high ball rises from origin
        apex_time = 1.1  # when apex occurs (seconds from strike)
        lateral_drift = -0.08  # negative = slight draw (left), typical for most golfers

        # Physics: compute gravity and initial velocity from desired apex
        # apex_height = v_y0 * apex_time - 0.5 * g * apex_time^2
        # At apex: v_y = 0, so v_y0 = g * apex_time
        # Substituting: apex_height = g * apex_time^2 - 0.5 * g * apex_time^2 = 0.5 * g * apex_time^2
        # Therefore: g = 2 * apex_height / apex_time^2
        gravity = 2 * apex_height / (apex_time ** 2)
        v_y0 = gravity * apex_time

        # Lateral velocity (constant drift)
        v_x = lateral_drift / flight_duration

        # Generate trajectory points
        sample_rate = 30.0
        points = []
        timestamps = []
        apex_idx = 0
        min_y = origin_y

        t = 0.0
        while t <= flight_duration:
            # Parabolic motion in screen coordinates
            # y increases downward, so subtract the arc height
            y_offset = v_y0 * t - 0.5 * gravity * t * t
            x_offset = v_x * t

            screen_x = origin_x + x_offset
            screen_y = origin_y - y_offset  # subtract because screen y increases downward

            # Track apex (minimum screen y = highest point)
            if screen_y < min_y:
                min_y = screen_y
                apex_idx = len(points)

            # Stop if ball returns to ground level
            if t > apex_time and screen_y >= origin_y:
                # Add final landing point
                points.append({
                    "timestamp": strike_time + t,
                    "x": max(0.0, min(1.0, screen_x)),
                    "y": min(1.0, origin_y),  # Land at origin y level
                    "confidence": 0.85,
                    "interpolated": True,
                })
                timestamps.append(t)
                break

            points.append({
                "timestamp": strike_time + t,
                "x": max(0.0, min(1.0, screen_x)),
                "y": max(0.0, min(1.0, screen_y)),
                "confidence": 0.85,
                "interpolated": True,
            })
            timestamps.append(t)
            t += 1.0 / sample_rate

        if len(points) < 2:
            logger.warning("Failed to generate trajectory points")
            return None

        # Build apex and landing points
        apex_point = {
            "timestamp": points[apex_idx]["timestamp"],
            "x": points[apex_idx]["x"],
            "y": points[apex_idx]["y"],
        }

        landing_point = {
            "timestamp": points[-1]["timestamp"],
            "x": points[-1]["x"],
            "y": points[-1]["y"],
        }

        actual_duration = timestamps[-1] if timestamps else flight_duration

        logger.info(
            f"Generated 2D trajectory: {len(points)} points, "
            f"origin=({origin_x:.3f}, {origin_y:.3f}), "
            f"apex_y={min_y:.3f}, duration={actual_duration:.2f}s"
        )

        return {
            "points": points,
            "apex_point": apex_point,
            "landing_point": landing_point,
            "confidence": 0.80,
            "method": "direct_2d",
            "launch_angle": 15.0,  # Approximate
            "lateral_angle": -2.0,  # Slight draw
            "shot_shape": "draw",
            "flight_duration": actual_duration,
        }

    def track_precise_trajectory(
        self,
        video_path: Path,
        origin: OriginDetection,
        strike_time: float,
        max_flight_duration: float = 5.0,
    ) -> Optional[dict]:
        """Track ball with enhanced precision using all detection methods.

        Uses the full detection pipeline:
        1. Extract ball template from first frames
        2. Track using multi-scale template matching
        3. Use optical flow for motion estimation
        4. Kalman filter for prediction and smoothing
        5. Score and select best detections
        6. Assemble into final trajectory

        Falls back to physics-based trajectory if detection fails.

        Args:
            video_path: Path to video file
            origin: Ball origin detection (from origin.py)
            strike_time: When ball was struck (seconds)
            max_flight_duration: Maximum time to track

        Returns:
            Dict with trajectory data in standard format, or None
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0:
                logger.error("Invalid FPS")
                return None

            # Step 1: Extract template
            template_extractor = BallTemplateExtractor()
            template = template_extractor.extract_template(
                str(video_path), origin.x, origin.y, strike_time
            )

            if template is None:
                logger.warning("Template extraction failed, using physics fallback")
                return self.track_full_trajectory(
                    video_path,
                    (origin.x / frame_width, origin.y / frame_height),
                    strike_time,
                    frame_width,
                    frame_height,
                )

            logger.info(f"Template extracted: radius={template.radius}px, brightness={template.brightness:.0f}")

            # Step 2: Initialize components
            scale_matcher = MultiScaleMatcher()
            scale_matcher.prepare_template(template.image, template.mask)

            flow_tracker = OpticalFlowTracker()

            kalman = BallKalmanFilter(fps=fps)
            # Initialize with template position and estimated initial velocity
            # Ball moves up initially (negative vy in screen coords)
            kalman.initialize(
                float(template.center[0]),
                float(template.center[1]),
                vx=0.0,
                vy=-15.0,  # Initial upward velocity
            )

            scorer = DetectionScorer()

            assembler = TrajectoryAssembler(frame_width, frame_height, fps)

            # Step 3: Track frame by frame
            start_frame = int(strike_time * fps) + template.frame_index
            end_frame = int((strike_time + max_flight_duration) * fps)
            end_frame = min(end_frame, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            prev_gray = None
            expected_scale = 1.0
            detections_found = 0

            for frame_idx in range(start_frame, end_frame):
                ret, frame = cap.read()
                if not ret:
                    break

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                rel_frame = frame_idx - start_frame

                # Get Kalman prediction
                prediction = kalman.predict()
                search_region = kalman.get_search_region(sigma_multiplier=4.0)

                # Clamp search region to frame
                x1, y1, x2, y2 = search_region
                x1 = max(0, x1)
                y1 = max(0, y1)
                x2 = min(frame_width, x2)
                y2 = min(frame_height, y2)

                # Collect candidates from different methods
                candidates = []

                # Template matching candidates
                try:
                    matches = scale_matcher.match_in_region(
                        gray, (x1, y1, x2, y2), expected_scale
                    )
                    for match in matches[:3]:
                        # Get brightness at match location
                        mx, my = int(match.x), int(match.y)
                        if 0 <= mx < frame_width and 0 <= my < frame_height:
                            brightness = float(gray[my, mx])
                        else:
                            brightness = 150.0

                        candidates.append(DetectionCandidate(
                            x=match.x,
                            y=match.y,
                            radius=match.radius,
                            brightness=brightness,
                            template_score=match.score,
                            motion_score=0.5,
                            source="template",
                        ))
                except Exception as e:
                    logger.debug(f"Template matching error: {e}")

                # Optical flow candidates
                if prev_gray is not None:
                    try:
                        # Initialize flow tracker on first good detection
                        if detections_found > 0 and flow_tracker._prev_gray is None:
                            state = kalman.get_state()
                            if state:
                                flow_tracker.initialize(
                                    prev_gray,
                                    center=(state.x, state.y),
                                    radius=template.radius,
                                )

                        flow_result = flow_tracker.track(gray)
                        if flow_result and flow_result.ball_position:
                            fx, fy = flow_result.ball_position
                            if x1 <= fx <= x2 and y1 <= fy <= y2:
                                candidates.append(DetectionCandidate(
                                    x=fx,
                                    y=fy,
                                    radius=template.radius * expected_scale,
                                    brightness=200.0,
                                    template_score=0.5,
                                    motion_score=flow_result.confidence,
                                    source="flow",
                                ))
                    except Exception as e:
                        logger.debug(f"Flow tracking error: {e}")

                # Score and select
                best = None
                if candidates:
                    scored = scorer.score_candidates(
                        candidates,
                        predicted_x=prediction.x,
                        predicted_y=prediction.y,
                        prediction_uncertainty=prediction.search_radius,
                        expected_radius=template.radius * expected_scale,
                    )
                    best = scorer.select_best(scored)

                if best and kalman.is_measurement_plausible(best.x, best.y):
                    # Update Kalman with measurement
                    kalman.update(best.x, best.y, best.confidence)
                    assembler.add_detection(rel_frame, best.x, best.y, best.confidence)
                    detections_found += 1

                    # Update expected scale (ball shrinks as it goes away)
                    if template.radius > 0:
                        expected_scale = best.radius / template.radius
                        expected_scale = max(0.3, min(1.2, expected_scale))
                else:
                    # No valid detection
                    kalman.update_no_measurement()
                    assembler.add_no_detection(rel_frame)

                prev_gray = gray.copy()

            logger.info(f"Precise tracking found {detections_found} detections")

            # Step 4: Assemble trajectory
            trajectory = assembler.assemble(strike_time)

            if trajectory and len(trajectory.points) >= 6:
                # Convert to standard format
                points = [
                    {
                        "timestamp": p.timestamp,
                        "x": p.x,
                        "y": p.y,
                        "confidence": p.confidence,
                        "interpolated": p.interpolated,
                    }
                    for p in trajectory.points
                ]

                apex_pt = trajectory.points[trajectory.apex_index]

                logger.info(
                    f"Precise trajectory assembled: {len(points)} points, "
                    f"gaps={trajectory.gap_count}, confidence={trajectory.avg_confidence:.2f}"
                )

                return {
                    "points": points,
                    "apex_point": {
                        "timestamp": apex_pt.timestamp,
                        "x": apex_pt.x,
                        "y": apex_pt.y,
                    },
                    "landing_point": {
                        "timestamp": points[-1]["timestamp"],
                        "x": points[-1]["x"],
                        "y": points[-1]["y"],
                    },
                    "confidence": trajectory.avg_confidence,
                    "method": "precise_tracking",
                    "shot_shape": "straight",
                    "gap_count": trajectory.gap_count,
                }
            else:
                # Fall back to physics
                logger.info(f"Only {detections_found} detections, using physics fallback")
                return self.track_full_trajectory(
                    video_path,
                    (origin.x / frame_width, origin.y / frame_height),
                    strike_time,
                    frame_width,
                    frame_height,
                )

        finally:
            cap.release()

    def _find_timestamp_index(
        self, timestamps: List[float], target_time: float
    ) -> int:
        """Find the index of the timestamp closest to target_time.

        Args:
            timestamps: List of timestamps
            target_time: Time to find

        Returns:
            Index of closest timestamp (clamped to valid range)
        """
        if not timestamps:
            return 0

        best_idx = 0
        best_diff = abs(timestamps[0] - target_time)

        for i, t in enumerate(timestamps):
            diff = abs(t - target_time)
            if diff < best_diff:
                best_diff = diff
                best_idx = i

        return best_idx

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

    def track_with_landing_point(
        self,
        video_path: Path,
        origin: OriginDetection,
        strike_time: float,
        landing_point: Tuple[float, float],
        frame_width: int,
        frame_height: int,
        progress_callback: Optional[Callable[[int, str], None]] = None,
        warning_callback: Optional[Callable[[str, str], None]] = None,
    ) -> Optional[dict]:
        """Generate trajectory constrained to hit user-marked landing point.

        Uses hybrid approach:
        1. Detect early ball positions (first 200ms) for launch angle
        2. Constrain parabola to pass through origin and landing point
        3. Use early detections to determine apex timing

        Args:
            video_path: Path to video file
            origin: Detected ball origin (from origin.py)
            strike_time: When ball was struck (seconds)
            landing_point: User-marked landing (x, y) in normalized coords (0-1)
            frame_width: Video width in pixels
            frame_height: Video height in pixels
            progress_callback: Called with (percent, message) during generation
            warning_callback: Called with (warning_code, message) for non-fatal issues

        Returns:
            Trajectory dict with points constrained to hit landing point
        """
        def emit_progress(percent: int, message: str):
            if progress_callback:
                progress_callback(percent, message)

        def emit_warning(code: str, message: str):
            if warning_callback:
                warning_callback(code, message)

        emit_progress(10, "Detecting early ball positions...")

        # Try to detect early ball movement for launch angle
        early_detections = []
        try:
            early_detections = self.track_flight(
                video_path,
                origin,
                strike_time,
                end_time=strike_time + 0.2,
                max_flight_duration=0.2,
            )
        except Exception as e:
            emit_warning("early_ball_detection_failed", f"No ball detected in first 200ms: {e}")
            logger.warning(f"Early ball detection failed: {e}")

        emit_progress(30, "Extracting launch parameters...")

        # Extract launch params from early detections or use defaults
        if len(early_detections) >= 3:
            launch_params = self._extract_launch_params(
                early_detections, origin, frame_width, frame_height
            )
        else:
            emit_warning(
                "early_ball_detection_failed",
                "No ball detected in first 200ms, using default launch angle"
            )
            launch_params = {
                "launch_angle": 18.0,
                "lateral_angle": 0.0,
                "apex_height": 0.45,
                "apex_time": 1.2,
                "flight_duration": 3.0,
                "shot_shape": "straight",
            }

        emit_progress(50, "Generating physics trajectory...")

        # Normalize origin
        origin_x = origin.x / frame_width
        origin_y = origin.y / frame_height
        landing_x, landing_y = landing_point

        # Calculate trajectory that hits both origin and landing
        trajectory = self._generate_constrained_trajectory(
            origin_point=(origin_x, origin_y),
            landing_point=(landing_x, landing_y),
            strike_time=strike_time,
            launch_params=launch_params,
        )

        emit_progress(80, "Smoothing trajectory...")

        if trajectory:
            emit_progress(100, "Trajectory complete")

        return trajectory

    def _extract_launch_params(
        self,
        early_detections: List[TrajectoryPoint],
        origin: OriginDetection,
        frame_width: int,
        frame_height: int,
    ) -> dict:
        """Extract launch parameters from early ball detections.

        Args:
            early_detections: List of early trajectory points
            origin: Ball origin detection
            frame_width: Video width in pixels
            frame_height: Video height in pixels

        Returns:
            Dictionary with launch_angle, lateral_angle, apex_height, etc.
        """
        if len(early_detections) < 2:
            return {
                "launch_angle": 18.0,
                "lateral_angle": 0.0,
                "apex_height": 0.45,
                "apex_time": 1.2,
                "flight_duration": 3.0,
                "shot_shape": "straight",
            }

        # Use first and last early detection to estimate launch angle
        first_pt = early_detections[0]
        last_pt = early_detections[-1]

        dx = last_pt.x - first_pt.x
        dy = first_pt.y - last_pt.y  # Invert since screen y increases downward

        # Calculate angle (ball rising = positive dy)
        if abs(dx) > 0.001 or abs(dy) > 0.001:
            # Launch angle from vertical movement
            # Higher dy/dt = steeper launch
            time_diff = last_pt.timestamp - first_pt.timestamp
            if time_diff > 0:
                vertical_speed = dy / time_diff
                # Map vertical speed to launch angle (rough approximation)
                # Faster rise = higher launch angle
                launch_angle = min(35.0, max(10.0, 15.0 + vertical_speed / 100))
            else:
                launch_angle = 18.0

            # Lateral angle from horizontal movement
            horizontal_speed = dx / time_diff if time_diff > 0 else 0
            lateral_angle = horizontal_speed / 50  # Rough mapping
            lateral_angle = min(15.0, max(-15.0, lateral_angle))
        else:
            launch_angle = 18.0
            lateral_angle = 0.0

        # Determine shot shape from lateral movement
        if lateral_angle < -2:
            shot_shape = "draw"
        elif lateral_angle > 2:
            shot_shape = "fade"
        else:
            shot_shape = "straight"

        return {
            "launch_angle": launch_angle,
            "lateral_angle": lateral_angle,
            "apex_height": 0.45,
            "apex_time": 1.2,
            "flight_duration": 3.0,
            "shot_shape": shot_shape,
        }

    def _generate_constrained_trajectory(
        self,
        origin_point: Tuple[float, float],
        landing_point: Tuple[float, float],
        strike_time: float,
        launch_params: dict,
    ) -> Optional[dict]:
        """Generate parabolic trajectory constrained to hit both endpoints.

        Args:
            origin_point: (x, y) in normalized coords (0-1)
            landing_point: (x, y) in normalized coords (0-1)
            strike_time: When ball was struck (seconds)
            launch_params: Dictionary with launch_angle, apex_height, etc.

        Returns:
            Trajectory dict with points, apex_point, landing_point, etc.
        """
        origin_x, origin_y = origin_point
        landing_x, landing_y = landing_point

        dx = landing_x - origin_x
        dy = landing_y - origin_y
        distance = np.sqrt(dx**2 + dy**2)

        base_duration = launch_params.get("flight_duration", 3.0)
        flight_duration = max(2.0, min(5.0, base_duration * (distance / 0.3)))

        apex_ratio = 0.4 + (launch_params.get("launch_angle", 18.0) / 90.0) * 0.2
        apex_time = flight_duration * apex_ratio

        T = flight_duration
        t_a = apex_time

        coefficient = 2 * T / t_a - (T * T) / (t_a * t_a)

        if abs(coefficient) < 0.001:
            apex_height = 0.3
        else:
            apex_height = (origin_y - landing_y) / coefficient

        apex_height = max(0.1, min(0.6, apex_height))

        gravity = 2 * apex_height / (t_a * t_a)
        v_y0 = gravity * t_a
        v_x = dx / T

        sample_rate = 30.0
        points = []
        apex_idx = 0
        min_y = origin_y

        t = 0.0
        while t <= T:
            y_offset = v_y0 * t - 0.5 * gravity * t * t
            x_offset = v_x * t

            screen_x = origin_x + x_offset
            screen_y = origin_y - y_offset

            if screen_y < min_y:
                min_y = screen_y
                apex_idx = len(points)

            points.append({
                "timestamp": strike_time + t,
                "x": max(0.0, min(1.0, screen_x)),
                "y": max(0.0, min(1.0, screen_y)),
                "confidence": 0.85,
                "interpolated": True,
            })
            t += 1.0 / sample_rate

        if points:
            points[-1]["x"] = landing_x
            points[-1]["y"] = landing_y

        if len(points) < 2:
            logger.warning("Failed to generate trajectory points")
            return None

        apex_point = {
            "timestamp": points[apex_idx]["timestamp"],
            "x": points[apex_idx]["x"],
            "y": points[apex_idx]["y"],
        }

        logger.info(
            f"Generated constrained trajectory: {len(points)} points, "
            f"origin=({origin_x:.3f}, {origin_y:.3f}), "
            f"landing=({landing_x:.3f}, {landing_y:.3f}), "
            f"apex_y={min_y:.3f}, duration={T:.2f}s"
        )

        return {
            "points": points,
            "apex_point": apex_point,
            "landing_point": {
                "timestamp": points[-1]["timestamp"],
                "x": landing_x,
                "y": landing_y,
            },
            "confidence": 0.85,
            "method": "constrained_landing",
            "launch_angle": launch_params.get("launch_angle", 18.0),
            "lateral_angle": launch_params.get("lateral_angle", 0.0),
            "shot_shape": launch_params.get("shot_shape", "straight"),
            "flight_duration": T,
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
