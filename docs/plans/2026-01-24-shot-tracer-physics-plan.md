# Shot Tracer Physics & Rendering - Multi-Agent Implementation Plan

**Date:** 2026-01-24
**Status:** Ready for Implementation

## Overview

This plan enables 7 Claude Code agents to work on extending the shot tracer feature with physics-based trajectory generation and professional rendering. Each agent has exclusive ownership of specific files to avoid conflicts.

**What we're building:** A complete shot tracer system that:
1. Extracts launch parameters from early ball detections (first 100ms)
2. Generates a full physics-based 3D trajectory
3. Projects it to 2D using down-the-line perspective
4. Renders with professional comet-tail glow effects

**Key insight:** We don't need pixel-perfect ball tracking. We need accurate start/end points and a believable trajectory shape that looks professional.

---

## Background Context

### Current State

The constraint-based tracker (`detection/tracker.py`) successfully detects ~6 ball positions in the first 100ms after impact:
- X spread: ~33px (nearly vertical motion in frame)
- Y range: 101-118px above origin
- Average confidence: 0.78

This is enough to determine launch characteristics but not enough for a full tracer.

### Down-the-Line Camera Perspective

The camera is positioned behind the golfer, looking toward the target. This means:
- Ball moves **away** from camera (Z-axis = distance toward target)
- Vertical arc is **compressed** due to viewing angle
- Draw/fade curves are clearly visible as left/right deviation
- Objects appear smaller as they move away (perspective foreshortening)

The tracer line should converge toward a vanishing point on the horizon.

### Visual Style Reference

Based on industry standards (Shot Tracer App, YouTube golf channels):
- **Line styles:** Solid tapered, comet trail, or hybrid
- **Colors:** Typically white/bright with customizable options
- **Effects:** Gaussian blur glow, opacity fade on tail
- **Animation:** Progressive drawing as ball travels

---

## Architecture

```
Early Detections (6 points, 100ms)
    │
    ▼
Task 2: Trajectory Physics Module
    │ extracts launch params, generates 3D trajectory
    ▼
Task 3: DTL Perspective Projection
    │ projects 3D points to 2D screen coords
    ▼
Task 4: Landing Point Estimator
    │ estimates where ball lands/exits frame
    ▼
Task 5: Bezier Curve Fitting
    │ smooths points into render-ready curves
    ▼
Task 6: Enhanced Tracer Renderer
    │ renders with comet tail, glow, fade
    ▼
Video Output with Professional Shot Tracer
```

---

## Task 1: Shot Tracer Style Skill

**Owner:** Agent 1
**File to CREATE:** `.claude/skills/shot-tracer-style.md`
**Dependencies:** None (can start immediately)

### Purpose

Create a skill document that serves as the authoritative visual style reference for shot tracer rendering. This will be consumed by Task 6 and any future tracer work.

### Instructions

Create a skill file that documents:

1. **Line Style Options**
   - Solid tapered: constant color, width tapers from thick→thin along length
   - Comet trail: bright head with fading tail behind it
   - Hybrid: solid line with additional comet glow layer

2. **Color Specifications**
   - Default: Pure white (#FFFFFF) for maximum visibility
   - Glow: Same color with reduced opacity (0.3-0.5 alpha)
   - Alternative colors for different shot types (optional)

3. **Glow Effect Parameters**
   - Blur radius: 8-12px for subtle glow, 15-20px for dramatic
   - Glow layer drawn first (thicker line), then sharp line on top
   - Glow intensity: 0.3-0.5 opacity blend

4. **Comet Tail Animation**
   - Tail length: 0.3-0.5 seconds of trail behind current position
   - Opacity gradient: 100% at head → 0% at tail end
   - Width gradient: full width at head → 50% width at tail (optional)

5. **Progressive Animation**
   - Line draws progressively as ball travels (not all at once)
   - Current ball position = head of the tracer
   - Past positions = fading tail

6. **Down-the-Line Specific Considerations**
   - Tracer should converge toward vanishing point
   - Line may appear thinner as it goes into distance (perspective)
   - Consider subtle perspective-based width scaling

### File Template

```markdown
---
name: shot-tracer-style
description: Visual style reference for golf shot tracer rendering
---

# Shot Tracer Visual Style Guide

## Overview
[Purpose and when to reference this skill]

## Line Styles
### Solid Tapered
[Description and parameters]

### Comet Trail
[Description and parameters]

### Hybrid (Recommended)
[Description and parameters]

## Color Palette
[Default colors and alternatives]

## Glow Effect
[Blur, opacity, layering details]

## Animation Timing
[Progressive draw, tail fade, etc.]

## Down-the-Line Perspective
[Perspective-specific rendering notes]

## Implementation Checklist
- [ ] Glow layer rendered first
- [ ] Sharp line rendered on top
- [ ] Opacity fades along tail
- [ ] Progressive animation synced to video time
- [ ] Perspective width scaling (optional)
```

### Verification

Read the created skill file and verify it contains actionable specifications for a renderer implementation.

---

## Task 2: Trajectory Physics Module

**Owner:** Agent 2
**File to CREATE:** `src/backend/detection/trajectory_physics.py`
**Dependencies:** None (can start immediately)

### Purpose

Generate a complete 3D ball trajectory from launch parameters extracted from early detections.

### Physics Model

**Coordinate System (3D):**
- X: left/right deviation (negative = draw for RH, positive = fade)
- Y: height above ground
- Z: distance toward target (away from camera)

**Equations:**
```python
# Time-based position
Z(t) = initial_velocity_z * t
Y(t) = initial_velocity_y * t - 0.5 * gravity * t²
X(t) = initial_velocity_x * t + curve_acceleration * t²

# Where:
# - gravity ≈ 9.8 m/s² (but we work in pixels, so calibrate)
# - curve_acceleration models draw/fade spin effects
```

**Launch Parameter Extraction:**

From early detection points (first 6 points in ~100ms):
```python
# Calculate velocities from position differences
delta_positions = points[1:] - points[:-1]
delta_times = timestamps[1:] - timestamps[:-1]
velocities = delta_positions / delta_times

# Initial velocity components
v_y = average(velocities[:, 1])  # vertical
v_x = average(velocities[:, 0])  # lateral

# Launch angle
launch_angle = arctan2(v_y, estimated_v_z)

# Lateral direction (draw/fade tendency)
lateral_angle = arctan2(v_x, estimated_v_z)
```

### Interface

```python
@dataclass
class LaunchParameters:
    """Extracted launch characteristics."""
    origin: Tuple[float, float]      # Screen position (x, y) at impact
    launch_angle_deg: float          # Vertical launch angle (typically 10-30°)
    lateral_angle_deg: float         # Left/right deviation (-15° to +15°)
    initial_speed: float             # Estimated initial speed (pixels/second)
    estimated_flight_time: float     # Estimated total flight duration
    shot_shape: str                  # "draw", "fade", or "straight"


@dataclass
class Trajectory3D:
    """Complete 3D trajectory."""
    points: List[Tuple[float, float, float]]  # (x, y, z) at each timestamp
    timestamps: List[float]                    # Time for each point
    apex_index: int                            # Index of highest point
    landing_index: int                         # Index of landing point


class TrajectoryPhysics:
    """Generate physics-based ball trajectories."""

    def extract_launch_params(
        self,
        early_detections: List[dict],  # First ~6 detected points
        frame_width: int,
        frame_height: int,
    ) -> LaunchParameters:
        """Extract launch parameters from early ball detections.

        Args:
            early_detections: List of dicts with 'timestamp', 'x', 'y' (normalized 0-1)
            frame_width: Video frame width for denormalization
            frame_height: Video frame height

        Returns:
            LaunchParameters with extracted characteristics
        """
        ...

    def generate_trajectory(
        self,
        launch_params: LaunchParameters,
        duration: float = 4.0,          # Max flight time in seconds
        sample_rate: float = 30.0,      # Points per second
    ) -> Trajectory3D:
        """Generate complete 3D trajectory from launch parameters.

        Args:
            launch_params: Extracted launch characteristics
            duration: Maximum flight duration to simulate
            sample_rate: How many points per second to generate

        Returns:
            Trajectory3D with full flight path
        """
        ...

    def classify_shot_shape(
        self,
        lateral_angle_deg: float,
        curve_rate: float,
    ) -> str:
        """Classify shot as draw, fade, or straight.

        Returns: "draw", "fade", or "straight"
        """
        ...
```

### Implementation Notes

1. **Gravity calibration:** Since we work in pixels not meters, calibrate gravity constant based on typical ball flight appearance. Start with `g = 500 pixels/s²` and tune.

2. **Flight time estimation:** Typical golf shots:
   - Driver: 4-6 seconds
   - Iron: 3-5 seconds
   - Wedge: 2-4 seconds

   Estimate from launch angle (higher = longer flight).

3. **Shot shape thresholds:**
   - Straight: lateral angle within ±2°
   - Draw: lateral angle < -2° (going left for RH)
   - Fade: lateral angle > +2° (going right for RH)

4. **Apex calculation:** The apex occurs when Y velocity = 0:
   ```python
   t_apex = initial_velocity_y / gravity
   ```

### Verification

```bash
cd src/backend && python -c "
from backend.detection.trajectory_physics import TrajectoryPhysics, LaunchParameters

physics = TrajectoryPhysics()

# Test with mock early detections (normalized coords)
detections = [
    {'timestamp': 0.000, 'x': 0.50, 'y': 0.80},
    {'timestamp': 0.017, 'x': 0.50, 'y': 0.78},
    {'timestamp': 0.033, 'x': 0.49, 'y': 0.75},
    {'timestamp': 0.050, 'x': 0.49, 'y': 0.72},
    {'timestamp': 0.067, 'x': 0.48, 'y': 0.68},
    {'timestamp': 0.083, 'x': 0.48, 'y': 0.64},
]

params = physics.extract_launch_params(detections, 1920, 1080)
print(f'Launch angle: {params.launch_angle_deg:.1f}°')
print(f'Lateral angle: {params.lateral_angle_deg:.1f}°')
print(f'Shot shape: {params.shot_shape}')

traj = physics.generate_trajectory(params, duration=3.0)
print(f'Generated {len(traj.points)} trajectory points')
print(f'Apex at index {traj.apex_index}')
print('Trajectory physics module working!')
"
```

---

## Task 3: DTL Perspective Projection

**Owner:** Agent 3
**File to CREATE:** `src/backend/detection/perspective.py`
**Dependencies:** None (can start immediately)

### Purpose

Project 3D trajectory points to 2D screen coordinates using down-the-line perspective projection.

### Perspective Model

For a down-the-line (DTL) camera view:
- Camera is at origin, looking toward +Z (target)
- Ball starts near camera and moves away
- Objects appear smaller as Z increases
- Parallel lines converge to vanishing point

**Projection equations:**
```python
# Perspective projection
scale = focal_length / (focal_length + z)
screen_x = origin_x + x * scale
screen_y = origin_y - y * scale  # Negative because screen Y is inverted

# Where:
# - focal_length controls perspective strength (higher = less distortion)
# - origin is where the ball starts on screen (golfer position)
```

### Interface

```python
@dataclass
class CameraParams:
    """Down-the-line camera parameters."""
    focal_length: float = 1000.0     # Controls perspective strength
    origin_x: float = 0.5            # Ball origin X (normalized 0-1)
    origin_y: float = 0.8            # Ball origin Y (normalized 0-1)
    vanishing_point_y: float = 0.35  # Horizon line (normalized)
    max_depth: float = 5000.0        # Maximum Z distance in pixels


class DTLPerspective:
    """Down-the-line perspective projection."""

    def __init__(self, camera_params: CameraParams = None):
        self.params = camera_params or CameraParams()

    def project_point(
        self,
        x: float, y: float, z: float,
        frame_width: int,
        frame_height: int,
    ) -> Tuple[float, float]:
        """Project a 3D point to 2D screen coordinates.

        Args:
            x, y, z: 3D position (x=lateral, y=height, z=depth)
            frame_width, frame_height: Video dimensions

        Returns:
            (screen_x, screen_y) in normalized coordinates (0-1)
        """
        ...

    def project_trajectory(
        self,
        trajectory_3d: List[Tuple[float, float, float]],
        frame_width: int,
        frame_height: int,
    ) -> List[Tuple[float, float]]:
        """Project entire 3D trajectory to 2D.

        Args:
            trajectory_3d: List of (x, y, z) points
            frame_width, frame_height: Video dimensions

        Returns:
            List of (screen_x, screen_y) normalized coordinates
        """
        ...

    def estimate_depth_from_screen_position(
        self,
        screen_y: float,
        ball_origin_y: float,
    ) -> float:
        """Estimate Z depth from vertical screen position.

        Used to initialize depth estimates from early 2D detections.
        Lower on screen = closer to camera, higher = farther away.
        """
        ...

    def calculate_perspective_line_width(
        self,
        z: float,
        base_width: float = 3.0,
    ) -> float:
        """Calculate line width at given depth for perspective effect.

        Lines should appear thinner as they go into the distance.
        """
        ...
```

### Implementation Notes

1. **Focal length tuning:**
   - Higher focal length = less perspective distortion (more telephoto)
   - Lower focal length = more dramatic perspective (wide angle)
   - Start with 1000-1500 for typical golf video

2. **Vanishing point:**
   - Should be approximately at the horizon line
   - Typically around 30-40% from top of frame
   - All trajectory lines converge toward this point

3. **Depth estimation from 2D:**
   - Since we only have 2D detections, estimate depth from screen Y position
   - Higher on screen = farther away (converging to vanishing point)
   - Use linear interpolation between origin and vanishing point

4. **Line width scaling:**
   ```python
   width = base_width * (focal_length / (focal_length + z))
   ```

### Verification

```bash
cd src/backend && python -c "
from backend.detection.perspective import DTLPerspective, CameraParams

params = CameraParams(
    focal_length=1200,
    origin_x=0.5,
    origin_y=0.8,
    vanishing_point_y=0.35,
)
perspective = DTLPerspective(params)

# Test projection: point at origin should stay at origin
x, y = perspective.project_point(0, 0, 0, 1920, 1080)
print(f'Origin projects to: ({x:.2f}, {y:.2f})')
assert abs(x - 0.5) < 0.01 and abs(y - 0.8) < 0.01

# Test perspective: point far away should be near vanishing point
x, y = perspective.project_point(0, 500, 4000, 1920, 1080)
print(f'Distant point projects to: ({x:.2f}, {y:.2f})')
assert y < 0.5  # Should be higher on screen (closer to vanishing point)

# Test line width
near_width = perspective.calculate_perspective_line_width(100)
far_width = perspective.calculate_perspective_line_width(3000)
print(f'Line widths: near={near_width:.1f}, far={far_width:.1f}')
assert near_width > far_width

print('DTL Perspective module working!')
"
```

---

## Task 4: Landing Point Estimator

**Owner:** Agent 4
**File to CREATE:** `src/backend/detection/landing.py`
**Dependencies:** None (can start immediately)

### Purpose

Estimate where the ball lands or exits the frame to complete the trajectory.

### Estimation Methods

1. **Audio-based:** Detect the "thud" sound when ball lands
2. **Frame exit:** Detect when ball leaves the visible frame
3. **Physics-based:** Calculate landing from launch parameters

### Interface

```python
@dataclass
class LandingEstimate:
    """Estimated landing point and method used."""
    timestamp: float              # When ball lands (seconds from strike)
    position: Tuple[float, float] # Screen position (normalized 0-1)
    confidence: float             # 0-1 confidence in estimate
    method: str                   # "audio", "frame_exit", or "physics"
    frame_exit_edge: str = None   # "top", "left", "right" if method=frame_exit


class LandingEstimator:
    """Estimate ball landing point."""

    def estimate_from_audio(
        self,
        audio_path: str,
        strike_time: float,
        max_flight_time: float = 6.0,
    ) -> Optional[LandingEstimate]:
        """Detect landing thud in audio track.

        Look for a transient sound 2-6 seconds after strike.
        Landing thuds are typically lower frequency than strikes.

        Returns:
            LandingEstimate if thud detected, None otherwise
        """
        ...

    def estimate_from_trajectory(
        self,
        trajectory_2d: List[Tuple[float, float]],
        timestamps: List[float],
    ) -> Optional[LandingEstimate]:
        """Estimate landing from trajectory leaving frame or hitting ground.

        Args:
            trajectory_2d: 2D screen coordinates (normalized)
            timestamps: Timestamp for each point

        Returns:
            LandingEstimate with frame_exit info if applicable
        """
        ...

    def estimate_from_physics(
        self,
        launch_angle_deg: float,
        initial_speed: float,
    ) -> LandingEstimate:
        """Estimate landing purely from physics.

        Uses projectile motion equations to estimate flight time
        and landing distance.

        Returns:
            LandingEstimate with physics-based prediction
        """
        ...

    def get_best_estimate(
        self,
        audio_path: Optional[str],
        strike_time: float,
        trajectory_2d: List[Tuple[float, float]],
        timestamps: List[float],
        launch_params: 'LaunchParameters',
    ) -> LandingEstimate:
        """Get the best landing estimate using all available methods.

        Priority:
        1. Audio detection (most accurate if available)
        2. Frame exit detection (reliable but less precise)
        3. Physics estimation (always available fallback)
        """
        ...
```

### Audio Landing Detection

Landing sounds differ from strike sounds:
- **Strike:** High-frequency transient, sharp attack (2500-4500 Hz centroid)
- **Landing:** Lower frequency thud, softer attack (1000-2000 Hz centroid)

Detection approach:
1. Skip first 1.5 seconds (ball still in air)
2. Look for transient with lower spectral centroid
3. Require minimum time gap from strike (1.5s)
4. Return highest confidence candidate

### Frame Exit Detection

Check if trajectory crosses frame boundaries:
```python
def detect_frame_exit(points, timestamps):
    for i, (x, y) in enumerate(points):
        if x < 0.02:  # Left edge
            return LandingEstimate(timestamps[i], (0, y), 0.7, "frame_exit", "left")
        if x > 0.98:  # Right edge
            return LandingEstimate(timestamps[i], (1, y), 0.7, "frame_exit", "right")
        if y < 0.05:  # Top edge (ball going into distance)
            return LandingEstimate(timestamps[i], (x, 0), 0.8, "frame_exit", "top")
    return None
```

### Physics Fallback

If no audio or frame exit detected:
```python
# Projectile motion: landing time when y = 0
# t_land = 2 * v_y / g
flight_time = 2 * initial_speed * sin(launch_angle) / gravity
```

### Verification

```bash
cd src/backend && python -c "
from backend.detection.landing import LandingEstimator, LandingEstimate

estimator = LandingEstimator()

# Test physics estimation
estimate = estimator.estimate_from_physics(
    launch_angle_deg=25.0,
    initial_speed=1500.0,  # pixels/second
)
print(f'Physics estimate: lands at t={estimate.timestamp:.2f}s')
print(f'Method: {estimate.method}, confidence: {estimate.confidence:.2f}')

# Test frame exit detection
trajectory = [
    (0.5, 0.8), (0.48, 0.6), (0.45, 0.4),
    (0.42, 0.2), (0.40, 0.08), (0.38, 0.02)  # Exits top
]
timestamps = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5]
estimate = estimator.estimate_from_trajectory(trajectory, timestamps)
print(f'Frame exit at t={estimate.timestamp:.2f}s, edge={estimate.frame_exit_edge}')

print('Landing estimator working!')
"
```

---

## Task 5: Bezier Curve Fitting

**Owner:** Agent 5
**File to CREATE:** `src/backend/processing/curves.py`
**Dependencies:** None (can start immediately)

### Purpose

Fit smooth Bezier curves through trajectory points for high-quality rendering. Raw points create jagged lines; Bezier curves create the smooth, professional look.

### Why Bezier Curves?

1. **Smoothness:** Natural-looking curves without sharp angles
2. **Control:** Adjustable tension for different shot types
3. **Efficiency:** Fewer control points needed than raw samples
4. **Interpolation:** Easy to sample at any resolution for rendering

### Interface

```python
@dataclass
class BezierCurve:
    """A cubic Bezier curve segment."""
    p0: Tuple[float, float]  # Start point
    p1: Tuple[float, float]  # Control point 1
    p2: Tuple[float, float]  # Control point 2
    p3: Tuple[float, float]  # End point
    t_start: float           # Start timestamp
    t_end: float             # End timestamp


@dataclass
class TrajectorySpline:
    """Complete trajectory as connected Bezier curves."""
    curves: List[BezierCurve]
    total_duration: float

    def sample_at_time(self, t: float) -> Tuple[float, float]:
        """Get position at specific timestamp."""
        ...

    def sample_uniform(self, num_points: int) -> List[Tuple[float, float]]:
        """Sample uniform points along the curve."""
        ...


class CurveFitter:
    """Fit Bezier curves to trajectory points."""

    def fit_trajectory(
        self,
        points: List[Tuple[float, float]],
        timestamps: List[float],
        smoothness: float = 0.5,
    ) -> TrajectorySpline:
        """Fit a smooth spline through trajectory points.

        Args:
            points: List of (x, y) coordinates
            timestamps: Time for each point
            smoothness: 0 = pass through all points, 1 = maximum smoothing

        Returns:
            TrajectorySpline with connected Bezier segments
        """
        ...

    def simplify_points(
        self,
        points: List[Tuple[float, float]],
        tolerance: float = 0.01,
    ) -> List[Tuple[float, float]]:
        """Reduce number of points while preserving shape.

        Uses Ramer-Douglas-Peucker algorithm.
        """
        ...

    def calculate_control_points(
        self,
        p0: Tuple[float, float],
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        tension: float = 0.5,
    ) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        """Calculate Bezier control points for smooth connection.

        Uses Catmull-Rom to Bezier conversion for C1 continuity.
        """
        ...

    def evaluate_bezier(
        self,
        curve: BezierCurve,
        t: float,  # 0-1 within this segment
    ) -> Tuple[float, float]:
        """Evaluate cubic Bezier at parameter t.

        B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        """
        ...
```

### Catmull-Rom to Bezier Conversion

For smooth curves through points, convert Catmull-Rom splines to Bezier:

```python
def catmull_rom_to_bezier(p0, p1, p2, p3, tension=0.5):
    """Convert Catmull-Rom segment to cubic Bezier.

    Given 4 points where we want to draw curve from p1 to p2:
    - p0: point before p1 (for tangent calculation)
    - p1: start of curve segment
    - p2: end of curve segment
    - p3: point after p2 (for tangent calculation)
    """
    # Tangent at p1
    t1 = ((p2[0] - p0[0]) * tension, (p2[1] - p0[1]) * tension)
    # Tangent at p2
    t2 = ((p3[0] - p1[0]) * tension, (p3[1] - p1[1]) * tension)

    # Bezier control points
    cp1 = (p1[0] + t1[0] / 3, p1[1] + t1[1] / 3)
    cp2 = (p2[0] - t2[0] / 3, p2[1] - t2[1] / 3)

    return BezierCurve(p0=p1, p1=cp1, p2=cp2, p3=p2)
```

### Implementation Notes

1. **Handle endpoints:** First and last segments need special handling (duplicate first/last point for tangent calculation)

2. **Ramer-Douglas-Peucker simplification:**
   ```python
   def rdp_simplify(points, epsilon):
       if len(points) < 3:
           return points
       # Find point with maximum distance from line
       dmax = 0
       index = 0
       for i in range(1, len(points) - 1):
           d = perpendicular_distance(points[i], points[0], points[-1])
           if d > dmax:
               dmax = d
               index = i
       # If max distance > epsilon, recursively simplify
       if dmax > epsilon:
           left = rdp_simplify(points[:index+1], epsilon)
           right = rdp_simplify(points[index:], epsilon)
           return left[:-1] + right
       else:
           return [points[0], points[-1]]
   ```

3. **Tension parameter:**
   - 0.0 = sharp corners (linear interpolation)
   - 0.5 = standard smooth curves
   - 1.0 = very loose, flowing curves

### Verification

```bash
cd src/backend && python -c "
from backend.processing.curves import CurveFitter, BezierCurve

fitter = CurveFitter()

# Test with parabolic trajectory points
import math
points = [(0.5 + i*0.05, 0.8 - 0.1*i + 0.02*i*i) for i in range(10)]
timestamps = [i * 0.3 for i in range(10)]

spline = fitter.fit_trajectory(points, timestamps, smoothness=0.5)
print(f'Fitted {len(spline.curves)} Bezier segments')

# Test sampling
p1 = spline.sample_at_time(0.0)
p2 = spline.sample_at_time(1.5)
print(f'Sample at t=0: {p1}')
print(f'Sample at t=1.5: {p2}')

# Test simplification
simplified = fitter.simplify_points(points, tolerance=0.02)
print(f'Simplified {len(points)} points to {len(simplified)}')

print('Bezier curve fitting working!')
"
```

---

## Task 6: Enhanced Tracer Renderer

**Owner:** Agent 6
**File to MODIFY:** `src/backend/processing/tracer.py`
**Dependencies:** Task 1 (shot-tracer-style skill for reference)

### Purpose

Enhance the existing tracer renderer with:
1. Comet tail effect (fading trail behind ball)
2. Improved glow with proper layering
3. Perspective-based line width
4. Progressive animation improvements

### Current State

The existing `TracerRenderer` class in `tracer.py` has basic line drawing with glow. We need to enhance it without breaking existing functionality.

### Changes Required

**1. Add new TracerStyle options:**

```python
@dataclass
class TracerStyle:
    """Configuration for tracer visual appearance."""
    # Existing fields...
    color: Tuple[int, int, int] = (255, 255, 255)
    line_width: int = 3
    glow_enabled: bool = True
    glow_color: Tuple[int, int, int] = (255, 255, 255)
    glow_radius: int = 8
    glow_intensity: float = 0.5

    # NEW fields for enhanced rendering
    style_mode: str = "hybrid"           # "solid", "comet", or "hybrid"
    tail_length_seconds: float = 0.4     # How much trail to show
    tail_fade: bool = True               # Fade opacity along tail
    tail_width_taper: bool = True        # Taper width along tail
    perspective_width: bool = True       # Scale width by depth
    min_line_width: float = 1.0          # Minimum width at far distance
```

**2. Add comet tail rendering:**

```python
def _draw_comet_tail(
    self,
    frame: np.ndarray,
    points: List[Tuple[int, int]],
    timestamps: List[float],
    current_time: float,
    depths: Optional[List[float]] = None,
) -> np.ndarray:
    """Draw tracer with comet tail effect.

    Args:
        frame: BGR image to draw on
        points: Pixel coordinates for each point
        timestamps: Time for each point
        current_time: Current video time
        depths: Optional Z-depth for each point (for perspective width)
    """
    tail_start_time = current_time - self.style.tail_length_seconds

    # Find points in the tail range
    tail_points = []
    tail_alphas = []
    tail_widths = []

    for i, (pt, t) in enumerate(zip(points, timestamps)):
        if tail_start_time <= t <= current_time:
            # Calculate fade (1.0 at head, 0.0 at tail end)
            progress = (t - tail_start_time) / self.style.tail_length_seconds
            alpha = progress if self.style.tail_fade else 1.0

            # Calculate width
            width = self.style.line_width
            if self.style.tail_width_taper:
                width = width * (0.5 + 0.5 * progress)
            if self.style.perspective_width and depths:
                width = self._perspective_width(width, depths[i])
            width = max(width, self.style.min_line_width)

            tail_points.append(pt)
            tail_alphas.append(alpha)
            tail_widths.append(width)

    if len(tail_points) < 2:
        return frame

    # Draw segments with varying alpha and width
    for i in range(len(tail_points) - 1):
        self._draw_segment_with_glow(
            frame,
            tail_points[i],
            tail_points[i + 1],
            alpha=(tail_alphas[i] + tail_alphas[i + 1]) / 2,
            width=int((tail_widths[i] + tail_widths[i + 1]) / 2),
        )

    # Draw bright head
    if tail_points:
        self._draw_head_marker(frame, tail_points[-1])

    return frame
```

**3. Add segment drawing with alpha:**

```python
def _draw_segment_with_glow(
    self,
    frame: np.ndarray,
    p1: Tuple[int, int],
    p2: Tuple[int, int],
    alpha: float,
    width: int,
) -> None:
    """Draw a single line segment with glow at specified opacity."""
    if alpha < 0.05:
        return

    # Create overlay for alpha blending
    overlay = frame.copy()

    if self.style.glow_enabled:
        # Draw glow first (thicker, blurred)
        glow_width = width + self.style.glow_radius
        cv2.line(overlay, p1, p2, self.style.glow_color, glow_width, cv2.LINE_AA)

    # Draw main line
    cv2.line(overlay, p1, p2, self.style.color, width, cv2.LINE_AA)

    # Blend with alpha
    cv2.addWeighted(overlay, alpha * self.style.glow_intensity, frame, 1 - alpha * self.style.glow_intensity, 0, frame)
```

**4. Update main render method:**

Update `render_tracer_on_frame` to use the new comet rendering:

```python
def render_tracer_on_frame(self, frame, trajectory_points, current_time, ...):
    # ... existing filtering logic ...

    if self.style.style_mode == "comet":
        return self._draw_comet_tail(frame, pixel_points, timestamps, current_time, depths)
    elif self.style.style_mode == "hybrid":
        # Draw solid line first, then comet overlay
        frame = self._draw_tracer_line(frame, all_pixel_points)
        return self._draw_comet_tail(frame, pixel_points, timestamps, current_time, depths)
    else:  # "solid"
        return self._draw_tracer_line(frame, pixel_points)
```

### Reference the Style Skill

Read `.claude/skills/shot-tracer-style.md` (created in Task 1) for detailed visual specifications.

### Verification

```bash
cd src/backend && python -c "
from backend.processing.tracer import TracerRenderer, TracerStyle
import numpy as np

# Test new style options
style = TracerStyle(
    style_mode='comet',
    tail_length_seconds=0.4,
    tail_fade=True,
    perspective_width=True,
)
renderer = TracerRenderer(style)

# Create test frame and points
frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
points = [
    {'timestamp': 0.0, 'x': 0.5, 'y': 0.8},
    {'timestamp': 0.2, 'x': 0.48, 'y': 0.6},
    {'timestamp': 0.4, 'x': 0.46, 'y': 0.45},
    {'timestamp': 0.6, 'x': 0.44, 'y': 0.35},
]

result = renderer.render_tracer_on_frame(frame, points, 0.6, 1920, 1080)
print(f'Rendered frame shape: {result.shape}')

# Check that something was drawn (not all black)
assert result.sum() > 0, 'No tracer was drawn'
print('Enhanced tracer renderer working!')
"
```

---

## Task 7: Integration & Pipeline

**Owner:** Agent 7
**Files to MODIFY:** `src/backend/detection/tracker.py`, `src/backend/detection/pipeline.py`
**Dependencies:** Tasks 2-6 must be complete

### Purpose

Wire all the new modules together into the detection pipeline.

### Changes to `tracker.py`

The `ConstrainedBallTracker` currently returns early detections. Extend it to:
1. Pass early detections to trajectory physics
2. Generate full trajectory
3. Project to 2D
4. Estimate landing
5. Fit curves
6. Return complete trajectory data

```python
# Add imports at top
from backend.detection.trajectory_physics import TrajectoryPhysics
from backend.detection.perspective import DTLPerspective, CameraParams
from backend.detection.landing import LandingEstimator
from backend.processing.curves import CurveFitter


class ConstrainedBallTracker:
    def __init__(self, ...):
        # Existing init...

        # Add new components
        self.physics = TrajectoryPhysics()
        self.perspective = DTLPerspective()
        self.landing_estimator = LandingEstimator()
        self.curve_fitter = CurveFitter()

    def track_full_trajectory(
        self,
        video_path: str,
        origin_point: Tuple[float, float],
        strike_time: float,
        frame_width: int,
        frame_height: int,
        audio_path: Optional[str] = None,
    ) -> dict:
        """Track ball and generate complete trajectory.

        Returns:
            Dict with:
            - points: List of trajectory points (normalized 0-1)
            - timestamps: Time for each point
            - apex_point: Highest point
            - landing_point: Estimated landing
            - confidence: Overall trajectory confidence
            - method: How trajectory was generated
        """
        # 1. Get early detections (existing method)
        early_detections = self.track_flight(
            video_path, origin_point, strike_time,
            end_time=strike_time + 0.15  # First 150ms
        )

        if len(early_detections) < 3:
            logger.warning("Insufficient early detections for trajectory")
            return None

        # 2. Extract launch parameters
        launch_params = self.physics.extract_launch_params(
            early_detections, frame_width, frame_height
        )

        # 3. Generate 3D trajectory
        trajectory_3d = self.physics.generate_trajectory(
            launch_params,
            duration=4.0
        )

        # 4. Project to 2D
        trajectory_2d = self.perspective.project_trajectory(
            trajectory_3d.points,
            frame_width,
            frame_height,
        )

        # 5. Estimate landing
        landing = self.landing_estimator.get_best_estimate(
            audio_path=audio_path,
            strike_time=strike_time,
            trajectory_2d=trajectory_2d,
            timestamps=trajectory_3d.timestamps,
            launch_params=launch_params,
        )

        # 6. Trim trajectory to landing
        landing_idx = self._find_timestamp_index(
            trajectory_3d.timestamps,
            landing.timestamp
        )
        trajectory_2d = trajectory_2d[:landing_idx + 1]
        timestamps = trajectory_3d.timestamps[:landing_idx + 1]

        # 7. Fit smooth curves
        spline = self.curve_fitter.fit_trajectory(
            trajectory_2d, timestamps, smoothness=0.5
        )

        # 8. Sample final points
        final_points = spline.sample_uniform(num_points=60)
        final_timestamps = [
            i * (timestamps[-1] / 59) for i in range(60)
        ]

        return {
            "points": [
                {
                    "timestamp": t + strike_time,
                    "x": p[0],
                    "y": p[1],
                    "confidence": 0.8,
                    "interpolated": True,
                }
                for t, p in zip(final_timestamps, final_points)
            ],
            "apex_point": {
                "timestamp": trajectory_3d.timestamps[trajectory_3d.apex_index] + strike_time,
                "x": trajectory_2d[trajectory_3d.apex_index][0],
                "y": trajectory_2d[trajectory_3d.apex_index][1],
            },
            "landing_point": {
                "timestamp": landing.timestamp + strike_time,
                "x": landing.position[0],
                "y": landing.position[1],
            },
            "confidence": 0.75,  # Physics-based trajectory
            "method": "physics_projection",
            "launch_angle": launch_params.launch_angle_deg,
            "shot_shape": launch_params.shot_shape,
        }
```

### Changes to `pipeline.py`

Update the pipeline to use the new full trajectory tracking:

```python
# In the section where trajectories are captured (around line 539-582)
# Replace or augment the existing analyze_ball_flight call:

# Try constraint-based tracking with physics extension
try:
    from backend.detection.tracker import ConstrainedBallTracker
    from backend.detection.origin import BallOriginDetector

    origin_detector = BallOriginDetector()
    tracker = ConstrainedBallTracker()

    # Detect ball origin
    origin = origin_detector.detect_origin(
        self.video_path,
        strike_time
    )

    if origin:
        # Generate full trajectory with physics
        trajectory_data = tracker.track_full_trajectory(
            video_path=self.video_path,
            origin_point=origin,
            strike_time=strike_time,
            frame_width=self._frame_width,
            frame_height=self._frame_height,
            audio_path=str(self.video_path),  # For landing detection
        )

        if trajectory_data:
            visual_features = trajectory_data
            logger.info(
                f"Generated physics trajectory for strike at {strike_time:.2f}s: "
                f"{len(trajectory_data['points'])} points, "
                f"shot_shape={trajectory_data['shot_shape']}"
            )

except Exception as e:
    logger.warning(f"Physics trajectory generation failed: {e}")
    # Fall back to existing method...
```

### Verification

```bash
# Run the test video through the pipeline
cd src && python -c "
from backend.detection.pipeline import DetectionPipeline

pipeline = DetectionPipeline('/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov')
shots = pipeline.detect_shots()

for shot in shots[:1]:  # Test first shot
    print(f'Shot at {shot.strike_time:.2f}s')
    if shot.visual_features:
        vf = shot.visual_features
        print(f'  Method: {vf.get(\"method\", \"unknown\")}')
        print(f'  Points: {len(vf.get(\"points\", []))}')
        print(f'  Shot shape: {vf.get(\"shot_shape\", \"unknown\")}')
        print(f'  Launch angle: {vf.get(\"launch_angle\", 0):.1f}°')
"
```

---

## Agent Starter Prompt

Send this message to each agent, replacing `N` with the task number (1-7):

```
Read /Users/ecoon/golf-clip/docs/plans/2026-01-24-shot-tracer-physics-plan.md and implement Task N.

Follow the instructions exactly:
1. Create or modify only the files assigned to your task
2. Implement all interfaces as specified
3. Run the verification steps and fix any issues
4. Do not modify files assigned to other tasks

When done, confirm the verification passed and summarize what you implemented.
```

---

## Integration Order

After all agents complete:

1. **Tasks 1-5** can merge immediately (no file conflicts)
2. **Task 6** depends on Task 1 for style reference
3. **Task 7** depends on Tasks 2-6 for imports

Final verification:
```bash
cd src/backend && pytest tests/ -v
cd src && uvicorn backend.main:app --port 8420
# Process test video and verify tracer renders
```

---

## Success Criteria

1. Early detections (6 points, 100ms) generate full 4-second trajectory
2. Trajectory visually matches shot shape (draw/fade/straight)
3. Tracer has professional comet-tail glow effect
4. Lines converge toward vanishing point (DTL perspective)
5. Landing point estimated within reasonable bounds
