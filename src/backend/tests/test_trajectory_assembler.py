"""Tests for trajectory assembler."""

import pytest

from backend.detection.trajectory_assembler import TrajectoryAssembler


class TestTrajectoryAssembler:
    """Tests for TrajectoryAssembler."""

    def test_add_detection(self):
        """Should accumulate detections."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)

        assert len(assembler._detections) == 2

    def test_gap_interpolation(self):
        """Small gaps should be filled."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)
        assembler.add_no_detection(2)  # Gap
        assembler.add_no_detection(3)  # Gap
        assembler.add_detection(4, 975, 740, 0.8)
        assembler.add_detection(5, 980, 720, 0.85)

        trajectory = assembler.assemble(strike_time=18.25)

        assert trajectory is not None
        assert len(trajectory.points) >= 6
        assert trajectory.gap_count >= 1

    def test_apex_detection(self):
        """Should find correct apex index."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        # Create a parabolic trajectory
        # In screen coords, lower y = higher on screen
        assembler.add_detection(0, 960, 900, 0.9)  # Start low
        assembler.add_detection(1, 962, 800, 0.9)
        assembler.add_detection(2, 964, 700, 0.9)
        assembler.add_detection(3, 966, 650, 0.9)  # Apex (highest = lowest y)
        assembler.add_detection(4, 968, 700, 0.9)
        assembler.add_detection(5, 970, 800, 0.9)

        trajectory = assembler.assemble(strike_time=0.0)

        assert trajectory is not None
        assert trajectory.apex_index == 3

    def test_insufficient_detections(self):
        """Should return None if too few detections."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)

        trajectory = assembler.assemble(strike_time=0.0)

        assert trajectory is None  # Needs at least 6 points
