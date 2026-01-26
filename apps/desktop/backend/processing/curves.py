"""Bezier curve fitting for smooth trajectory rendering.

This module fits smooth Bezier curves through trajectory points to create
professional-looking shot tracer lines. Raw trajectory points would create
jagged lines; Bezier curves provide natural-looking arcs.

Key features:
- Catmull-Rom to Bezier conversion for C1 continuity
- Ramer-Douglas-Peucker simplification to reduce point count
- Time-based sampling for animation synchronization
"""

from dataclasses import dataclass, field
from typing import List, Tuple, Optional
import math


@dataclass
class BezierCurve:
    """A cubic Bezier curve segment.

    Cubic Bezier curves are defined by 4 control points:
    - p0: Start point (curve passes through)
    - p1: First control point (defines tangent at p0)
    - p2: Second control point (defines tangent at p3)
    - p3: End point (curve passes through)

    The curve is evaluated using:
    B(t) = (1-t)^3 * P0 + 3*(1-t)^2*t * P1 + 3*(1-t)*t^2 * P2 + t^3 * P3
    """
    p0: Tuple[float, float]  # Start point
    p1: Tuple[float, float]  # Control point 1
    p2: Tuple[float, float]  # Control point 2
    p3: Tuple[float, float]  # End point
    t_start: float           # Start timestamp
    t_end: float             # End timestamp


@dataclass
class TrajectorySpline:
    """Complete trajectory as connected Bezier curves.

    A spline is a series of Bezier curve segments joined with
    C1 continuity (smooth tangents at connection points).
    """
    curves: List[BezierCurve]
    total_duration: float

    def sample_at_time(self, t: float) -> Tuple[float, float]:
        """Get position at specific timestamp.

        Args:
            t: Time value to sample at (0 to total_duration)

        Returns:
            (x, y) position at the given time
        """
        if not self.curves:
            raise ValueError("No curves in spline")

        # Clamp time to valid range
        t = max(0.0, min(t, self.total_duration))

        # Find which curve segment contains this time
        for curve in self.curves:
            if curve.t_start <= t <= curve.t_end:
                # Calculate local parameter (0-1) within this segment
                segment_duration = curve.t_end - curve.t_start
                if segment_duration <= 0:
                    local_t = 0.0
                else:
                    local_t = (t - curve.t_start) / segment_duration

                return _evaluate_bezier(curve, local_t)

        # If time is past the last curve, return the end point
        return self.curves[-1].p3

    def sample_uniform(self, num_points: int) -> List[Tuple[float, float]]:
        """Sample uniform points along the curve.

        Args:
            num_points: Number of evenly-spaced points to sample

        Returns:
            List of (x, y) positions sampled uniformly in time
        """
        if num_points < 2:
            return [self.sample_at_time(0.0)]

        points = []
        for i in range(num_points):
            t = (i / (num_points - 1)) * self.total_duration
            points.append(self.sample_at_time(t))

        return points


def _evaluate_bezier(curve: BezierCurve, t: float) -> Tuple[float, float]:
    """Evaluate cubic Bezier at parameter t.

    B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3

    Args:
        curve: The Bezier curve to evaluate
        t: Parameter value (0-1) within the segment

    Returns:
        (x, y) position on the curve
    """
    t = max(0.0, min(1.0, t))

    u = 1.0 - t
    u2 = u * u
    u3 = u2 * u
    t2 = t * t
    t3 = t2 * t

    x = (u3 * curve.p0[0] +
         3 * u2 * t * curve.p1[0] +
         3 * u * t2 * curve.p2[0] +
         t3 * curve.p3[0])

    y = (u3 * curve.p0[1] +
         3 * u2 * t * curve.p1[1] +
         3 * u * t2 * curve.p2[1] +
         t3 * curve.p3[1])

    return (x, y)


class CurveFitter:
    """Fit Bezier curves to trajectory points.

    This class provides methods to:
    1. Simplify point sets using Ramer-Douglas-Peucker
    2. Calculate control points using Catmull-Rom spline math
    3. Fit a complete trajectory spline through points
    """

    def fit_trajectory(
        self,
        points: List[Tuple[float, float]],
        timestamps: List[float],
        smoothness: float = 0.5,
    ) -> TrajectorySpline:
        """Fit a smooth spline through trajectory points.

        Uses Catmull-Rom to Bezier conversion for smooth curves that
        pass through the control points with C1 continuity.

        Args:
            points: List of (x, y) coordinates
            timestamps: Time for each point
            smoothness: 0 = pass through all points, 1 = maximum smoothing
                       Higher values produce looser, more flowing curves.

        Returns:
            TrajectorySpline with connected Bezier segments
        """
        if len(points) < 2:
            raise ValueError("Need at least 2 points to fit a trajectory")

        if len(points) != len(timestamps):
            raise ValueError("Points and timestamps must have same length")

        # Optionally simplify points if smoothness is high
        if smoothness > 0.3 and len(points) > 4:
            tolerance = smoothness * 0.05  # Scale tolerance with smoothness
            simplified_points = self.simplify_points(points, tolerance)
            # Find corresponding timestamps for simplified points
            simplified_timestamps = self._match_timestamps(
                points, timestamps, simplified_points
            )
            points = simplified_points
            timestamps = simplified_timestamps

        if len(points) < 2:
            raise ValueError("Too few points after simplification")

        # Special case: only 2 points - create a single linear Bezier
        if len(points) == 2:
            p0, p3 = points[0], points[1]
            # Linear interpolation for control points
            p1 = (
                p0[0] + (p3[0] - p0[0]) / 3,
                p0[1] + (p3[1] - p0[1]) / 3
            )
            p2 = (
                p0[0] + 2 * (p3[0] - p0[0]) / 3,
                p0[1] + 2 * (p3[1] - p0[1]) / 3
            )
            curve = BezierCurve(
                p0=p0, p1=p1, p2=p2, p3=p3,
                t_start=timestamps[0],
                t_end=timestamps[1]
            )
            return TrajectorySpline(
                curves=[curve],
                total_duration=timestamps[-1] - timestamps[0]
            )

        # Calculate tension from smoothness (inverse relationship)
        tension = 0.5 * (1.0 - smoothness * 0.5)

        curves = []

        # Create Bezier curves between each pair of adjacent points
        for i in range(len(points) - 1):
            # Get the 4 points needed for Catmull-Rom
            # p_prev, p_curr, p_next, p_next_next
            if i == 0:
                # First segment: duplicate first point for tangent
                p_prev = points[0]
            else:
                p_prev = points[i - 1]

            p_curr = points[i]
            p_next = points[i + 1]

            if i + 2 < len(points):
                p_next_next = points[i + 2]
            else:
                # Last segment: duplicate last point for tangent
                p_next_next = points[-1]

            # Calculate control points using Catmull-Rom to Bezier conversion
            cp1, cp2 = self.calculate_control_points(
                p_prev, p_curr, p_next, p_next_next, tension
            )

            curve = BezierCurve(
                p0=p_curr,
                p1=cp1,
                p2=cp2,
                p3=p_next,
                t_start=timestamps[i],
                t_end=timestamps[i + 1]
            )
            curves.append(curve)

        total_duration = timestamps[-1] - timestamps[0]
        return TrajectorySpline(curves=curves, total_duration=total_duration)

    def simplify_points(
        self,
        points: List[Tuple[float, float]],
        tolerance: float = 0.01,
    ) -> List[Tuple[float, float]]:
        """Reduce number of points while preserving shape.

        Uses Ramer-Douglas-Peucker algorithm to remove points that
        don't significantly affect the curve shape.

        Args:
            points: List of (x, y) coordinates
            tolerance: Maximum allowed perpendicular distance from line
                      (in normalized coordinates). Larger = more simplification.

        Returns:
            Simplified list of points
        """
        if len(points) < 3:
            return list(points)

        return self._rdp_simplify(points, tolerance)

    def _rdp_simplify(
        self,
        points: List[Tuple[float, float]],
        epsilon: float
    ) -> List[Tuple[float, float]]:
        """Ramer-Douglas-Peucker recursive simplification."""
        if len(points) < 3:
            return list(points)

        # Find point with maximum distance from line between endpoints
        dmax = 0.0
        index = 0
        start = points[0]
        end = points[-1]

        for i in range(1, len(points) - 1):
            d = self._perpendicular_distance(points[i], start, end)
            if d > dmax:
                dmax = d
                index = i

        # If max distance > epsilon, recursively simplify
        if dmax > epsilon:
            # Recursive call on both halves
            left = self._rdp_simplify(points[:index + 1], epsilon)
            right = self._rdp_simplify(points[index:], epsilon)
            # Combine results (avoid duplicating the middle point)
            return left[:-1] + right
        else:
            # No point is far enough; just keep endpoints
            return [points[0], points[-1]]

    def _perpendicular_distance(
        self,
        point: Tuple[float, float],
        line_start: Tuple[float, float],
        line_end: Tuple[float, float]
    ) -> float:
        """Calculate perpendicular distance from point to line."""
        dx = line_end[0] - line_start[0]
        dy = line_end[1] - line_start[1]

        # Handle degenerate case where line is a point
        line_length_sq = dx * dx + dy * dy
        if line_length_sq < 1e-10:
            # Return distance to the start point
            return math.sqrt(
                (point[0] - line_start[0]) ** 2 +
                (point[1] - line_start[1]) ** 2
            )

        # Calculate perpendicular distance using cross product
        # Area of triangle = 0.5 * |cross product|
        # Distance = area / (0.5 * base length) = |cross product| / base length
        cross = abs(
            (point[0] - line_start[0]) * dy -
            (point[1] - line_start[1]) * dx
        )

        return cross / math.sqrt(line_length_sq)

    def calculate_control_points(
        self,
        p0: Tuple[float, float],
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        p3: Optional[Tuple[float, float]] = None,
        tension: float = 0.5,
    ) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        """Calculate Bezier control points for smooth connection.

        Uses Catmull-Rom to Bezier conversion for C1 continuity.

        For a curve segment from p1 to p2, we need 4 points:
        - p0: Point before p1 (for tangent calculation at p1)
        - p1: Start of curve segment
        - p2: End of curve segment
        - p3: Point after p2 (for tangent calculation at p2)

        Args:
            p0: Point before the segment start (for tangent)
            p1: Start of the curve segment
            p2: End of the curve segment
            p3: Point after the segment end (for tangent).
                If None, uses p2 mirrored around p1.
            tension: Controls curve tightness (0=sharp, 0.5=standard, 1=loose)

        Returns:
            (control_point_1, control_point_2) for the Bezier curve from p1 to p2
        """
        if p3 is None:
            # Mirror p2 around p1 for endpoint case
            p3 = (2 * p2[0] - p1[0], 2 * p2[1] - p1[1])

        # Tangent at p1 (direction from p0 to p2, scaled by tension)
        t1_x = (p2[0] - p0[0]) * tension
        t1_y = (p2[1] - p0[1]) * tension

        # Tangent at p2 (direction from p1 to p3, scaled by tension)
        t2_x = (p3[0] - p1[0]) * tension
        t2_y = (p3[1] - p1[1]) * tension

        # Bezier control points
        # cp1 is p1 + tangent/3
        # cp2 is p2 - tangent/3
        cp1 = (p1[0] + t1_x / 3.0, p1[1] + t1_y / 3.0)
        cp2 = (p2[0] - t2_x / 3.0, p2[1] - t2_y / 3.0)

        return (cp1, cp2)

    def evaluate_bezier(
        self,
        curve: BezierCurve,
        t: float,  # 0-1 within this segment
    ) -> Tuple[float, float]:
        """Evaluate cubic Bezier at parameter t.

        B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3

        Args:
            curve: The Bezier curve to evaluate
            t: Parameter value between 0 (start) and 1 (end)

        Returns:
            (x, y) position on the curve at parameter t
        """
        return _evaluate_bezier(curve, t)

    def _match_timestamps(
        self,
        original_points: List[Tuple[float, float]],
        original_timestamps: List[float],
        simplified_points: List[Tuple[float, float]]
    ) -> List[float]:
        """Match timestamps to simplified points.

        Finds the closest original point for each simplified point
        and returns the corresponding timestamp.
        """
        simplified_timestamps = []

        for sp in simplified_points:
            # Find closest original point
            min_dist = float('inf')
            best_idx = 0

            for i, op in enumerate(original_points):
                dist = (sp[0] - op[0]) ** 2 + (sp[1] - op[1]) ** 2
                if dist < min_dist:
                    min_dist = dist
                    best_idx = i

            simplified_timestamps.append(original_timestamps[best_idx])

        return simplified_timestamps
