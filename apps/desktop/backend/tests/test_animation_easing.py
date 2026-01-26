"""Tests for animation easing/smoothing math.

These tests validate the mathematical properties of the animation
easing function from TrajectoryEditor.tsx.

The easing function blends between two curves:
- earlyProgress: aggressive ease-out (easeOutQuint)
- lateProgress: nearly linear with slight ease-out

IMPORTANT: These tests are Python implementations of the TypeScript
logic to verify correctness. They serve as a specification.
"""

import math
import pytest


def time_to_progress(t: float) -> float:
    """
    Python implementation of the timeToProgress function from
    TrajectoryEditor.tsx for testing.

    This function converts animation time ratio (0-1) to display
    progress (0-1) using golf ball physics-based easing.

    Uses a monotonic blend of easeOutCubic and linear that:
    - Has fast early progress (ease-out character)
    - Gradually decelerates without abrupt transitions
    - Never goes backwards (guaranteed monotonic)
    """
    if t <= 0:
        return 0
    if t >= 1:
        return 1

    # easeOutCubic: fast start, slowing down
    ease_out = 1 - math.pow(1 - t, 3)

    # Linear component
    linear = t

    # Blend from easeOut (early) toward more linear (late)
    # Use smooth blend that transitions from 70% easeOut to 30% easeOut
    ease_weight = 0.7 - 0.4 * t  # Goes from 0.7 at t=0 to 0.3 at t=1

    # Combined progress (weighted average)
    progress = ease_out * ease_weight + linear * (1 - ease_weight)

    return min(1, max(0, progress))


class TestEasingBoundaryConditions:
    """Test boundary conditions of the easing function."""

    def test_zero_input_returns_zero(self):
        """t=0 should return progress=0"""
        assert time_to_progress(0) == 0

    def test_one_input_returns_one(self):
        """t=1 should return progress=1"""
        assert time_to_progress(1) == 1

    def test_negative_input_returns_zero(self):
        """Negative t should clamp to 0"""
        assert time_to_progress(-0.5) == 0
        assert time_to_progress(-1) == 0
        assert time_to_progress(-100) == 0

    def test_greater_than_one_returns_one(self):
        """t > 1 should clamp to 1"""
        assert time_to_progress(1.5) == 1
        assert time_to_progress(2) == 1
        assert time_to_progress(100) == 1


class TestEasingMonotonicity:
    """Test that the easing function is monotonically increasing.

    BUG FINDER: A non-monotonic easing function would cause the
    animation to move backwards, which looks very wrong.
    """

    def test_function_is_monotonically_increasing(self):
        """Progress should always increase as time increases."""
        prev_progress = 0
        samples = 1000

        for i in range(1, samples + 1):
            t = i / samples
            progress = time_to_progress(t)

            assert progress >= prev_progress, \
                f"Monotonicity violated at t={t}: " \
                f"progress {progress} < previous {prev_progress}"

            prev_progress = progress

    def test_no_backwards_motion_in_critical_regions(self):
        """Check the blend transition region specifically for backwards motion."""
        # The blend happens between 0.2 and 0.6
        critical_t_values = [
            0.19, 0.2, 0.21,  # Start of blend
            0.39, 0.4, 0.41,  # Middle of blend
            0.59, 0.6, 0.61,  # End of blend
        ]

        prev_progress = 0
        for t in sorted(critical_t_values):
            progress = time_to_progress(t)
            assert progress >= prev_progress, \
                f"Backwards motion at t={t}: {progress} < {prev_progress}"
            prev_progress = progress


class TestEasingOutputRange:
    """Test that output stays within valid range."""

    def test_output_always_between_zero_and_one(self):
        """Progress should always be in [0, 1]."""
        samples = 1000

        for i in range(samples + 1):
            t = i / samples
            progress = time_to_progress(t)

            assert 0 <= progress <= 1, \
                f"Out of range at t={t}: progress={progress}"

    def test_progress_never_exceeds_one(self):
        """Progress should never exceed 1.0 at any point."""
        # Check many points across the range
        for i in range(101):
            t = i / 100
            progress = time_to_progress(t)
            assert progress <= 1.0, \
                f"Progress exceeds 1.0 at t={t}: {progress}"


class TestEasingPhysicsTargets:
    """Test that the easing hits expected physics milestones.

    The new monotonic easing achieves:
    - ~45% progress at 25% time (fast early phase)
    - ~69% progress at 50% time (past apex, still moving well)
    """

    def test_early_progress_is_fast(self):
        """At 25% time, should have ~45% progress (fast start)."""
        progress_at_25 = time_to_progress(0.25)

        # Allow some tolerance - should be noticeably ahead of linear (25%)
        assert 0.35 <= progress_at_25 <= 0.55, \
            f"At t=0.25, expected ~45% progress, got {progress_at_25*100:.1f}%"

    def test_apex_timing(self):
        """At 50% time, should have significant progress past halfway."""
        progress_at_50 = time_to_progress(0.50)

        # With the monotonic blend, we expect ~69% at t=0.5
        # This gives a smooth deceleration feel
        assert 0.60 <= progress_at_50 <= 0.80, \
            f"At t=0.50, expected ~69% progress, got {progress_at_50*100:.1f}%"

    def test_descent_is_more_linear(self):
        """After apex, progress should be more linear (less curved)."""
        # Check the rate of change in the late phase
        progress_60 = time_to_progress(0.60)
        progress_70 = time_to_progress(0.70)
        progress_80 = time_to_progress(0.80)
        progress_90 = time_to_progress(0.90)

        delta_60_70 = progress_70 - progress_60
        delta_70_80 = progress_80 - progress_70
        delta_80_90 = progress_90 - progress_80

        # In a linear descent, these deltas would be equal
        # Allow 50% variation (0.5 * expected)
        avg_delta = (delta_60_70 + delta_70_80 + delta_80_90) / 3

        for delta, name in [(delta_60_70, "60-70"),
                            (delta_70_80, "70-80"),
                            (delta_80_90, "80-90")]:
            assert 0.5 * avg_delta <= delta <= 1.5 * avg_delta, \
                f"Delta for {name} ({delta:.4f}) deviates too much from average ({avg_delta:.4f})"


class TestEasingContinuity:
    """Test that the function is continuous (no jumps)."""

    def test_no_discontinuities(self):
        """Small changes in t should produce small changes in progress."""
        samples = 10000
        max_allowed_jump = 0.01  # 1% max jump per step

        prev_progress = 0
        for i in range(1, samples + 1):
            t = i / samples
            progress = time_to_progress(t)
            delta = abs(progress - prev_progress)

            assert delta <= max_allowed_jump, \
                f"Discontinuity at t={t}: jump of {delta*100:.2f}%"

            prev_progress = progress

    def test_curve_is_smooth(self):
        """The easing curve should be smooth without sharp corners."""
        # Sample densely across the full range
        samples = []
        for i in range(200):
            t = i / 200
            samples.append((t, time_to_progress(t)))

        # Check for sudden changes in derivative
        for i in range(2, len(samples)):
            t0, p0 = samples[i-2]
            t1, p1 = samples[i-1]
            t2, p2 = samples[i]

            if t1 - t0 == 0 or t2 - t1 == 0:
                continue

            # Approximate first derivatives
            d1 = (p1 - p0) / (t1 - t0)
            d2 = (p2 - p1) / (t2 - t1)

            # Derivative shouldn't change too abruptly
            deriv_change = abs(d2 - d1)
            assert deriv_change < 0.5, \
                f"Sharp corner at t={t1}: derivative jumped from {d1:.3f} to {d2:.3f}"


class TestEasingNumericalStability:
    """Test numerical stability of the function."""

    def test_very_small_inputs(self):
        """Very small t values should not cause numerical issues."""
        tiny_values = [1e-10, 1e-15, 1e-100, 0.0000001]

        for t in tiny_values:
            progress = time_to_progress(t)
            assert not math.isnan(progress), f"NaN at t={t}"
            assert not math.isinf(progress), f"Inf at t={t}"
            assert 0 <= progress <= 1, f"Out of range at t={t}: {progress}"

    def test_values_very_close_to_one(self):
        """t values very close to 1 should not cause numerical issues."""
        near_one = [0.999, 0.9999, 0.99999, 1 - 1e-10, 1 - 1e-15]

        for t in near_one:
            progress = time_to_progress(t)
            assert not math.isnan(progress), f"NaN at t={t}"
            assert not math.isinf(progress), f"Inf at t={t}"
            # Should be very close to 1
            assert progress > 0.99, f"Too low at t={t}: {progress}"


class TestEasingEdgeCases:
    """Test edge cases and potential bugs."""

    def test_key_points_are_well_defined(self):
        """Test behavior at key time points."""
        # Test various points across the range
        key_points = [0.2, 0.4, 0.5, 0.6, 0.8]

        for t in key_points:
            progress = time_to_progress(t)
            assert not math.isnan(progress), f"NaN at t={t}"
            assert not math.isinf(progress), f"Inf at t={t}"
            assert 0 <= progress <= 1, f"Out of range at t={t}"

    def test_progress_at_extremes(self):
        """Test progress values at near-boundary points."""
        p_0 = time_to_progress(0.001)  # Near 0
        p_50 = time_to_progress(0.5)
        p_100 = time_to_progress(0.999)  # Near 1

        # All should be valid and in expected ranges
        assert 0 < p_0 < 0.1, f"Near-zero progress unexpected: {p_0}"
        assert 0.5 < p_50 < 0.8, f"Mid-point progress unexpected: {p_50}"
        assert 0.99 < p_100 <= 1.0, f"Near-one progress unexpected: {p_100}"
