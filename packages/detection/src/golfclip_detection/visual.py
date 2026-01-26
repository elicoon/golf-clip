"""Visual analysis for detecting golf balls using YOLO."""

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Union, overload

import cv2
import numpy as np
import torch
from loguru import logger
from ultralytics import YOLO

from .config import settings

# Global flag to track model download status
_model_ready: bool = False


def _download_model_sync() -> bool:
    """Synchronous implementation of model download.

    Downloads the model to the configured models directory.

    Returns:
        True if model is ready (exists or downloaded successfully),
        False if download failed.
    """
    global _model_ready

    model_path = settings.models_dir / settings.yolo_model

    # Already downloaded
    if model_path.exists():
        logger.info(f"YOLO model already exists at {model_path}")
        _model_ready = True
        return True

    # Ensure models directory exists
    settings.models_dir.mkdir(parents=True, exist_ok=True)

    try:
        logger.info(f"Downloading YOLO model {settings.yolo_model} to {model_path}...")
        # Pass full path to YOLO - it will download to this location
        YOLO(str(model_path))
        logger.info(f"YOLO model downloaded successfully to {model_path}")
        _model_ready = True
        return True
    except Exception as e:
        logger.warning(f"Failed to download YOLO model: {e}")
        _model_ready = False
        return False


async def ensure_model_downloaded() -> bool:
    """Pre-download the YOLO model if not already present.

    Downloads the model to the configured models directory.
    This should be called during app startup to avoid delays
    during first video processing.

    Runs in a thread to avoid blocking the event loop.

    Returns:
        True if model is ready (exists or downloaded successfully),
        False if download failed.
    """
    return await asyncio.to_thread(_download_model_sync)


def is_model_ready() -> bool:
    """Check if the YOLO model has been downloaded.

    Uses cached value if available to avoid repeated filesystem checks.

    Returns:
        True if model file exists.
    """
    global _model_ready
    if _model_ready:
        return True
    _model_ready = (settings.models_dir / settings.yolo_model).exists()
    return _model_ready


def get_model_status() -> dict:
    """Get detailed model status information.

    Returns:
        Dictionary with model status details.
    """
    model_path = settings.models_dir / settings.yolo_model
    downloaded = model_path.exists()

    result = {
        "downloaded": downloaded,
        "model_name": settings.yolo_model,
        "path": str(model_path),
        "size_mb": 0.0,
    }

    if downloaded:
        size_bytes = model_path.stat().st_size
        result["size_mb"] = round(size_bytes / (1024 * 1024), 2)

    return result


@dataclass
class BallDetection:
    """Represents a detected golf ball in a frame."""

    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    confidence: float
    center: tuple[float, float]
    size: tuple[float, float]  # width, height

    def to_dict(self) -> dict:
        """Convert to dictionary format."""
        return {
            "bbox": list(self.bbox),
            "confidence": self.confidence,
            "center": list(self.center),
            "size": list(self.size),
        }


@dataclass
class TrajectoryPoint:
    """A point in the ball's trajectory."""

    timestamp: float
    x: float
    y: float
    confidence: float
    interpolated: bool = False


@dataclass
class FlightAnalysis:
    """Analysis results for a ball flight trajectory."""

    trajectory: list[TrajectoryPoint]
    confidence: float
    smoothness_score: float
    physics_plausibility: float
    apex_point: Optional[TrajectoryPoint]
    estimated_launch_angle: Optional[float]
    flight_duration: Optional[float]
    has_gaps: bool
    gap_count: int


@dataclass
class GolferDetection:
    """Detected golfer position in a frame."""

    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    confidence: float
    center: tuple[float, float]
    feet_position: tuple[float, float]  # Estimated ball strike zone


class TrajectoryFilter:
    """Filters and validates golf ball trajectories.

    Golf ball trajectories have specific characteristics:
    1. Start from near the golfer's feet (ball origin zone)
    2. Follow a parabolic arc (rise then fall due to gravity)
    3. Move predominantly in one horizontal direction
    4. Have smooth, continuous motion
    """

    # Minimum height the ball must rise (as fraction of frame height)
    MIN_RISE_RATIO = 0.03  # Ball must rise at least 3% of frame height

    # Maximum deviation from parabolic fit (pixels)
    MAX_PARABOLA_DEVIATION = 150

    # Minimum horizontal displacement (as fraction of frame width)
    MIN_HORIZONTAL_TRAVEL = 0.03  # Ball must travel at least 3% of frame width (~115px at 4K)

    # Ball origin zone around golfer's feet (as fraction of frame dimensions)
    # These are generous to handle various camera angles and zoom levels
    ORIGIN_ZONE_WIDTH = 0.4  # 40% of frame width around feet
    ORIGIN_ZONE_HEIGHT = 0.3  # 30% of frame height (ball can start anywhere below apex)

    # Minimum movement to be considered "in flight" (as fraction of frame)
    MIN_MOVEMENT_PER_FRAME = 0.005  # ~19px at 4K

    # Maximum allowed "large jumps" in a valid trajectory
    MAX_JUMP_RATIO = 0.15  # If more than 15% of points have large jumps, reject

    @staticmethod
    def filter_stationary_detections(
        detections: list[dict],
        min_movement: float = 0.02,  # 2% of frame
        frame_width: int = 3840,
        frame_height: int = 2160,
    ) -> list[dict]:
        """Remove stationary clusters (ball on tee) and keep in-flight detections.

        Strategy:
        1. Cluster detections by spatial proximity
        2. Identify the "stationary cluster" (largest cluster at bottom of frame)
        3. Remove all detections in the stationary cluster
        4. Keep detections that are in different positions (actually in flight)

        Args:
            detections: List of detections with position data
            min_movement: Minimum normalized movement to be considered separate
            frame_width: Video frame width
            frame_height: Video frame height

        Returns:
            Filtered list with stationary cluster removed
        """
        valid_detections = [d for d in detections if d["detection"] is not None]
        if len(valid_detections) < 3:
            return valid_detections

        # Sort by timestamp
        valid_detections.sort(key=lambda d: d["timestamp"])

        # Cluster radius in pixels
        cluster_radius = min_movement * frame_width

        # Find clusters by spatial proximity
        clusters: list[list[dict]] = []
        for det in valid_detections:
            center = det["detection"]["center"]
            found_cluster = False

            for cluster in clusters:
                # Check distance to first point in cluster
                cluster_center = cluster[0]["detection"]["center"]
                dx = abs(center[0] - cluster_center[0])
                dy = abs(center[1] - cluster_center[1])
                dist = (dx ** 2 + dy ** 2) ** 0.5

                if dist <= cluster_radius:
                    cluster.append(det)
                    found_cluster = True
                    break

            if not found_cluster:
                clusters.append([det])

        if not clusters:
            return valid_detections

        # Find the "stationary" cluster: largest cluster where detections don't move much
        # A stationary ball (on tee) will have many detections clustered tightly over time
        stationary_cluster = None
        max_stationary_size = 0

        for cluster in clusters:
            if len(cluster) < 5:  # Need at least 5 detections to be confident it's stationary
                continue

            # Check how tightly clustered these detections are spatially
            xs = [d["detection"]["center"][0] for d in cluster]
            ys = [d["detection"]["center"][1] for d in cluster]
            x_range = max(xs) - min(xs)
            y_range = max(ys) - min(ys)

            # If detections span less than 2% of frame dimensions, it's stationary
            is_tight = x_range < frame_width * 0.02 and y_range < frame_height * 0.02

            if is_tight and len(cluster) > max_stationary_size:
                max_stationary_size = len(cluster)
                stationary_cluster = cluster

        # Filter out detections in the stationary cluster
        if stationary_cluster:
            # Log the stationary cluster position
            avg_x = sum(d["detection"]["center"][0] for d in stationary_cluster) / len(stationary_cluster)
            avg_y = sum(d["detection"]["center"][1] for d in stationary_cluster) / len(stationary_cluster)
            stationary_set = set(id(d) for d in stationary_cluster)
            moving_detections = [d for d in valid_detections if id(d) not in stationary_set]
            logger.debug(
                f"Stationary filter: removed {len(stationary_cluster)} tee detections "
                f"at ({avg_x:.0f},{avg_y:.0f}), keeping {len(moving_detections)} potential flight detections"
            )
            return moving_detections

        logger.debug(
            f"Stationary filter: no tight stationary cluster found, "
            f"keeping all {len(valid_detections)} detections"
        )
        return valid_detections

    @staticmethod
    def filter_noisy_trajectory(
        points: list[TrajectoryPoint],
        frame_width: int,
        frame_height: int,
        max_jump_ratio: float = 0.50,
    ) -> Optional[list[TrajectoryPoint]]:
        """Filter out trajectories with erratic, non-directional movement.

        Golf balls move FAST (150+ mph) and YOLO detection is sparse,
        so large per-frame jumps are EXPECTED. What we filter for is:
        1. Random back-and-forth movement (not consistent direction)
        2. Extreme jumps that can't be real ball movement

        Args:
            points: Trajectory points
            frame_width: Frame width
            frame_height: Frame height
            max_jump_ratio: Maximum ratio of extreme jumps allowed

        Returns:
            Filtered points if valid, None if too noisy
        """
        if len(points) < 4:
            return None

        # Count EXTREME jumps (>25% of frame diagonal per frame)
        # A golf ball at 150mph moves ~7ft per 30fps frame
        # At typical distances this could be 10-20% of frame
        diag = (frame_width ** 2 + frame_height ** 2) ** 0.5
        extreme_jump_threshold = 0.25 * diag  # 25% of diagonal is extreme
        extreme_jumps = 0

        # Also track direction consistency
        x_directions = []
        y_directions = []

        for i in range(1, len(points)):
            # Points are already in pixel coordinates, no need to multiply
            dx = points[i].x - points[i - 1].x
            dy = points[i].y - points[i - 1].y
            dist = (dx ** 2 + dy ** 2) ** 0.5

            if dist > extreme_jump_threshold:
                extreme_jumps += 1

            # Track movement direction
            if abs(dx) > 10:  # Only count significant movement (10 pixels)
                x_directions.append(1 if dx > 0 else -1)
            if abs(dy) > 10:
                y_directions.append(1 if dy > 0 else -1)

        # Reject if too many extreme jumps
        extreme_ratio = extreme_jumps / (len(points) - 1)
        if extreme_ratio > max_jump_ratio:
            logger.debug(
                f"Trajectory rejected: too many extreme jumps ({extreme_jumps}, "
                f"{extreme_ratio:.1%} of transitions)"
            )
            return None

        # Reject if X direction is too inconsistent (ball should travel mostly one way)
        if len(x_directions) >= 3:
            x_consistency = sum(1 for d in x_directions if d == x_directions[0]) / len(x_directions)
            if x_consistency < 0.5:
                logger.debug(
                    f"Trajectory rejected: inconsistent X direction ({x_consistency:.1%} consistent)"
                )
                return None

        return points

    @staticmethod
    def is_parabolic_trajectory(
        points: list[TrajectoryPoint],
        frame_height: int,
        frame_width: int,
    ) -> tuple[bool, float, Optional[TrajectoryPoint]]:
        """Check if trajectory follows golf ball physics.

        Golf ball trajectories follow a parabolic arc, but YOLO often only
        captures part of the flight (usually the descent, as the ball slows).
        We accept trajectories that show:
        1. Full parabola (rise + fall) - ideal case
        2. Smooth descent only - common when we miss the initial launch
        3. Smooth rise only - rare but possible

        Args:
            points: List of trajectory points sorted by timestamp
            frame_height: Video frame height in pixels
            frame_width: Video frame width in pixels

        Returns:
            Tuple of (is_valid, confidence, apex_point)
        """
        if len(points) < 4:
            return False, 0.0, None

        # Extract coordinates (note: Y increases downward in image coords)
        y_coords = np.array([p.y for p in points])
        x_coords = np.array([p.x for p in points])
        timestamps = np.array([p.timestamp for p in points])

        # Calculate vertical displacement
        start_y = y_coords[0]
        end_y = y_coords[-1]
        vertical_change = abs(end_y - start_y)

        # Check 1: Must have either vertical OR horizontal movement
        horizontal_travel = abs(x_coords[-1] - x_coords[0])
        min_vertical = frame_height * 0.02  # At least 2% of frame height
        min_horizontal = frame_width * TrajectoryFilter.MIN_HORIZONTAL_TRAVEL

        has_vertical_motion = vertical_change >= min_vertical
        has_horizontal_motion = horizontal_travel >= min_horizontal

        if not has_vertical_motion and not has_horizontal_motion:
            logger.debug(
                f"Trajectory rejected: insufficient motion "
                f"(vertical={vertical_change:.0f}px, horizontal={horizontal_travel:.0f}px)"
            )
            return False, 0.0, None

        # Check 3: Trajectory should be smooth (fit a curve)
        t_norm = (timestamps - timestamps[0]) / max(timestamps[-1] - timestamps[0], 1e-6)
        try:
            # Fit a quadratic (parabolic) curve
            coeffs = np.polyfit(t_norm, y_coords, 2)
            y_fitted = np.polyval(coeffs, t_norm)
            residuals = np.abs(y_coords - y_fitted)
            mean_deviation = np.mean(residuals)

            # Calculate fit quality
            ss_res = np.sum((y_coords - y_fitted) ** 2)
            ss_tot = np.sum((y_coords - np.mean(y_coords)) ** 2)
            r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0

            if mean_deviation > TrajectoryFilter.MAX_PARABOLA_DEVIATION:
                logger.debug(f"Trajectory rejected: poor curve fit (dev={mean_deviation:.1f}px)")
                return False, 0.0, None

            if r_squared < 0.5:
                logger.debug(f"Trajectory rejected: poor R² fit ({r_squared:.3f})")
                return False, 0.0, None

        except (np.linalg.LinAlgError, ValueError):
            return False, 0.0, None

        # Check 4: X coordinates should be mostly monotonic (ball travels in one direction)
        x_direction = np.sign(np.diff(x_coords))
        x_consistency = np.sum(x_direction == x_direction[0]) / len(x_direction)
        if x_consistency < 0.6:  # At least 60% should move in same direction
            logger.debug(f"Trajectory rejected: inconsistent X direction ({x_consistency:.2f})")
            return False, 0.0, None

        # Find the apex (highest point = minimum Y in image coords)
        apex_idx = np.argmin(y_coords)
        apex_point = points[apex_idx]

        # Determine trajectory type for confidence scoring
        # Full parabola: apex in middle
        # Descent only: apex at start
        # Rise only: apex at end
        is_full_parabola = 2 <= apex_idx <= len(points) - 3
        is_descent = apex_idx < 2  # Apex at start = we caught descent
        is_rise = apex_idx > len(points) - 3  # Apex at end = we caught rise

        # Confidence based on fit quality and trajectory type
        base_confidence = r_squared * 0.5 + x_consistency * 0.3

        if is_full_parabola:
            # Best case - we see both rise and fall
            confidence = min(1.0, base_confidence + 0.2)
            trajectory_type = "full parabola"
        elif is_descent:
            # Common case - we caught the ball descending
            # Check that ball is actually falling (Y increasing over time)
            y_trend = np.polyfit(range(len(y_coords)), y_coords, 1)[0]
            if y_trend > 0:  # Y increasing = falling in image coords
                confidence = min(1.0, base_confidence + 0.1)
                trajectory_type = "descent"
            else:
                logger.debug("Trajectory rejected: apex at start but Y decreasing")
                return False, 0.0, None
        elif is_rise:
            # Rare case - we caught the ball rising
            y_trend = np.polyfit(range(len(y_coords)), y_coords, 1)[0]
            if y_trend < 0:  # Y decreasing = rising in image coords
                confidence = min(1.0, base_confidence + 0.1)
                trajectory_type = "rise"
            else:
                logger.debug("Trajectory rejected: apex at end but Y increasing")
                return False, 0.0, None
        else:
            confidence = base_confidence
            trajectory_type = "partial"

        logger.debug(
            f"Valid trajectory ({trajectory_type}): vertical={vertical_change:.0f}px, "
            f"travel={horizontal_travel:.0f}px, r²={r_squared:.3f}, x_consistency={x_consistency:.2f}"
        )

        return True, confidence, apex_point

    @staticmethod
    def filter_by_origin_zone(
        points: list[TrajectoryPoint],
        golfer_feet: Optional[tuple[float, float]],
        frame_width: int,
        frame_height: int,
    ) -> bool:
        """Check if trajectory starts from a plausible ball origin.

        Since we may catch the ball mid-flight (after it's already risen),
        we're lenient here and mainly check that the trajectory starts
        in a reasonable part of the frame (not at the very top).

        Args:
            points: Trajectory points
            golfer_feet: (x, y) position of golfer's feet, or None if unknown
            frame_width: Frame width
            frame_height: Frame height

        Returns:
            True if trajectory origin is valid
        """
        if not points:
            return False

        start_x, start_y = points[0].x, points[0].y

        # Basic sanity check: trajectory shouldn't start at very top of frame
        # (that would mean we caught the ball descending from off-screen)
        if start_y < frame_height * 0.15:
            logger.debug(
                f"Trajectory rejected: origin ({start_x:.0f},{start_y:.0f}) "
                f"too high in frame (likely ball descending)"
            )
            return False

        if golfer_feet is None:
            # Without golfer detection, accept trajectories starting in lower 85%
            return True

        feet_x, feet_y = golfer_feet

        # Check if start point is within a generous zone around the golfer
        # Golf videos can have various angles, so we allow wide horizontal range
        zone_width = frame_width * TrajectoryFilter.ORIGIN_ZONE_WIDTH
        zone_height = frame_height * TrajectoryFilter.ORIGIN_ZONE_HEIGHT

        x_ok = abs(start_x - feet_x) < zone_width

        # For Y: the ball could already be rising when we first detect it,
        # so we allow anywhere from feet level to well above
        # (but not at the very top of frame)
        y_ok = start_y >= feet_y - zone_height

        if not (x_ok and y_ok):
            logger.debug(
                f"Trajectory rejected: origin ({start_x:.0f},{start_y:.0f}) "
                f"outside zone around feet ({feet_x:.0f},{feet_y:.0f}), "
                f"zone_width={zone_width:.0f}, zone_height={zone_height:.0f}"
            )

        return x_ok and y_ok

    @staticmethod
    def cluster_into_trajectories(
        detections: list[dict],
        max_gap_seconds: float = 0.5,
        max_jump_pixels: float = 200,
    ) -> list[list[dict]]:
        """Cluster detections into separate potential trajectories.

        Breaks detections into segments when there are large time gaps
        or spatial jumps that indicate different objects/trajectories.
        Then attempts to merge nearby segments that could be the same trajectory
        interrupted by false positives.

        Args:
            detections: List of detections with timestamp and detection data
            max_gap_seconds: Max time gap before starting new trajectory
            max_jump_pixels: Max spatial jump before starting new trajectory

        Returns:
            List of trajectory segments (each is list of detections)
        """
        valid_detections = [d for d in detections if d["detection"] is not None]
        if len(valid_detections) < 2:
            return [valid_detections] if valid_detections else []

        # Sort by timestamp
        valid_detections.sort(key=lambda d: d["timestamp"])

        # First pass: basic clustering
        trajectories = []
        current_trajectory = [valid_detections[0]]

        for i in range(1, len(valid_detections)):
            prev = valid_detections[i - 1]
            curr = valid_detections[i]

            # Check time gap
            time_gap = curr["timestamp"] - prev["timestamp"]

            # Check spatial jump
            prev_center = prev["detection"]["center"]
            curr_center = curr["detection"]["center"]
            spatial_jump = np.sqrt(
                (curr_center[0] - prev_center[0]) ** 2 +
                (curr_center[1] - prev_center[1]) ** 2
            )

            # Start new trajectory if gap is too large
            if time_gap > max_gap_seconds or spatial_jump > max_jump_pixels:
                if len(current_trajectory) >= 1:
                    trajectories.append(current_trajectory)
                current_trajectory = [curr]
            else:
                current_trajectory.append(curr)

        # Don't forget the last trajectory
        if len(current_trajectory) >= 1:
            trajectories.append(current_trajectory)

        logger.debug(f"Initial clustering: {len(valid_detections)} detections into {len(trajectories)} segments")

        # Second pass: try to merge nearby segments that could be the same trajectory
        # Be conservative - only merge segments that are clearly continuous
        merged = TrajectoryFilter._merge_nearby_segments(
            trajectories,
            max_merge_gap_seconds=0.5,  # Only merge if time gap < 500ms
            max_merge_distance=400,  # Only merge if endpoints within 400px
        )

        logger.debug(f"After merging: {len(merged)} trajectory segments")
        return merged

    @staticmethod
    def _merge_nearby_segments(
        segments: list[list[dict]],
        max_merge_gap_seconds: float,
        max_merge_distance: float,
    ) -> list[list[dict]]:
        """Merge trajectory segments that appear to be the same trajectory.

        Args:
            segments: List of trajectory segments
            max_merge_gap_seconds: Max time gap to consider merging
            max_merge_distance: Max endpoint distance to consider merging

        Returns:
            List of merged segments
        """
        if len(segments) < 2:
            return segments

        # Sort segments by start time
        segments = sorted(segments, key=lambda s: s[0]["timestamp"])

        merged = []
        current = segments[0]

        for i in range(1, len(segments)):
            next_seg = segments[i]

            # Check if segments can be merged
            current_end = current[-1]
            next_start = next_seg[0]

            time_gap = next_start["timestamp"] - current_end["timestamp"]
            if time_gap > max_merge_gap_seconds:
                merged.append(current)
                current = next_seg
                continue

            # Check spatial distance between endpoints
            end_pos = current_end["detection"]["center"]
            start_pos = next_start["detection"]["center"]
            distance = np.sqrt(
                (start_pos[0] - end_pos[0]) ** 2 +
                (start_pos[1] - end_pos[1]) ** 2
            )

            if distance > max_merge_distance:
                merged.append(current)
                current = next_seg
                continue

            # Check if the merge would maintain trajectory direction
            # (ball should generally move in same X direction)
            if len(current) >= 2:
                current_x_dir = np.sign(
                    current[-1]["detection"]["center"][0] -
                    current[0]["detection"]["center"][0]
                )
                next_x_dir = np.sign(
                    next_seg[-1]["detection"]["center"][0] -
                    next_seg[0]["detection"]["center"][0]
                ) if len(next_seg) >= 2 else current_x_dir

                # If both have clear direction and they match, or one is unclear, merge
                if current_x_dir != 0 and next_x_dir != 0 and current_x_dir != next_x_dir:
                    merged.append(current)
                    current = next_seg
                    continue

            # Merge the segments
            logger.debug(
                f"Merging segments: [{current[0]['timestamp']:.2f}s - {current[-1]['timestamp']:.2f}s] + "
                f"[{next_seg[0]['timestamp']:.2f}s - {next_seg[-1]['timestamp']:.2f}s]"
            )
            current = current + next_seg

        merged.append(current)
        return merged


class BallDetector:
    """Detects golf balls in video frames using YOLO."""

    # COCO class IDs
    PERSON_CLASS = 0  # "person" in COCO - for golfer detection
    SPORTS_BALL_CLASS = 32  # "sports ball" in COCO

    # Golf ball size constraints (relative to frame)
    # Golf balls are small - typically 0.5-3% of frame width in 4K footage
    # At 4K (3840px wide), a 40px ball = 1% of frame width
    # We allow wider range to catch balls at various distances/zoom levels
    MIN_BALL_SIZE_RATIO = 0.005  # ~19px at 4K - very small ball far away
    MAX_BALL_SIZE_RATIO = 0.08  # ~307px at 4K - closer ball or stationary

    # Expected aspect ratio for golf ball (should be roughly circular)
    MIN_ASPECT_RATIO = 0.7
    MAX_ASPECT_RATIO = 1.4

    # Smoothness calculation normalization constant
    # This scales the acceleration variance to produce scores in 0-1 range
    # Higher values make the smoothness calculation more lenient
    SMOOTHNESS_VARIANCE_SCALE = 10000

    def __init__(
        self,
        model_path: Optional[Path] = None,
        confidence_threshold: Optional[float] = None,
    ):
        """Initialize the YOLO model.

        Args:
            model_path: Optional path to custom YOLO model weights
            confidence_threshold: Detection confidence threshold (0-1)
        """
        self.model: Optional[YOLO] = None
        self.device = self._get_device()
        self._model_path = model_path
        self.confidence_threshold = confidence_threshold or settings.yolo_confidence

        # Detection class IDs to look for
        self.target_classes = {self.SPORTS_BALL_CLASS}

        # Frame dimensions (set when first frame is processed)
        self._frame_width: Optional[int] = None
        self._frame_height: Optional[int] = None

    def _get_device(self) -> str:
        """Get the best available device for inference."""
        if torch.backends.mps.is_available():
            logger.info("Using MPS (Apple Silicon GPU)")
            return "mps"
        elif torch.cuda.is_available():
            logger.info("Using CUDA GPU")
            return "cuda"
        else:
            logger.info("Using CPU")
            return "cpu"

    def load_model(self) -> None:
        """Load the YOLO model."""
        if self.model is not None:
            return  # Already loaded

        if self._model_path:
            model_path = self._model_path
        else:
            model_path = settings.models_dir / settings.yolo_model

        # Ensure models directory exists
        model_path.parent.mkdir(parents=True, exist_ok=True)

        # Load model (downloads to model_path if not exists)
        if not model_path.exists():
            logger.info(f"Downloading YOLO model to {model_path}")
        else:
            logger.info(f"Loading YOLO model from {model_path}")

        # Pass full path - YOLO will download to this location if needed
        self.model = YOLO(str(model_path))

        # Move to appropriate device
        self.model.to(self.device)
        logger.info(f"YOLO model loaded successfully on {self.device}")

    def detect_golfer_in_frame(
        self,
        frame: np.ndarray,
    ) -> Optional[GolferDetection]:
        """Detect the golfer (person) in a frame.

        Uses YOLO person detection to find the golfer. In golf videos,
        we expect one primary person (the golfer) in the frame.

        Args:
            frame: BGR image as numpy array

        Returns:
            GolferDetection with position info, or None if no person found
        """
        if self.model is None:
            self.load_model()

        # Store frame dimensions
        self._frame_height, self._frame_width = frame.shape[:2]

        # Run inference with higher confidence for person detection
        results = self.model(frame, verbose=False, conf=0.3)

        persons = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])

                if cls != self.PERSON_CLASS:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()

                # Person should be reasonably sized (not too small/large)
                person_height = y2 - y1
                height_ratio = person_height / self._frame_height
                if height_ratio < 0.2 or height_ratio > 0.95:
                    continue

                center_x = (x1 + x2) / 2
                center_y = (y1 + y2) / 2

                # Feet position is at the bottom center of the bounding box
                feet_x = center_x
                feet_y = y2  # Bottom of person bbox

                persons.append(GolferDetection(
                    bbox=(float(x1), float(y1), float(x2), float(y2)),
                    confidence=conf,
                    center=(float(center_x), float(center_y)),
                    feet_position=(float(feet_x), float(feet_y)),
                ))

        if not persons:
            return None

        # Return the most confident person detection
        return max(persons, key=lambda p: p.confidence)

    def detect_golfer_at_time(
        self,
        video_path: Path,
        timestamp: float,
    ) -> Optional[GolferDetection]:
        """Detect the golfer at a specific timestamp in the video.

        Args:
            video_path: Path to video file
            timestamp: Time in seconds

        Returns:
            GolferDetection or None
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Failed to open video: {video_path}")
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0:
                return None

            frame_num = int(timestamp * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)

            ret, frame = cap.read()
            if not ret:
                return None

            return self.detect_golfer_in_frame(frame)
        finally:
            cap.release()

    def _is_valid_ball_detection(
        self,
        bbox: tuple[float, float, float, float],
        frame_width: int,
        frame_height: int,
    ) -> bool:
        """Check if detection has valid golf ball characteristics.

        Args:
            bbox: Bounding box (x1, y1, x2, y2)
            frame_width: Frame width in pixels
            frame_height: Frame height in pixels

        Returns:
            True if detection could be a golf ball
        """
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1

        # Check size relative to frame
        size_ratio = max(width, height) / frame_width
        if size_ratio < self.MIN_BALL_SIZE_RATIO:
            return False  # Too small - likely noise
        if size_ratio > self.MAX_BALL_SIZE_RATIO:
            return False  # Too large - not a golf ball

        # Check aspect ratio (golf balls should be roughly circular)
        if width > 0 and height > 0:
            aspect_ratio = width / height
            if aspect_ratio < self.MIN_ASPECT_RATIO or aspect_ratio > self.MAX_ASPECT_RATIO:
                return False  # Not circular enough

        return True

    @overload
    def detect_ball_in_frame(
        self,
        frame: np.ndarray,
        return_all: bool = False,
    ) -> Optional[dict]: ...

    @overload
    def detect_ball_in_frame(
        self,
        frame: np.ndarray,
        return_all: bool = True,
    ) -> list[dict]: ...

    def detect_ball_in_frame(
        self,
        frame: np.ndarray,
        return_all: bool = False,
    ) -> Union[Optional[dict], list[dict]]:
        """Detect golf ball in a single frame.

        Args:
            frame: BGR image as numpy array
            return_all: If True, return all valid detections; otherwise return best one

        Returns:
            Dict with 'bbox', 'confidence', 'center', 'size' if ball found, else None
            If return_all=True, returns list of all valid detections
        """
        if self.model is None:
            self.load_model()

        # Store frame dimensions
        self._frame_height, self._frame_width = frame.shape[:2]

        # Run inference
        results = self.model(frame, verbose=False, conf=self.confidence_threshold)

        valid_detections: list[BallDetection] = []

        # Process detections
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])

                # Check if it's a potential ball class
                if cls not in self.target_classes:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                bbox = (float(x1), float(y1), float(x2), float(y2))

                # Validate detection characteristics
                if not self._is_valid_ball_detection(
                    bbox, self._frame_width, self._frame_height
                ):
                    logger.debug(
                        f"Rejected detection: bbox=({x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}), "
                        f"conf={conf:.3f}, size_ratio={(x2-x1)/self._frame_width:.4f}"
                    )
                    continue

                logger.debug(
                    f"Valid ball detection: conf={conf:.3f}, "
                    f"center=({(x1+x2)/2:.0f},{(y1+y2)/2:.0f})"
                )

                center_x = (x1 + x2) / 2
                center_y = (y1 + y2) / 2
                width = x2 - x1
                height = y2 - y1

                detection = BallDetection(
                    bbox=bbox,
                    confidence=conf,
                    center=(float(center_x), float(center_y)),
                    size=(float(width), float(height)),
                )
                valid_detections.append(detection)

        if return_all:
            return [d.to_dict() for d in valid_detections]

        if not valid_detections:
            return None

        # Return highest confidence detection
        best = max(valid_detections, key=lambda d: d.confidence)
        return best.to_dict()

    def detect_ball_in_video_segment(
        self,
        video_path: Path,
        start_time: float,
        end_time: float,
        sample_fps: float = 10.0,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> list[dict]:
        """Detect ball positions in a video segment.

        Args:
            video_path: Path to video file
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            sample_fps: Frames per second to analyze (lower = faster)
            progress_callback: Optional callback for progress updates

        Returns:
            List of detections with 'timestamp', 'frame', 'detection' keys
        """
        if self.model is None:
            self.load_model()

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Failed to open video: {video_path}")
            return []

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0:
                logger.error(f"Invalid FPS from video: {fps}")
                return []

            # Calculate frame interval for sampling
            frame_interval = max(1, int(fps / sample_fps))

            detections = []
            start_frame = int(start_time * fps)
            end_frame = int(end_time * fps)
            total_frames = max(1, end_frame - start_frame)

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            frame_count = 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                current_frame = start_frame + frame_count
                if current_frame >= end_frame:
                    break

                # Only process every Nth frame
                if frame_count % frame_interval == 0:
                    timestamp = current_frame / fps
                    detection = self.detect_ball_in_frame(frame)

                    detections.append(
                        {
                            "timestamp": timestamp,
                            "frame": current_frame,
                            "detection": detection,
                        }
                    )

                    if progress_callback:
                        progress = (frame_count / total_frames) * 100
                        progress_callback(min(100.0, progress))

                frame_count += 1

            return detections
        finally:
            cap.release()

    def track_ball_flight(
        self,
        detections: list[dict],
        interpolate_gaps: bool = True,
        max_gap_frames: int = 5,
    ) -> tuple[list[dict], float]:
        """Analyze ball detections to track flight path.

        Args:
            detections: List of frame detections from detect_ball_in_video_segment
            interpolate_gaps: Whether to fill small gaps with interpolated points
            max_gap_frames: Maximum gap size to interpolate

        Returns:
            Tuple of (trajectory points, confidence score)
        """
        # Filter to frames where ball was detected
        valid_detections = [d for d in detections if d["detection"] is not None]

        if len(valid_detections) < 2:
            return [], 0.0

        # Build trajectory
        trajectory: list[TrajectoryPoint] = []
        for det in valid_detections:
            trajectory.append(
                TrajectoryPoint(
                    timestamp=det["timestamp"],
                    x=det["detection"]["center"][0],
                    y=det["detection"]["center"][1],
                    confidence=det["detection"]["confidence"],
                    interpolated=False,
                )
            )

        # Interpolate gaps if requested
        if interpolate_gaps and len(trajectory) >= 2:
            trajectory = self._interpolate_trajectory_gaps(
                trajectory, detections, max_gap_frames
            )

        # Calculate trajectory confidence
        analysis = self._analyze_trajectory(trajectory, detections)

        # Convert to dict format for backward compatibility
        trajectory_dicts = [
            {
                "timestamp": p.timestamp,
                "x": p.x,
                "y": p.y,
                "confidence": p.confidence,
                "interpolated": p.interpolated,
            }
            for p in trajectory
        ]

        return trajectory_dicts, analysis.confidence

    def _interpolate_trajectory_gaps(
        self,
        trajectory: list[TrajectoryPoint],
        all_detections: list[dict],
        max_gap_frames: int,
    ) -> list[TrajectoryPoint]:
        """Fill small gaps in trajectory with interpolated points.

        Args:
            trajectory: List of detected trajectory points
            all_detections: All detection results (including misses)
            max_gap_frames: Maximum gap size to interpolate

        Returns:
            Trajectory with interpolated points added
        """
        if len(trajectory) < 2:
            return trajectory

        # Build timestamp to detection mapping
        detection_timestamps = {d["timestamp"] for d in all_detections if d["detection"]}
        all_timestamps = sorted(d["timestamp"] for d in all_detections)

        result: list[TrajectoryPoint] = []

        for i in range(len(trajectory) - 1):
            current = trajectory[i]
            next_point = trajectory[i + 1]
            result.append(current)

            # Find timestamps between current and next detection
            gap_timestamps = [
                t
                for t in all_timestamps
                if current.timestamp < t < next_point.timestamp
                and t not in detection_timestamps
            ]

            # Only interpolate small gaps
            if 0 < len(gap_timestamps) <= max_gap_frames:
                for gap_ts in gap_timestamps:
                    # Linear interpolation
                    t_ratio = (gap_ts - current.timestamp) / (
                        next_point.timestamp - current.timestamp
                    )
                    interp_x = current.x + t_ratio * (next_point.x - current.x)
                    interp_y = current.y + t_ratio * (next_point.y - current.y)

                    # Interpolated confidence is lower
                    interp_conf = min(current.confidence, next_point.confidence) * 0.5

                    result.append(
                        TrajectoryPoint(
                            timestamp=gap_ts,
                            x=interp_x,
                            y=interp_y,
                            confidence=interp_conf,
                            interpolated=True,
                        )
                    )

        # Add the last point
        result.append(trajectory[-1])

        # Sort by timestamp
        result.sort(key=lambda p: p.timestamp)

        return result

    def _analyze_trajectory(
        self,
        trajectory: list[TrajectoryPoint],
        all_detections: list[dict],
    ) -> FlightAnalysis:
        """Perform comprehensive trajectory analysis.

        Args:
            trajectory: List of trajectory points
            all_detections: All detection results

        Returns:
            FlightAnalysis with confidence scores and metrics
        """
        if len(trajectory) < 2:
            return FlightAnalysis(
                trajectory=trajectory,
                confidence=0.0,
                smoothness_score=0.0,
                physics_plausibility=0.0,
                apex_point=None,
                estimated_launch_angle=None,
                flight_duration=None,
                has_gaps=True,
                gap_count=0,
            )

        # Detection ratio
        detected_count = len([d for d in all_detections if d["detection"]])
        detection_ratio = detected_count / max(1, len(all_detections))

        # Calculate smoothness
        smoothness_score = self._calculate_smoothness(trajectory)

        # Check physics plausibility (ball should follow parabolic arc)
        physics_score = self._calculate_physics_plausibility(trajectory)

        # Find apex (highest point - remember Y increases downward in image coords)
        apex_point = min(trajectory, key=lambda p: p.y)

        # Estimate launch angle from first few points
        launch_angle = self._estimate_launch_angle(trajectory)

        # Flight duration
        flight_duration = trajectory[-1].timestamp - trajectory[0].timestamp

        # Count gaps
        interpolated_count = sum(1 for p in trajectory if p.interpolated)
        has_gaps = interpolated_count > 0

        # Combined confidence
        confidence = (
            detection_ratio * 0.4
            + smoothness_score * 0.3
            + physics_score * 0.3
        )

        return FlightAnalysis(
            trajectory=trajectory,
            confidence=float(confidence),
            smoothness_score=float(smoothness_score),
            physics_plausibility=float(physics_score),
            apex_point=apex_point,
            estimated_launch_angle=launch_angle,
            flight_duration=flight_duration,
            has_gaps=has_gaps,
            gap_count=interpolated_count,
        )

    def _calculate_smoothness(self, trajectory: list[TrajectoryPoint]) -> float:
        """Calculate trajectory smoothness score.

        A smooth trajectory has consistent velocity changes (no sudden jumps).

        Args:
            trajectory: List of trajectory points

        Returns:
            Smoothness score between 0 and 1
        """
        if len(trajectory) < 3:
            return 0.5  # Not enough points to judge

        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        # Calculate velocities
        dt = np.diff(timestamps)
        dt = np.where(dt == 0, 1e-6, dt)  # Avoid division by zero

        vx = np.diff(x_coords) / dt
        vy = np.diff(y_coords) / dt

        if len(vx) < 2:
            return 0.5

        # Calculate accelerations
        dt2 = dt[:-1]
        dt2 = np.where(dt2 == 0, 1e-6, dt2)

        ax = np.diff(vx) / dt2
        ay = np.diff(vy) / dt2

        # Smoothness based on acceleration variance
        # Lower variance = smoother trajectory
        ax_var = np.var(ax) if len(ax) > 0 else 0
        ay_var = np.var(ay) if len(ay) > 0 else 0

        # Normalize - smaller variance is better
        # Use sigmoid-like transformation with configurable scale
        smoothness_x = 1.0 / (1.0 + ax_var / self.SMOOTHNESS_VARIANCE_SCALE)
        smoothness_y = 1.0 / (1.0 + ay_var / self.SMOOTHNESS_VARIANCE_SCALE)

        return float((smoothness_x + smoothness_y) / 2)

    def _calculate_physics_plausibility(
        self, trajectory: list[TrajectoryPoint]
    ) -> float:
        """Check if trajectory follows expected golf ball physics.

        Golf balls follow parabolic arcs under gravity. This checks if
        the Y-coordinate trajectory roughly matches expected physics.

        Args:
            trajectory: List of trajectory points

        Returns:
            Physics plausibility score between 0 and 1
        """
        if len(trajectory) < 4:
            return 0.5  # Not enough points to fit parabola

        # Get coordinates
        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        # Normalize time to [0, 1]
        t_norm = (timestamps - timestamps[0]) / max(
            timestamps[-1] - timestamps[0], 1e-6
        )

        try:
            # Fit quadratic to Y vs time (parabolic motion)
            # y = at^2 + bt + c
            coeffs = np.polyfit(t_norm, y_coords, 2)
            y_fitted = np.polyval(coeffs, t_norm)

            # Calculate R-squared
            ss_res = np.sum((y_coords - y_fitted) ** 2)
            ss_tot = np.sum((y_coords - np.mean(y_coords)) ** 2)

            if ss_tot == 0:
                return 0.5

            r_squared = 1 - (ss_res / ss_tot)

            # Also check X progression (should be roughly monotonic)
            x_direction = np.sign(np.diff(x_coords))
            x_consistency = np.sum(x_direction == x_direction[0]) / len(x_direction)

            # Combined score
            physics_score = r_squared * 0.6 + x_consistency * 0.4

            return float(max(0, min(1, physics_score)))

        except (np.linalg.LinAlgError, ValueError):
            return 0.5

    def _estimate_launch_angle(
        self, trajectory: list[TrajectoryPoint]
    ) -> Optional[float]:
        """Estimate launch angle from initial trajectory points.

        Args:
            trajectory: List of trajectory points

        Returns:
            Launch angle in degrees, or None if cannot estimate
        """
        if len(trajectory) < 2:
            return None

        # Use first few points to estimate initial velocity vector
        n_points = min(3, len(trajectory))

        x_coords = np.array([p.x for p in trajectory[:n_points]])
        y_coords = np.array([p.y for p in trajectory[:n_points]])
        timestamps = np.array([p.timestamp for p in trajectory[:n_points]])

        # Linear fit to get initial velocity
        dt = timestamps[-1] - timestamps[0]
        if dt <= 0:
            return None

        vx = (x_coords[-1] - x_coords[0]) / dt
        vy = (y_coords[-1] - y_coords[0]) / dt  # Note: Y is inverted in image coords

        # Calculate angle (negative vy means upward in image coordinates)
        angle_rad = np.arctan2(-vy, abs(vx))  # Negate vy for image coord system
        angle_deg = np.degrees(angle_rad)

        return float(angle_deg)

    def analyze_ball_flight(
        self,
        video_path: Path,
        start_time: float,
        end_time: float,
        sample_fps: float = 30.0,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> FlightAnalysis:
        """Full ball flight analysis pipeline with trajectory filtering.

        This method:
        1. Detects all potential ball positions in the video segment
        2. Detects the golfer to establish ball origin zone
        3. Clusters detections into separate trajectory segments
        4. Filters for trajectories with parabolic (rising-then-falling) motion
        5. Selects the best trajectory that represents an actual golf shot

        Args:
            video_path: Path to video file
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            sample_fps: Frames per second to analyze
            progress_callback: Optional progress callback

        Returns:
            FlightAnalysis with complete trajectory data
        """
        # Step 1: Detect golfer position at the start of the clip
        # This helps us establish where the ball should originate
        golfer = self.detect_golfer_at_time(video_path, start_time)
        golfer_feet = golfer.feet_position if golfer else None

        if golfer:
            logger.debug(
                f"Detected golfer at feet position: ({golfer_feet[0]:.0f}, {golfer_feet[1]:.0f})"
            )
        else:
            logger.debug("No golfer detected - will use position-agnostic filtering")

        # Step 2: Detect ball in all frames
        detections = self.detect_ball_in_video_segment(
            video_path,
            start_time,
            end_time,
            sample_fps,
            progress_callback,
        )

        # Early exit if not enough detections
        valid_detections = [d for d in detections if d["detection"] is not None]
        logger.debug(f"Found {len(valid_detections)} ball detections in segment")

        if len(valid_detections) < 4:
            logger.debug("Not enough detections for trajectory analysis")
            return FlightAnalysis(
                trajectory=[],
                confidence=0.0,
                smoothness_score=0.0,
                physics_plausibility=0.0,
                apex_point=None,
                estimated_launch_angle=None,
                flight_duration=None,
                has_gaps=True,
                gap_count=0,
            )

        # Get frame dimensions
        frame_width = self._frame_width or 1920
        frame_height = self._frame_height or 1080

        # Step 2.5: Filter out stationary detections (ball on tee)
        # These are detections where the ball doesn't move significantly
        moving_detections = TrajectoryFilter.filter_stationary_detections(
            valid_detections,
            min_movement=0.02,  # 2% of frame (~77px at 4K)
            frame_width=frame_width,
            frame_height=frame_height,
        )

        if len(moving_detections) < 4:
            logger.debug("Not enough moving detections for trajectory (ball may still be on tee)")
            return FlightAnalysis(
                trajectory=[],
                confidence=0.0,
                smoothness_score=0.0,
                physics_plausibility=0.0,
                apex_point=None,
                estimated_launch_angle=None,
                flight_duration=None,
                has_gaps=True,
                gap_count=0,
            )

        # Step 3: Cluster moving detections into separate trajectory segments
        # Use moderate thresholds - break on large gaps but allow for fast ball movement
        trajectory_segments = TrajectoryFilter.cluster_into_trajectories(
            moving_detections,  # Use filtered moving detections
            max_gap_seconds=0.15,  # Break trajectory if >150ms gap (sparse but reasonable)
            max_jump_pixels=300,  # Break if ball "jumps" more than 300px (fast ball)
        )

        logger.debug(f"Clustered into {len(trajectory_segments)} trajectory segments")

        # Step 4: Filter and score each trajectory segment
        best_trajectory: Optional[list[TrajectoryPoint]] = None
        best_score = 0.0
        best_apex: Optional[TrajectoryPoint] = None

        for i, segment in enumerate(trajectory_segments):
            # Convert to TrajectoryPoints
            points = [
                TrajectoryPoint(
                    timestamp=d["timestamp"],
                    x=d["detection"]["center"][0],
                    y=d["detection"]["center"][1],
                    confidence=d["detection"]["confidence"],
                    interpolated=False,
                )
                for d in segment
            ]

            if len(points) < 4:
                logger.debug(f"Segment {i}: skipped (only {len(points)} points)")
                continue

            # Check for noisy trajectory (too many large jumps)
            filtered_points = TrajectoryFilter.filter_noisy_trajectory(
                points, frame_width, frame_height, max_jump_ratio=0.15
            )
            if filtered_points is None:
                logger.debug(f"Segment {i}: rejected (too noisy)")
                continue
            points = filtered_points

            # Check if trajectory starts from valid origin zone
            origin_valid = TrajectoryFilter.filter_by_origin_zone(
                points, golfer_feet, frame_width, frame_height
            )
            if not origin_valid:
                logger.debug(f"Segment {i}: rejected (origin outside golfer zone)")
                continue

            # Check for parabolic motion (rising then falling)
            is_parabolic, parabola_score, apex = TrajectoryFilter.is_parabolic_trajectory(
                points, frame_height, frame_width
            )

            if not is_parabolic:
                logger.debug(f"Segment {i}: rejected (not parabolic)")
                continue

            # Score this trajectory
            # Prefer: longer trajectories, better parabola fit, more detections
            length_score = min(1.0, len(points) / 20)  # Cap at 20 points
            avg_confidence = sum(p.confidence for p in points) / len(points)
            score = parabola_score * 0.5 + length_score * 0.3 + avg_confidence * 0.2

            logger.debug(
                f"Segment {i}: valid parabolic trajectory with score={score:.3f} "
                f"({len(points)} points, parabola={parabola_score:.3f})"
            )

            if score > best_score:
                best_score = score
                best_trajectory = points
                best_apex = apex

        # If no valid trajectory found, return empty analysis
        if best_trajectory is None:
            logger.warning("No valid parabolic trajectory found in segment")
            return FlightAnalysis(
                trajectory=[],
                confidence=0.0,
                smoothness_score=0.0,
                physics_plausibility=0.0,
                apex_point=None,
                estimated_launch_angle=None,
                flight_duration=None,
                has_gaps=True,
                gap_count=0,
            )

        logger.info(
            f"Selected best trajectory with {len(best_trajectory)} points, score={best_score:.3f}"
        )

        # Step 5: Interpolate gaps in the best trajectory
        best_trajectory = self._interpolate_trajectory_gaps(
            best_trajectory, detections, max_gap_frames=5
        )

        # Step 6: Analyze the final trajectory
        analysis = self._analyze_trajectory(best_trajectory, detections)

        # Override apex point with the one we found during parabola validation
        if best_apex:
            analysis = FlightAnalysis(
                trajectory=analysis.trajectory,
                confidence=analysis.confidence,
                smoothness_score=analysis.smoothness_score,
                physics_plausibility=analysis.physics_plausibility,
                apex_point=best_apex,
                estimated_launch_angle=analysis.estimated_launch_angle,
                flight_duration=analysis.flight_duration,
                has_gaps=analysis.has_gaps,
                gap_count=analysis.gap_count,
            )

        return analysis

    def detect_ball_disappearance(
        self,
        detections: list[dict],
        min_visible_before: int = 3,
    ) -> Optional[float]:
        """Detect when ball disappears (likely at impact).

        Looks for pattern: ball visible for several frames, then gone.

        Args:
            detections: List of frame detections
            min_visible_before: Minimum frames ball must be visible before disappearing

        Returns:
            Timestamp when ball disappears, or None if no clear disappearance
        """
        if len(detections) < min_visible_before + 1:
            return None

        # Find sequences where ball was visible then gone
        visible_streak = 0
        last_visible_timestamp = None

        for det in detections:
            if det["detection"] is not None:
                visible_streak += 1
                last_visible_timestamp = det["timestamp"]
            else:
                if visible_streak >= min_visible_before and last_visible_timestamp is not None:
                    # Ball was visible for several frames, now gone
                    return last_visible_timestamp
                visible_streak = 0

        return None

    def detect_ball_in_motion(
        self,
        detections: list[dict],
        min_displacement: float = 20.0,
    ) -> bool:
        """Check if detected ball is in motion (not stationary on ground).

        Args:
            detections: List of frame detections
            min_displacement: Minimum pixel displacement to consider motion

        Returns:
            True if ball appears to be moving
        """
        valid = [d for d in detections if d["detection"] is not None]
        if len(valid) < 2:
            return False

        # Calculate total displacement
        first = valid[0]["detection"]["center"]
        last = valid[-1]["detection"]["center"]

        displacement = np.sqrt((last[0] - first[0]) ** 2 + (last[1] - first[1]) ** 2)

        # Cast to Python bool to avoid returning numpy.bool_
        return bool(displacement >= min_displacement)
