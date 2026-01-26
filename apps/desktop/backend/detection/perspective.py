"""Down-the-line perspective projection for golf shot trajectories.

This module projects 3D trajectory points to 2D screen coordinates using
perspective projection appropriate for down-the-line (DTL) camera views.

In DTL view:
- Camera is behind the golfer, looking toward the target
- Ball moves away from camera (Z-axis = distance toward target)
- Vertical arc is compressed due to viewing angle
- Draw/fade curves are clearly visible as left/right deviation
- Objects appear smaller as they move away (perspective foreshortening)
"""

from dataclasses import dataclass
from typing import List, Tuple, Optional


@dataclass
class CameraParams:
    """Down-the-line camera parameters.

    Attributes:
        focal_length: Controls perspective strength. Higher = less distortion (telephoto),
                     lower = more dramatic perspective (wide angle). Typical: 1000-1500.
        origin_x: Ball origin X position in normalized coordinates (0-1).
                  Typically 0.5 (center of frame).
        origin_y: Ball origin Y position in normalized coordinates (0-1).
                  Typically 0.8 (near bottom of frame).
        vanishing_point_y: Horizon line where parallel lines converge (normalized).
                          Typically 0.30-0.40 from top of frame.
        max_depth: Maximum Z distance in pixels for trajectory simulation.
    """
    focal_length: float = 1000.0
    origin_x: float = 0.5
    origin_y: float = 0.8
    vanishing_point_y: float = 0.35
    max_depth: float = 5000.0


class DTLPerspective:
    """Down-the-line perspective projection.

    Projects 3D trajectory points to 2D screen coordinates for rendering
    shot tracers that look natural in down-the-line golf video footage.
    """

    def __init__(self, camera_params: Optional[CameraParams] = None):
        """Initialize with camera parameters.

        Args:
            camera_params: Camera configuration. Uses defaults if not provided.
        """
        self.params = camera_params or CameraParams()

    def project_point(
        self,
        x: float,
        y: float,
        z: float,
        frame_width: int,
        frame_height: int,
    ) -> Tuple[float, float]:
        """Project a 3D point to 2D screen coordinates.

        The 3D coordinates are in NORMALIZED units where:
        - X: lateral deviation (-0.2 to +0.2 typical, negative = draw, positive = fade)
        - Y: height above ground (0 = ground, 0.4 = high apex)
        - Z: depth toward target (0 = at ball, 0.6 = far away)

        Uses perspective projection where objects appear smaller as they
        move away from the camera (increasing Z). The ground level rises
        toward the vanishing point as depth increases, matching real
        down-the-line camera perspective.

        Args:
            x: Lateral position in normalized units
            y: Height above ground in normalized units
            z: Depth/distance toward target in normalized units
            frame_width: Video frame width in pixels (used for coordinate scaling)
            frame_height: Video frame height in pixels (used for coordinate scaling)

        Returns:
            Tuple of (screen_x, screen_y) in normalized coordinates (0-1).
            The origin point maps to (origin_x, origin_y) when x=y=z=0.
        """
        # Calculate depth ratio for perspective scaling
        # z is already normalized (0 to ~0.6), scale to max_depth conceptually
        effective_z = z * self.params.max_depth
        scale = self.params.focal_length / (self.params.focal_length + effective_z)

        # Calculate depth ratio for ground level interpolation
        depth_ratio = min(z / 0.6, 1.0)  # z=0.6 reaches near horizon

        # Ground level at this depth interpolates between origin and vanishing point
        # As depth increases, the apparent ground level rises toward the horizon
        ground_y = self.params.origin_y + (self.params.vanishing_point_y - self.params.origin_y) * depth_ratio

        # Height component - y is normalized height (0 to ~0.4)
        # Scale it to create visible arc: y=0.4 should reach about mid-screen
        height_scale = 0.8  # How much of the screen the height covers
        height_offset = y * height_scale * scale

        # Final screen y is ground level minus height (up is negative in screen coords)
        screen_y = ground_y - height_offset

        # X: lateral offset from center, scaled by perspective
        # x is already small (-0.1 to +0.1), scale for visibility
        lateral_scale = 0.3  # Subtle lateral movement
        screen_x = self.params.origin_x + (x * lateral_scale * scale)

        # Clamp to valid range
        screen_x = max(0.0, min(1.0, screen_x))
        screen_y = max(0.0, min(1.0, screen_y))

        return (screen_x, screen_y)

    def project_trajectory(
        self,
        trajectory_3d: List[Tuple[float, float, float]],
        frame_width: int,
        frame_height: int,
    ) -> List[Tuple[float, float]]:
        """Project entire 3D trajectory to 2D.

        Args:
            trajectory_3d: List of (x, y, z) points representing the 3D trajectory.
            frame_width: Video frame width in pixels.
            frame_height: Video frame height in pixels.

        Returns:
            List of (screen_x, screen_y) in normalized coordinates (0-1).
        """
        result = []
        for x, y, z in trajectory_3d:
            screen_point = self.project_point(x, y, z, frame_width, frame_height)
            result.append(screen_point)
        return result

    def estimate_depth_from_screen_position(
        self,
        screen_y: float,
        ball_origin_y: Optional[float] = None,
    ) -> float:
        """Estimate Z depth from vertical screen position.

        Used to initialize depth estimates from early 2D detections.
        Lower on screen = closer to camera, higher = farther away.

        This is an inverse of the projection - given where something appears
        on screen vertically, estimate how far away it is.

        Args:
            screen_y: Y position on screen in normalized coordinates (0-1).
                      0 = top of frame, 1 = bottom of frame.
            ball_origin_y: Optional override for ball origin Y. Uses params if None.

        Returns:
            Estimated Z depth in pixels.
        """
        origin_y = ball_origin_y if ball_origin_y is not None else self.params.origin_y
        vanishing_y = self.params.vanishing_point_y

        # If screen_y is at or below origin, depth is 0 (at camera)
        if screen_y >= origin_y:
            return 0.0

        # If screen_y is at or above vanishing point, depth is at max
        if screen_y <= vanishing_y:
            return self.params.max_depth

        # Linear interpolation between origin and vanishing point
        # origin_y maps to depth=0, vanishing_y maps to depth=max_depth
        progress = (origin_y - screen_y) / (origin_y - vanishing_y)

        # Apply non-linear scaling to account for perspective
        # Objects farther away need more depth change for same screen movement
        depth = self.params.max_depth * progress * progress

        return depth

    def calculate_perspective_line_width(
        self,
        z: float,
        base_width: float = 3.0,
    ) -> float:
        """Calculate line width at given depth for perspective effect.

        Lines should appear thinner as they go into the distance,
        matching the perspective foreshortening of real objects.

        Args:
            z: Depth/distance in pixels.
            base_width: Line width at z=0 (closest to camera).

        Returns:
            Scaled line width for the given depth.
        """
        # Same scale factor as projection
        scale = self.params.focal_length / (self.params.focal_length + z)

        # Apply scale to width
        width = base_width * scale

        # Ensure minimum visible width
        return max(width, 1.0)

    def get_depths_for_trajectory(
        self,
        trajectory_3d: List[Tuple[float, float, float]],
    ) -> List[float]:
        """Extract Z depths from 3D trajectory for perspective width calculation.

        Convenience method to get depth values that can be passed to the
        tracer renderer for perspective-based line width.

        Args:
            trajectory_3d: List of (x, y, z) points.

        Returns:
            List of Z depth values.
        """
        return [z for (_, _, z) in trajectory_3d]

    def calibrate_from_detections(
        self,
        early_detections: List[dict],
        frame_width: int,
        frame_height: int,
    ) -> 'CameraParams':
        """Calibrate camera parameters from early ball detections.

        Uses the pattern of early detections to estimate camera perspective.
        This can refine the default parameters for a specific video.

        Args:
            early_detections: List of dicts with 'x', 'y' (normalized 0-1).
            frame_width: Video frame width in pixels.
            frame_height: Video frame height in pixels.

        Returns:
            Calibrated CameraParams (or current params if calibration fails).
        """
        if len(early_detections) < 3:
            return self.params

        # Extract the origin from the first detection
        origin_x = early_detections[0].get('x', self.params.origin_x)
        origin_y = early_detections[0].get('y', self.params.origin_y)

        # Calculate vertical movement to estimate perspective
        y_positions = [d.get('y', 0) for d in early_detections]
        y_range = max(y_positions) - min(y_positions)

        # If ball moves significantly upward, adjust vanishing point estimate
        # A higher trajectory might have a different apparent vanishing point
        vanishing_y = self.params.vanishing_point_y
        if y_range > 0.15:  # Significant vertical movement
            # Estimate vanishing point based on trajectory extrapolation
            vanishing_y = min(y_positions) - 0.1
            vanishing_y = max(0.1, min(0.5, vanishing_y))

        return CameraParams(
            focal_length=self.params.focal_length,
            origin_x=origin_x,
            origin_y=origin_y,
            vanishing_point_y=vanishing_y,
            max_depth=self.params.max_depth,
        )
