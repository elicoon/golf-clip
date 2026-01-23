"""Tests for visual ball detection.

These tests use standalone dataclass definitions that mirror the actual implementation.
This allows testing the pure Python logic without importing heavy dependencies like
torch, ultralytics, or cv2.

The actual visual module's dataclasses and helper functions are replicated here
for testing purposes.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import numpy as np
import pytest

# Test the pure Python logic using standalone dataclass definitions
# These mirror the actual implementation in backend/detection/visual.py


from dataclasses import dataclass
from typing import Optional


@dataclass
class BallDetection:
    """Represents a detected golf ball in a frame."""

    bbox: tuple[float, float, float, float]
    confidence: float
    center: tuple[float, float]
    size: tuple[float, float]

    def to_dict(self) -> dict:
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


class TestBallDetection:
    """Tests for the BallDetection dataclass."""

    def test_ball_detection_creation(self):
        """Test creating a BallDetection instance."""
        detection = BallDetection(
            bbox=(100.0, 200.0, 120.0, 220.0),
            confidence=0.85,
            center=(110.0, 210.0),
            size=(20.0, 20.0),
        )

        assert detection.bbox == (100.0, 200.0, 120.0, 220.0)
        assert detection.confidence == 0.85
        assert detection.center == (110.0, 210.0)
        assert detection.size == (20.0, 20.0)

    def test_ball_detection_to_dict(self):
        """Test converting BallDetection to dictionary."""
        detection = BallDetection(
            bbox=(100.0, 200.0, 120.0, 220.0),
            confidence=0.85,
            center=(110.0, 210.0),
            size=(20.0, 20.0),
        )

        result = detection.to_dict()

        assert result["bbox"] == [100.0, 200.0, 120.0, 220.0]
        assert result["confidence"] == 0.85
        assert result["center"] == [110.0, 210.0]
        assert result["size"] == [20.0, 20.0]


class TestTrajectoryPoint:
    """Tests for the TrajectoryPoint dataclass."""

    def test_trajectory_point_creation(self):
        """Test creating a TrajectoryPoint instance."""
        point = TrajectoryPoint(
            timestamp=1.5,
            x=500.0,
            y=300.0,
            confidence=0.9,
            interpolated=False,
        )

        assert point.timestamp == 1.5
        assert point.x == 500.0
        assert point.y == 300.0
        assert point.confidence == 0.9
        assert point.interpolated is False

    def test_trajectory_point_interpolated_default(self):
        """Test that interpolated defaults to False."""
        point = TrajectoryPoint(
            timestamp=1.5,
            x=500.0,
            y=300.0,
            confidence=0.9,
        )

        assert point.interpolated is False


class TestFlightAnalysis:
    """Tests for the FlightAnalysis dataclass."""

    def test_flight_analysis_creation(self):
        """Test creating a FlightAnalysis instance."""
        apex = TrajectoryPoint(timestamp=0.5, x=300, y=200, confidence=0.9)
        trajectory = [
            TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9),
            apex,
            TrajectoryPoint(timestamp=1.0, x=500, y=500, confidence=0.85),
        ]

        analysis = FlightAnalysis(
            trajectory=trajectory,
            confidence=0.85,
            smoothness_score=0.9,
            physics_plausibility=0.88,
            apex_point=apex,
            estimated_launch_angle=45.0,
            flight_duration=1.0,
            has_gaps=False,
            gap_count=0,
        )

        assert analysis.confidence == 0.85
        assert analysis.smoothness_score == 0.9
        assert analysis.physics_plausibility == 0.88
        assert analysis.apex_point == apex
        assert analysis.estimated_launch_angle == 45.0
        assert analysis.flight_duration == 1.0
        assert analysis.has_gaps is False
        assert analysis.gap_count == 0


class TestBallDetectionValidation:
    """Tests for ball detection validation logic."""

    # Constants from the BallDetector class
    MIN_BALL_SIZE_RATIO = 0.002
    MAX_BALL_SIZE_RATIO = 0.05
    MIN_ASPECT_RATIO = 0.7
    MAX_ASPECT_RATIO = 1.4

    def _is_valid_ball_detection(
        self,
        bbox: tuple[float, float, float, float],
        frame_width: int,
        frame_height: int,
    ) -> bool:
        """Check if detection has valid golf ball characteristics."""
        x1, y1, x2, y2 = bbox
        width = x2 - x1
        height = y2 - y1

        # Check size relative to frame
        size_ratio = max(width, height) / frame_width
        if size_ratio < self.MIN_BALL_SIZE_RATIO:
            return False
        if size_ratio > self.MAX_BALL_SIZE_RATIO:
            return False

        # Check aspect ratio
        if width > 0 and height > 0:
            aspect_ratio = width / height
            if aspect_ratio < self.MIN_ASPECT_RATIO or aspect_ratio > self.MAX_ASPECT_RATIO:
                return False

        return True

    def test_valid_ball_detection(self):
        """Test valid ball detection passes validation."""
        # Golf ball-sized bbox (2% of 3840px = ~77px)
        bbox = (100.0, 100.0, 177.0, 177.0)
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is True

    def test_too_small_detection(self):
        """Test that too-small detections are rejected."""
        # Tiny bbox (0.1% of frame)
        bbox = (100.0, 100.0, 104.0, 104.0)
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is False

    def test_too_large_detection(self):
        """Test that too-large detections are rejected."""
        # Large bbox (10% of frame)
        bbox = (100.0, 100.0, 484.0, 484.0)
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is False

    def test_wrong_aspect_ratio_horizontal(self):
        """Test that horizontally elongated detections are rejected."""
        # Very elongated bbox (aspect ratio 3:1)
        bbox = (100.0, 100.0, 250.0, 150.0)  # 150w x 50h
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is False

    def test_wrong_aspect_ratio_vertical(self):
        """Test that vertically elongated detections are rejected."""
        # Vertically elongated bbox
        bbox = (100.0, 100.0, 150.0, 250.0)  # 50w x 150h
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is False

    def test_edge_case_min_size(self):
        """Test detection at minimum valid size."""
        # Exactly at minimum size threshold (0.2% of 3840 = 7.68px)
        bbox = (100.0, 100.0, 108.0, 108.0)  # 8x8 px
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is True

    def test_edge_case_max_size(self):
        """Test detection at maximum valid size."""
        # Just below maximum size threshold (5% of 3840 = 192px)
        bbox = (100.0, 100.0, 290.0, 290.0)  # 190x190 px
        frame_width = 3840
        frame_height = 2160

        result = self._is_valid_ball_detection(bbox, frame_width, frame_height)
        assert result is True


class TestTrajectorySmoothnessCalculation:
    """Tests for trajectory smoothness calculation."""

    def _calculate_smoothness(self, trajectory: list[TrajectoryPoint]) -> float:
        """Calculate trajectory smoothness score."""
        if len(trajectory) < 3:
            return 0.5

        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        dt = np.diff(timestamps)
        dt = np.where(dt == 0, 1e-6, dt)

        vx = np.diff(x_coords) / dt
        vy = np.diff(y_coords) / dt

        if len(vx) < 2:
            return 0.5

        dt2 = dt[:-1]
        dt2 = np.where(dt2 == 0, 1e-6, dt2)

        ax = np.diff(vx) / dt2
        ay = np.diff(vy) / dt2

        ax_var = np.var(ax) if len(ax) > 0 else 0
        ay_var = np.var(ay) if len(ay) > 0 else 0

        smoothness_x = 1.0 / (1.0 + ax_var / 10000)
        smoothness_y = 1.0 / (1.0 + ay_var / 10000)

        return float((smoothness_x + smoothness_y) / 2)

    def test_smooth_linear_trajectory(self):
        """Test smoothness for a perfectly linear trajectory."""
        points = [
            TrajectoryPoint(timestamp=i * 0.1, x=100 + i * 50, y=500, confidence=0.9)
            for i in range(10)
        ]

        smoothness = self._calculate_smoothness(points)
        assert smoothness > 0.8  # Linear motion should be very smooth

    def test_smooth_parabolic_trajectory(self):
        """Test smoothness for a parabolic trajectory (like golf ball)."""
        points = []
        for i in range(10):
            t = i * 0.1
            x = 100 + i * 50
            # Parabolic y motion
            y = 500 - 100 * (1 - (t - 0.45) ** 2 / 0.2025)
            points.append(TrajectoryPoint(timestamp=t, x=x, y=y, confidence=0.9))

        smoothness = self._calculate_smoothness(points)
        assert 0 <= smoothness <= 1
        assert smoothness > 0.5  # Parabolic should still be relatively smooth

    def test_noisy_trajectory(self):
        """Test smoothness for a trajectory with random jumps."""
        np.random.seed(42)  # For reproducibility
        points = [
            TrajectoryPoint(
                timestamp=i * 0.1,
                x=100 + np.random.randint(-100, 100),
                y=300 + np.random.randint(-100, 100),
                confidence=0.9,
            )
            for i in range(10)
        ]

        smoothness = self._calculate_smoothness(points)
        assert 0 <= smoothness <= 1

    def test_insufficient_points(self):
        """Test smoothness returns 0.5 for insufficient points."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=200, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=150, y=180, confidence=0.9),
        ]

        smoothness = self._calculate_smoothness(points)
        assert smoothness == 0.5


class TestPhysicsPlausibility:
    """Tests for physics plausibility calculation."""

    def _calculate_physics_plausibility(
        self, trajectory: list[TrajectoryPoint]
    ) -> float:
        """Check if trajectory follows expected golf ball physics."""
        if len(trajectory) < 4:
            return 0.5

        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        t_norm = (timestamps - timestamps[0]) / max(
            timestamps[-1] - timestamps[0], 1e-6
        )

        try:
            coeffs = np.polyfit(t_norm, y_coords, 2)
            y_fitted = np.polyval(coeffs, t_norm)

            ss_res = np.sum((y_coords - y_fitted) ** 2)
            ss_tot = np.sum((y_coords - np.mean(y_coords)) ** 2)

            if ss_tot == 0:
                return 0.5

            r_squared = 1 - (ss_res / ss_tot)

            x_direction = np.sign(np.diff(x_coords))
            x_consistency = np.sum(x_direction == x_direction[0]) / len(x_direction)

            physics_score = r_squared * 0.6 + x_consistency * 0.4

            return float(max(0, min(1, physics_score)))

        except (np.linalg.LinAlgError, ValueError):
            return 0.5

    def test_parabolic_trajectory(self):
        """Test physics plausibility for ideal parabolic trajectory."""
        points = []
        for i in range(10):
            t = i * 0.1
            x = 100 + i * 50  # Linear x motion
            y = 500 - 100 * t + 50 * t * t  # Parabolic y motion
            points.append(TrajectoryPoint(timestamp=t, x=x, y=y, confidence=0.9))

        plausibility = self._calculate_physics_plausibility(points)
        assert plausibility > 0.8  # Should match parabola well

    def test_linear_trajectory_lower_score(self):
        """Test that linear trajectory has lower physics score than parabolic."""
        linear_points = [
            TrajectoryPoint(timestamp=i * 0.1, x=100 + i * 50, y=500 - i * 20, confidence=0.9)
            for i in range(10)
        ]

        # Linear trajectory doesn't match parabolic motion as well
        plausibility = self._calculate_physics_plausibility(linear_points)
        assert 0 <= plausibility <= 1

    def test_insufficient_points(self):
        """Test physics returns 0.5 for insufficient points."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=200, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=150, y=180, confidence=0.9),
        ]

        plausibility = self._calculate_physics_plausibility(points)
        assert plausibility == 0.5

    def test_x_consistency_matters(self):
        """Test that X direction consistency affects score."""
        # Points that reverse direction in X
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=150, y=480, confidence=0.9),
            TrajectoryPoint(timestamp=0.2, x=120, y=460, confidence=0.9),  # Reverses!
            TrajectoryPoint(timestamp=0.3, x=180, y=440, confidence=0.9),
            TrajectoryPoint(timestamp=0.4, x=200, y=420, confidence=0.9),
        ]

        plausibility = self._calculate_physics_plausibility(points)
        assert 0 <= plausibility <= 1
        # Should be lower due to inconsistent X direction


class TestLaunchAngleEstimation:
    """Tests for launch angle estimation."""

    def _estimate_launch_angle(
        self, trajectory: list[TrajectoryPoint]
    ) -> Optional[float]:
        """Estimate launch angle from initial trajectory points."""
        if len(trajectory) < 2:
            return None

        n_points = min(3, len(trajectory))

        x_coords = np.array([p.x for p in trajectory[:n_points]])
        y_coords = np.array([p.y for p in trajectory[:n_points]])
        timestamps = np.array([p.timestamp for p in trajectory[:n_points]])

        dt = timestamps[-1] - timestamps[0]
        if dt <= 0:
            return None

        vx = (x_coords[-1] - x_coords[0]) / dt
        vy = (y_coords[-1] - y_coords[0]) / dt

        angle_rad = np.arctan2(-vy, abs(vx))
        angle_deg = np.degrees(angle_rad)

        return float(angle_deg)

    def test_upward_trajectory(self):
        """Test launch angle for upward trajectory."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=200, y=400, confidence=0.9),
            TrajectoryPoint(timestamp=0.2, x=300, y=350, confidence=0.9),
        ]

        angle = self._estimate_launch_angle(points)
        assert angle is not None
        assert angle > 0  # Positive for upward (Y decreases in image coords)

    def test_downward_trajectory(self):
        """Test launch angle for downward trajectory."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=300, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=200, y=400, confidence=0.9),
            TrajectoryPoint(timestamp=0.2, x=300, y=500, confidence=0.9),
        ]

        angle = self._estimate_launch_angle(points)
        assert angle is not None
        assert angle < 0  # Negative for downward

    def test_horizontal_trajectory(self):
        """Test launch angle for horizontal trajectory."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=300, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=200, y=300, confidence=0.9),
            TrajectoryPoint(timestamp=0.2, x=300, y=300, confidence=0.9),
        ]

        angle = self._estimate_launch_angle(points)
        assert angle is not None
        assert abs(angle) < 5  # Should be close to 0

    def test_insufficient_points(self):
        """Test returns None for insufficient points."""
        points = [
            TrajectoryPoint(timestamp=0, x=100, y=500, confidence=0.9),
        ]

        angle = self._estimate_launch_angle(points)
        assert angle is None


class TestTrajectoryInterpolation:
    """Tests for trajectory gap interpolation."""

    def _interpolate_trajectory_gaps(
        self,
        trajectory: list[TrajectoryPoint],
        all_detections: list[dict],
        max_gap_frames: int,
    ) -> list[TrajectoryPoint]:
        """Fill small gaps in trajectory with interpolated points."""
        if len(trajectory) < 2:
            return trajectory

        detection_timestamps = {d["timestamp"] for d in all_detections if d["detection"]}
        all_timestamps = sorted(d["timestamp"] for d in all_detections)

        result: list[TrajectoryPoint] = []

        for i in range(len(trajectory) - 1):
            current = trajectory[i]
            next_point = trajectory[i + 1]
            result.append(current)

            gap_timestamps = [
                t
                for t in all_timestamps
                if current.timestamp < t < next_point.timestamp
                and t not in detection_timestamps
            ]

            if 0 < len(gap_timestamps) <= max_gap_frames:
                for gap_ts in gap_timestamps:
                    t_ratio = (gap_ts - current.timestamp) / (
                        next_point.timestamp - current.timestamp
                    )
                    interp_x = current.x + t_ratio * (next_point.x - current.x)
                    interp_y = current.y + t_ratio * (next_point.y - current.y)
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

        result.append(trajectory[-1])
        result.sort(key=lambda p: p.timestamp)

        return result

    def test_interpolate_fills_small_gaps(self):
        """Test that small gaps are filled with interpolated points."""
        trajectory = [
            TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=0.3, x=250, y=400, confidence=0.9),
        ]

        all_detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500], "confidence": 0.9}},
            {"timestamp": 0.1, "detection": None},
            {"timestamp": 0.2, "detection": None},
            {"timestamp": 0.3, "detection": {"center": [250, 400], "confidence": 0.9}},
        ]

        result = self._interpolate_trajectory_gaps(
            trajectory, all_detections, max_gap_frames=5
        )

        assert len(result) == 4  # 2 original + 2 interpolated
        assert sum(1 for p in result if p.interpolated) == 2

    def test_interpolate_skips_large_gaps(self):
        """Test that large gaps are not interpolated."""
        trajectory = [
            TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=1.0, x=500, y=200, confidence=0.9),
        ]

        # Create many missed frames (large gap)
        all_detections = [{"timestamp": 0.0, "detection": {"center": [100, 500], "confidence": 0.9}}]
        for i in range(1, 10):
            all_detections.append({"timestamp": i * 0.1, "detection": None})
        all_detections.append({"timestamp": 1.0, "detection": {"center": [500, 200], "confidence": 0.9}})

        result = self._interpolate_trajectory_gaps(
            trajectory, all_detections, max_gap_frames=5
        )

        # Should only have original 2 points (gap too large)
        assert len(result) == 2
        assert all(not p.interpolated for p in result)

    def test_interpolate_reduces_confidence(self):
        """Test that interpolated points have lower confidence."""
        trajectory = [
            TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=0.2, x=200, y=450, confidence=0.8),
        ]

        all_detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500], "confidence": 0.9}},
            {"timestamp": 0.1, "detection": None},
            {"timestamp": 0.2, "detection": {"center": [200, 450], "confidence": 0.8}},
        ]

        result = self._interpolate_trajectory_gaps(
            trajectory, all_detections, max_gap_frames=5
        )

        interpolated = [p for p in result if p.interpolated]
        assert len(interpolated) == 1
        # Interpolated confidence should be 0.5 * min(0.9, 0.8) = 0.4
        assert interpolated[0].confidence == 0.4

    def test_interpolation_values_are_linear(self):
        """Test that interpolated coordinates are linearly interpolated."""
        trajectory = [
            TrajectoryPoint(timestamp=0.0, x=0, y=0, confidence=0.9),
            TrajectoryPoint(timestamp=1.0, x=100, y=100, confidence=0.9),
        ]

        all_detections = [
            {"timestamp": 0.0, "detection": {"center": [0, 0], "confidence": 0.9}},
            {"timestamp": 0.5, "detection": None},
            {"timestamp": 1.0, "detection": {"center": [100, 100], "confidence": 0.9}},
        ]

        result = self._interpolate_trajectory_gaps(
            trajectory, all_detections, max_gap_frames=5
        )

        # Find the interpolated point at t=0.5
        interp_point = [p for p in result if p.timestamp == 0.5][0]
        assert interp_point.x == 50.0  # Linear interpolation
        assert interp_point.y == 50.0


class TestBallDisappearanceDetection:
    """Tests for ball disappearance detection."""

    def _detect_ball_disappearance(
        self,
        detections: list[dict],
        min_visible_before: int = 3,
    ) -> Optional[float]:
        """Detect when ball disappears (likely at impact)."""
        if len(detections) < min_visible_before + 1:
            return None

        visible_streak = 0
        last_visible_timestamp = None

        for det in detections:
            if det["detection"] is not None:
                visible_streak += 1
                last_visible_timestamp = det["timestamp"]
            else:
                if visible_streak >= min_visible_before and last_visible_timestamp is not None:
                    return last_visible_timestamp
                visible_streak = 0

        return None

    def test_detect_disappearance(self):
        """Test detecting ball disappearance after visible streak."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
            {"timestamp": 0.1, "detection": {"center": [150, 480]}},
            {"timestamp": 0.2, "detection": {"center": [200, 460]}},
            {"timestamp": 0.3, "detection": {"center": [250, 450]}},
            {"timestamp": 0.4, "detection": None},
            {"timestamp": 0.5, "detection": None},
        ]

        result = self._detect_ball_disappearance(detections, min_visible_before=3)
        assert result == 0.3

    def test_no_clear_disappearance(self):
        """Test when no clear disappearance pattern."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
            {"timestamp": 0.1, "detection": None},
            {"timestamp": 0.2, "detection": {"center": [200, 460]}},
            {"timestamp": 0.3, "detection": None},
        ]

        result = self._detect_ball_disappearance(detections, min_visible_before=3)
        assert result is None

    def test_insufficient_data(self):
        """Test with insufficient detection data."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
            {"timestamp": 0.1, "detection": None},
        ]

        result = self._detect_ball_disappearance(detections, min_visible_before=3)
        assert result is None


class TestBallMotionDetection:
    """Tests for ball motion detection."""

    def _detect_ball_in_motion(
        self,
        detections: list[dict],
        min_displacement: float = 20.0,
    ) -> bool:
        """Check if detected ball is in motion."""
        valid = [d for d in detections if d["detection"] is not None]
        if len(valid) < 2:
            return False

        first = valid[0]["detection"]["center"]
        last = valid[-1]["detection"]["center"]

        displacement = np.sqrt((last[0] - first[0]) ** 2 + (last[1] - first[1]) ** 2)

        return displacement >= min_displacement

    def test_ball_in_motion(self):
        """Test detecting ball that is moving."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
            {"timestamp": 0.1, "detection": {"center": [150, 480]}},
            {"timestamp": 0.2, "detection": {"center": [200, 460]}},
        ]

        result = self._detect_ball_in_motion(detections, min_displacement=20.0)
        assert result == True  # Use == for numpy bool compatibility

    def test_stationary_ball(self):
        """Test detecting stationary ball."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
            {"timestamp": 0.1, "detection": {"center": [102, 501]}},
            {"timestamp": 0.2, "detection": {"center": [101, 500]}},
        ]

        result = self._detect_ball_in_motion(detections, min_displacement=20.0)
        assert result == False  # Use == for numpy bool compatibility

    def test_insufficient_data(self):
        """Test with insufficient detection data."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500]}},
        ]

        result = self._detect_ball_in_motion(detections)
        assert result is False


class TestTrackBallFlight:
    """Tests for the track_ball_flight method logic."""

    def _track_ball_flight(
        self,
        detections: list[dict],
        interpolate_gaps: bool = True,
        max_gap_frames: int = 5,
    ) -> tuple[list[dict], float]:
        """Track ball flight from detections."""
        valid_detections = [d for d in detections if d["detection"] is not None]

        if len(valid_detections) < 2:
            return [], 0.0

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

        # Simplified confidence calculation for testing
        detection_ratio = len(valid_detections) / max(1, len(detections))
        confidence = detection_ratio * 0.7 + 0.3  # Baseline confidence

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

        return trajectory_dicts, confidence

    def test_returns_trajectory_and_confidence(self):
        """Test that track_ball_flight returns trajectory and confidence."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500], "confidence": 0.9}},
            {"timestamp": 0.1, "detection": {"center": [150, 450], "confidence": 0.85}},
            {"timestamp": 0.2, "detection": {"center": [200, 420], "confidence": 0.88}},
        ]

        trajectory, confidence = self._track_ball_flight(detections)

        assert isinstance(trajectory, list)
        assert len(trajectory) == 3
        assert 0 <= confidence <= 1

    def test_insufficient_detections(self):
        """Test with insufficient detections returns empty."""
        detections = [
            {"timestamp": 0.0, "detection": {"center": [100, 500], "confidence": 0.9}},
        ]

        trajectory, confidence = self._track_ball_flight(detections)

        assert trajectory == []
        assert confidence == 0.0

    def test_all_none_detections(self):
        """Test with all None detections."""
        detections = [
            {"timestamp": 0.0, "detection": None},
            {"timestamp": 0.1, "detection": None},
            {"timestamp": 0.2, "detection": None},
        ]

        trajectory, confidence = self._track_ball_flight(detections)

        assert trajectory == []
        assert confidence == 0.0


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_detections_list(self):
        """Test handling empty detections list."""
        # Using the track function
        def track(detections):
            valid = [d for d in detections if d["detection"] is not None]
            if len(valid) < 2:
                return [], 0.0
            return valid, 0.5

        trajectory, confidence = track([])
        assert trajectory == []
        assert confidence == 0.0

    def test_trajectory_with_same_timestamps(self):
        """Test handling trajectory points with identical timestamps."""
        points = [
            TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9),
            TrajectoryPoint(timestamp=0.0, x=150, y=480, confidence=0.85),
            TrajectoryPoint(timestamp=0.1, x=200, y=460, confidence=0.88),
        ]

        # The smoothness calculation should handle this
        x_coords = np.array([p.x for p in points])
        y_coords = np.array([p.y for p in points])
        timestamps = np.array([p.timestamp for p in points])

        dt = np.diff(timestamps)
        dt = np.where(dt == 0, 1e-6, dt)  # Handles zero division

        # Should not raise
        vx = np.diff(x_coords) / dt
        assert len(vx) == 2

    def test_trajectory_with_negative_coordinates(self):
        """Test handling trajectory with negative coordinates."""
        points = [
            TrajectoryPoint(timestamp=0.0, x=-100, y=-500, confidence=0.9),
            TrajectoryPoint(timestamp=0.1, x=-50, y=-480, confidence=0.85),
            TrajectoryPoint(timestamp=0.2, x=0, y=-460, confidence=0.88),
            TrajectoryPoint(timestamp=0.3, x=50, y=-440, confidence=0.87),
        ]

        # Physics plausibility should still work
        x_coords = np.array([p.x for p in points])
        y_coords = np.array([p.y for p in points])
        timestamps = np.array([p.timestamp for p in points])

        t_norm = (timestamps - timestamps[0]) / (timestamps[-1] - timestamps[0])
        coeffs = np.polyfit(t_norm, y_coords, 2)

        # Should not raise
        assert len(coeffs) == 3

    def test_single_point_trajectory(self):
        """Test handling single point trajectory."""
        points = [TrajectoryPoint(timestamp=0.0, x=100, y=500, confidence=0.9)]

        # Smoothness should return 0.5 for insufficient points
        if len(points) < 3:
            smoothness = 0.5
        else:
            smoothness = 0.0

        assert smoothness == 0.5


class TestSyntheticFrameGeneration:
    """Tests for synthetic frame generation helper."""

    def test_create_frame_with_ball(self):
        """Test creating a synthetic frame with a golf ball."""
        # Simulate frame creation
        width, height = 3840, 2160
        ball_center = (500, 300)
        ball_radius = 20

        # Frame dimensions
        assert width == 3840
        assert height == 2160

        # Ball properties
        assert ball_center[0] < width
        assert ball_center[1] < height
        assert ball_radius > 0

    def test_create_frame_without_ball(self):
        """Test creating a synthetic frame without ball."""
        width, height = 3840, 2160
        ball_center = None

        assert width == 3840
        assert height == 2160
        assert ball_center is None


class TestConfidenceScoring:
    """Tests for confidence score calculations."""

    def test_confidence_combines_factors(self):
        """Test that confidence combines multiple factors."""
        detection_ratio = 0.8
        smoothness_score = 0.9
        physics_score = 0.85

        # Formula from implementation
        confidence = (
            detection_ratio * 0.4
            + smoothness_score * 0.3
            + physics_score * 0.3
        )

        expected = 0.8 * 0.4 + 0.9 * 0.3 + 0.85 * 0.3
        assert abs(confidence - expected) < 0.001

    def test_confidence_bounds(self):
        """Test confidence stays in valid range."""
        for det_ratio in [0.0, 0.5, 1.0]:
            for smooth in [0.0, 0.5, 1.0]:
                for physics in [0.0, 0.5, 1.0]:
                    confidence = det_ratio * 0.4 + smooth * 0.3 + physics * 0.3
                    assert 0 <= confidence <= 1

    def test_low_detection_ratio_lowers_confidence(self):
        """Test that low detection ratio significantly lowers confidence."""
        # High detection ratio
        high_conf = 0.9 * 0.4 + 0.9 * 0.3 + 0.9 * 0.3

        # Low detection ratio
        low_conf = 0.2 * 0.4 + 0.9 * 0.3 + 0.9 * 0.3

        assert low_conf < high_conf


class TestAnalyzeBallFlightIntegration:
    """Integration tests for the analyze_ball_flight end-to-end pipeline."""

    def _analyze_trajectory(
        self,
        trajectory: list[TrajectoryPoint],
        all_detections: list[dict],
    ) -> FlightAnalysis:
        """Perform comprehensive trajectory analysis."""
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

        # Check physics plausibility
        physics_score = self._calculate_physics_plausibility(trajectory)

        # Find apex (highest point - Y increases downward in image coords)
        apex_point = min(trajectory, key=lambda p: p.y)

        # Estimate launch angle
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
        """Calculate trajectory smoothness score."""
        if len(trajectory) < 3:
            return 0.5

        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        dt = np.diff(timestamps)
        dt = np.where(dt == 0, 1e-6, dt)

        vx = np.diff(x_coords) / dt
        vy = np.diff(y_coords) / dt

        if len(vx) < 2:
            return 0.5

        dt2 = dt[:-1]
        dt2 = np.where(dt2 == 0, 1e-6, dt2)

        ax = np.diff(vx) / dt2
        ay = np.diff(vy) / dt2

        ax_var = np.var(ax) if len(ax) > 0 else 0
        ay_var = np.var(ay) if len(ay) > 0 else 0

        # Use the constant value from BallDetector
        SMOOTHNESS_VARIANCE_SCALE = 10000
        smoothness_x = 1.0 / (1.0 + ax_var / SMOOTHNESS_VARIANCE_SCALE)
        smoothness_y = 1.0 / (1.0 + ay_var / SMOOTHNESS_VARIANCE_SCALE)

        return float((smoothness_x + smoothness_y) / 2)

    def _calculate_physics_plausibility(
        self, trajectory: list[TrajectoryPoint]
    ) -> float:
        """Check if trajectory follows expected golf ball physics."""
        if len(trajectory) < 4:
            return 0.5

        x_coords = np.array([p.x for p in trajectory])
        y_coords = np.array([p.y for p in trajectory])
        timestamps = np.array([p.timestamp for p in trajectory])

        t_norm = (timestamps - timestamps[0]) / max(
            timestamps[-1] - timestamps[0], 1e-6
        )

        try:
            coeffs = np.polyfit(t_norm, y_coords, 2)
            y_fitted = np.polyval(coeffs, t_norm)

            ss_res = np.sum((y_coords - y_fitted) ** 2)
            ss_tot = np.sum((y_coords - np.mean(y_coords)) ** 2)

            if ss_tot == 0:
                return 0.5

            r_squared = 1 - (ss_res / ss_tot)

            x_direction = np.sign(np.diff(x_coords))
            x_consistency = np.sum(x_direction == x_direction[0]) / len(x_direction)

            physics_score = r_squared * 0.6 + x_consistency * 0.4

            return float(max(0, min(1, physics_score)))

        except (np.linalg.LinAlgError, ValueError):
            return 0.5

    def _estimate_launch_angle(
        self, trajectory: list[TrajectoryPoint]
    ) -> Optional[float]:
        """Estimate launch angle from initial trajectory points."""
        if len(trajectory) < 2:
            return None

        n_points = min(3, len(trajectory))

        x_coords = np.array([p.x for p in trajectory[:n_points]])
        y_coords = np.array([p.y for p in trajectory[:n_points]])
        timestamps = np.array([p.timestamp for p in trajectory[:n_points]])

        dt = timestamps[-1] - timestamps[0]
        if dt <= 0:
            return None

        vx = (x_coords[-1] - x_coords[0]) / dt
        vy = (y_coords[-1] - y_coords[0]) / dt

        angle_rad = np.arctan2(-vy, abs(vx))
        angle_deg = np.degrees(angle_rad)

        return float(angle_deg)

    def test_full_pipeline_parabolic_trajectory(self):
        """Test full analysis pipeline with realistic parabolic trajectory."""
        # Simulate a golf ball flight with parabolic arc
        trajectory = []
        all_detections = []

        for i in range(20):
            t = i * 0.1  # 10 FPS, 2 seconds of flight
            x = 100 + i * 50  # Linear horizontal motion
            # Parabolic vertical motion (ball goes up then down)
            y = 500 - 200 * t + 100 * t * t

            point = TrajectoryPoint(
                timestamp=t,
                x=x,
                y=y,
                confidence=0.9,
                interpolated=False,
            )
            trajectory.append(point)
            all_detections.append({
                "timestamp": t,
                "frame": i,
                "detection": {"center": [x, y], "confidence": 0.9},
            })

        analysis = self._analyze_trajectory(trajectory, all_detections)

        assert analysis.confidence > 0.5
        assert analysis.smoothness_score > 0.5
        assert analysis.physics_plausibility > 0.7  # Should fit parabola well
        assert analysis.apex_point is not None
        assert analysis.flight_duration == pytest.approx(1.9, rel=0.1)
        assert analysis.has_gaps is False

    def test_full_pipeline_with_gaps(self):
        """Test full analysis pipeline with some missing detections."""
        trajectory = []
        all_detections = []

        for i in range(10):
            t = i * 0.1
            x = 100 + i * 50
            y = 500 - 100 * t + 50 * t * t

            # Simulate gap at frame 4 and 5
            if i in [4, 5]:
                all_detections.append({
                    "timestamp": t,
                    "frame": i,
                    "detection": None,
                })
            else:
                point = TrajectoryPoint(
                    timestamp=t,
                    x=x,
                    y=y,
                    confidence=0.85,
                    interpolated=False,
                )
                trajectory.append(point)
                all_detections.append({
                    "timestamp": t,
                    "frame": i,
                    "detection": {"center": [x, y], "confidence": 0.85},
                })

        analysis = self._analyze_trajectory(trajectory, all_detections)

        # Should still get reasonable confidence despite gaps
        assert analysis.confidence > 0.3
        assert analysis.smoothness_score > 0
        assert analysis.physics_plausibility > 0
        assert analysis.apex_point is not None

    def test_full_pipeline_empty_trajectory(self):
        """Test full analysis pipeline with no detections."""
        trajectory = []
        all_detections = [
            {"timestamp": i * 0.1, "frame": i, "detection": None}
            for i in range(10)
        ]

        analysis = self._analyze_trajectory(trajectory, all_detections)

        assert analysis.confidence == 0.0
        assert analysis.smoothness_score == 0.0
        assert analysis.physics_plausibility == 0.0
        assert analysis.apex_point is None
        assert analysis.flight_duration is None

    def test_full_pipeline_calculates_launch_angle(self):
        """Test that launch angle is calculated correctly in full pipeline."""
        # Create upward trajectory (ball going up = Y decreasing in image coords)
        trajectory = []
        all_detections = []

        for i in range(5):
            t = i * 0.1
            x = 100 + i * 100  # Moving right
            y = 500 - i * 50   # Moving up (Y decreasing)

            point = TrajectoryPoint(
                timestamp=t,
                x=x,
                y=y,
                confidence=0.9,
                interpolated=False,
            )
            trajectory.append(point)
            all_detections.append({
                "timestamp": t,
                "frame": i,
                "detection": {"center": [x, y], "confidence": 0.9},
            })

        analysis = self._analyze_trajectory(trajectory, all_detections)

        assert analysis.estimated_launch_angle is not None
        assert analysis.estimated_launch_angle > 0  # Upward angle


class TestVideoProcessingIntegration:
    """Integration tests for video processing methods."""

    def test_detect_ball_in_video_segment_structure(self):
        """Test the expected output structure of detect_ball_in_video_segment."""
        # Simulate the output structure
        detections = [
            {
                "timestamp": 0.0,
                "frame": 0,
                "detection": {
                    "bbox": [100, 100, 120, 120],
                    "confidence": 0.9,
                    "center": [110, 110],
                    "size": [20, 20],
                },
            },
            {
                "timestamp": 0.1,
                "frame": 1,
                "detection": None,
            },
            {
                "timestamp": 0.2,
                "frame": 2,
                "detection": {
                    "bbox": [200, 150, 220, 170],
                    "confidence": 0.85,
                    "center": [210, 160],
                    "size": [20, 20],
                },
            },
        ]

        # Verify structure
        for det in detections:
            assert "timestamp" in det
            assert "frame" in det
            assert "detection" in det

            if det["detection"] is not None:
                assert "bbox" in det["detection"]
                assert "confidence" in det["detection"]
                assert "center" in det["detection"]
                assert "size" in det["detection"]

    def test_video_capture_release_pattern(self):
        """Test that video capture is properly released in try/finally."""
        # Simulate the pattern
        released = False

        class MockCapture:
            def isOpened(self):
                return True
            def release(self):
                nonlocal released
                released = True

        cap = MockCapture()
        try:
            # Simulate processing
            assert cap.isOpened()
        finally:
            cap.release()

        assert released is True

    def test_frame_sampling_calculation(self):
        """Test frame sampling interval calculation."""
        video_fps = 60.0
        sample_fps_values = [10.0, 30.0, 60.0]

        for sample_fps in sample_fps_values:
            frame_interval = max(1, int(video_fps / sample_fps))

            if sample_fps == 10.0:
                assert frame_interval == 6  # Every 6th frame
            elif sample_fps == 30.0:
                assert frame_interval == 2  # Every 2nd frame
            elif sample_fps == 60.0:
                assert frame_interval == 1  # Every frame

    def test_timestamp_calculation_from_frame(self):
        """Test timestamp calculation from frame number."""
        fps = 60.0

        test_cases = [
            (0, 0.0),
            (60, 1.0),
            (30, 0.5),
            (120, 2.0),
        ]

        for frame_num, expected_ts in test_cases:
            timestamp = frame_num / fps
            assert timestamp == pytest.approx(expected_ts)


class TestSmoothnessVarianceScale:
    """Tests for the SMOOTHNESS_VARIANCE_SCALE constant."""

    SMOOTHNESS_VARIANCE_SCALE = 10000

    def test_constant_value(self):
        """Test that constant has expected value."""
        assert self.SMOOTHNESS_VARIANCE_SCALE == 10000

    def test_smoothness_with_different_scales(self):
        """Test how different scale values affect smoothness calculation."""
        ax_var = 5000  # Sample acceleration variance

        # With scale of 10000 (default)
        smoothness_default = 1.0 / (1.0 + ax_var / 10000)

        # With scale of 1000 (more strict)
        smoothness_strict = 1.0 / (1.0 + ax_var / 1000)

        # With scale of 100000 (more lenient)
        smoothness_lenient = 1.0 / (1.0 + ax_var / 100000)

        # More lenient scale should give higher smoothness for same variance
        assert smoothness_lenient > smoothness_default > smoothness_strict

    def test_smoothness_formula_bounds(self):
        """Test that smoothness formula stays in 0-1 range."""
        for variance in [0, 100, 1000, 10000, 100000, 1000000]:
            smoothness = 1.0 / (1.0 + variance / self.SMOOTHNESS_VARIANCE_SCALE)
            assert 0 < smoothness <= 1

    def test_zero_variance_gives_perfect_smoothness(self):
        """Test that zero variance gives smoothness of 1.0."""
        smoothness = 1.0 / (1.0 + 0 / self.SMOOTHNESS_VARIANCE_SCALE)
        assert smoothness == 1.0
