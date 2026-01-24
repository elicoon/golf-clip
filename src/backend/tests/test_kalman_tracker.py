"""Tests for Kalman filter ball predictor."""

import numpy as np
import pytest

from backend.detection.kalman_tracker import BallKalmanFilter, KalmanPrediction, KalmanState


class TestBallKalmanFilter:
    """Tests for BallKalmanFilter."""

    def test_initialization(self):
        """Initial state should match input."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=5, vy=-15)

        state = kf.get_state()
        assert state is not None
        assert abs(state.x - 500) < 0.1
        assert abs(state.y - 800) < 0.1

    def test_prediction_follows_motion(self):
        """Prediction should follow physics model."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=10, vy=-20)

        pred = kf.predict()

        # Should have moved right (positive vx) and up (negative vy, so y decreases)
        assert pred.x > 500
        assert pred.y < 800

    def test_measurement_update_moves_state(self):
        """Update should move state toward measurement."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800)

        kf.predict()
        state = kf.update(measured_x=510, measured_y=790)

        # State should be close to measurement
        assert abs(state.x - 510) < 20
        assert abs(state.y - 790) < 20

    def test_plausibility_rejects_outliers(self):
        """Far measurements should be rejected."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=5, vy=-10)

        kf.predict()

        # Close measurement should be plausible
        assert kf.is_measurement_plausible(510, 790) is True

        # Far measurement should not be plausible
        assert kf.is_measurement_plausible(800, 500) is False

    def test_gravity_effect(self):
        """Ball should accelerate downward over time."""
        kf = BallKalmanFilter(fps=60.0, gravity_pixels_per_s2=500)
        kf.initialize(x=500, y=500, vx=0, vy=0)

        # Simulate several frames
        positions = []
        for _ in range(30):
            pred = kf.predict()
            kf.update_no_measurement()
            positions.append(pred.y)

        # Y should be increasing (ball falling down in screen coords)
        assert positions[-1] > positions[0]
