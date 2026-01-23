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

from backend.core.config import settings

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


class BallDetector:
    """Detects golf balls in video frames using YOLO."""

    # COCO class IDs that could represent golf balls
    SPORTS_BALL_CLASS = 32  # "sports ball" in COCO

    # Golf ball size constraints (relative to frame)
    # Golf balls are small - typically 0.5-3% of frame width in 4K footage
    MIN_BALL_SIZE_RATIO = 0.002  # Minimum ball diameter as ratio of frame width
    MAX_BALL_SIZE_RATIO = 0.05  # Maximum ball diameter as ratio of frame width

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
                    continue

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
        """Full ball flight analysis pipeline.

        Args:
            video_path: Path to video file
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            sample_fps: Frames per second to analyze
            progress_callback: Optional progress callback

        Returns:
            FlightAnalysis with complete trajectory data
        """
        # Detect ball in all frames
        detections = self.detect_ball_in_video_segment(
            video_path,
            start_time,
            end_time,
            sample_fps,
            progress_callback,
        )

        # Build trajectory
        valid_detections = [d for d in detections if d["detection"] is not None]

        if len(valid_detections) < 2:
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

        trajectory = [
            TrajectoryPoint(
                timestamp=d["timestamp"],
                x=d["detection"]["center"][0],
                y=d["detection"]["center"][1],
                confidence=d["detection"]["confidence"],
                interpolated=False,
            )
            for d in valid_detections
        ]

        # Interpolate gaps
        trajectory = self._interpolate_trajectory_gaps(trajectory, detections, max_gap_frames=5)

        # Analyze
        return self._analyze_trajectory(trajectory, detections)

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
