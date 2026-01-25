# Phase 2: Shot Tracers - Multi-Agent Implementation Plan

## Overview

This plan enables 8 Claude Code agents to work in parallel on the shot tracer feature. Each agent has exclusive ownership of specific files to avoid conflicts.

**What we're building:** Shot tracer overlays on exported golf clips - a white line with glow that follows the ball's trajectory, animated progressively during playback.

**Key insight:** The trajectory analysis code already exists in `src/backend/detection/visual.py` (`BallDetector.analyze_ball_flight()` method, lines 762-822). It returns a `FlightAnalysis` dataclass with trajectory points, apex, launch angle, etc. We just need to capture this data during detection, store it, and render it during export.

---

## Architecture Summary

```
Detection Pipeline (Task 4)
    ↓ calls analyze_ball_flight()
    ↓
Trajectory Storage (Task 1 + Task 2)
    ↓ stores in shot_trajectories table
    ↓
API Layer (Task 3 + Task 6)
    ↓ exposes via /trajectory endpoints
    ↓
Frontend Preview (Task 8)
    ↓ displays on canvas overlay
    ↓
Export with Tracer (Task 5 + Task 7)
    → renders overlay using OpenCV
```

---

## Task 1: Database Migration

**Owner:** Agent 1
**Files to MODIFY:** `src/backend/core/database.py`
**Dependencies:** None (can start immediately)

### Instructions

Add schema version 3 with a `shot_trajectories` table to store ball flight data.

### Changes Required

1. Update `SCHEMA_VERSION = 3` (line 16)

2. Add call in `_apply_migrations()` (after line 71):
```python
if current_version < 3:
    await _migrate_v3()
```

3. Add new migration function after `_migrate_v2()`:

```python
async def _migrate_v3() -> None:
    """Add shot_trajectories table for storing ball flight paths."""
    logger.info("Applying migration v3: Shot trajectories table")

    await _db_connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS shot_trajectories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            shot_id INTEGER NOT NULL,
            trajectory_json TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            smoothness_score REAL,
            physics_plausibility REAL,
            apex_x REAL,
            apex_y REAL,
            apex_timestamp REAL,
            launch_angle REAL,
            flight_duration REAL,
            has_gaps INTEGER NOT NULL DEFAULT 0,
            gap_count INTEGER NOT NULL DEFAULT 0,
            is_manual_override INTEGER NOT NULL DEFAULT 0,
            frame_width INTEGER,
            frame_height INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            UNIQUE(job_id, shot_id)
        );

        CREATE INDEX IF NOT EXISTS idx_trajectories_job ON shot_trajectories(job_id);
        CREATE INDEX IF NOT EXISTS idx_trajectories_shot ON shot_trajectories(job_id, shot_id);
        """
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (3, datetime.utcnow().isoformat(), "Shot trajectories table for ball flight paths"),
    )

    logger.info("Migration v3 applied successfully")
```

### Verification
```bash
cd src/backend && python -c "
import asyncio
from backend.core.database import init_db, get_schema_version, close_db
async def test():
    await init_db()
    v = await get_schema_version()
    print(f'Schema version: {v}')
    assert v == 3, 'Expected schema version 3'
    print('Migration v3 successful!')
    await close_db()
asyncio.run(test())
"
```

---

## Task 2: Trajectory CRUD Model

**Owner:** Agent 2
**Files to CREATE:** `src/backend/models/trajectory.py`
**Dependencies:** Task 1 (database migration) should complete first, but you can write the code now

### Instructions

Create CRUD operations for trajectory data. Store coordinates as normalized 0-1 values (percentage of frame dimensions) for resolution independence.

### File to Create: `src/backend/models/trajectory.py`

```python
"""CRUD operations for shot trajectory data."""

from datetime import datetime
from typing import Optional

from loguru import logger

from backend.core.database import get_db, serialize_json, deserialize_json


async def create_trajectory(
    job_id: str,
    shot_id: int,
    trajectory_points: list[dict],
    confidence: float,
    smoothness_score: Optional[float] = None,
    physics_plausibility: Optional[float] = None,
    apex_point: Optional[dict] = None,
    launch_angle: Optional[float] = None,
    flight_duration: Optional[float] = None,
    has_gaps: bool = False,
    gap_count: int = 0,
    frame_width: int = 1920,
    frame_height: int = 1080,
) -> int:
    """Store a trajectory for a shot.

    Args:
        job_id: The job ID
        shot_id: The shot number within the job
        trajectory_points: List of dicts with keys: timestamp, x, y, confidence, interpolated
                          x and y should be normalized to 0-1 range
        confidence: Overall trajectory confidence (0-1)
        smoothness_score: How smooth the trajectory is (0-1)
        physics_plausibility: How physically realistic (0-1)
        apex_point: Highest point dict with timestamp, x, y
        launch_angle: Estimated launch angle in degrees
        flight_duration: Ball flight time in seconds
        has_gaps: Whether trajectory has detection gaps
        gap_count: Number of interpolated points
        frame_width: Source video frame width (for denormalization)
        frame_height: Source video frame height

    Returns:
        The trajectory record ID
    """
    db = await get_db()

    # Normalize coordinates if they aren't already
    normalized_points = []
    for pt in trajectory_points:
        x = pt["x"]
        y = pt["y"]
        # If coordinates are in pixel space, normalize them
        if x > 1 or y > 1:
            x = x / frame_width
            y = y / frame_height
        normalized_points.append({
            "timestamp": pt["timestamp"],
            "x": x,
            "y": y,
            "confidence": pt.get("confidence", 0),
            "interpolated": pt.get("interpolated", False),
        })

    apex_x = None
    apex_y = None
    apex_timestamp = None
    if apex_point:
        apex_x = apex_point.get("x", 0)
        apex_y = apex_point.get("y", 0)
        if apex_x > 1:
            apex_x = apex_x / frame_width
        if apex_y > 1:
            apex_y = apex_y / frame_height
        apex_timestamp = apex_point.get("timestamp")

    cursor = await db.execute(
        """
        INSERT INTO shot_trajectories (
            job_id, shot_id, trajectory_json, confidence,
            smoothness_score, physics_plausibility,
            apex_x, apex_y, apex_timestamp,
            launch_angle, flight_duration,
            has_gaps, gap_count, is_manual_override,
            frame_width, frame_height, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, shot_id) DO UPDATE SET
            trajectory_json = excluded.trajectory_json,
            confidence = excluded.confidence,
            smoothness_score = excluded.smoothness_score,
            physics_plausibility = excluded.physics_plausibility,
            apex_x = excluded.apex_x,
            apex_y = excluded.apex_y,
            apex_timestamp = excluded.apex_timestamp,
            launch_angle = excluded.launch_angle,
            flight_duration = excluded.flight_duration,
            has_gaps = excluded.has_gaps,
            gap_count = excluded.gap_count,
            frame_width = excluded.frame_width,
            frame_height = excluded.frame_height,
            updated_at = ?
        """,
        (
            job_id, shot_id, serialize_json(normalized_points), confidence,
            smoothness_score, physics_plausibility,
            apex_x, apex_y, apex_timestamp,
            launch_angle, flight_duration,
            1 if has_gaps else 0, gap_count, 0,
            frame_width, frame_height, datetime.utcnow().isoformat(),
            datetime.utcnow().isoformat(),
        ),
    )
    await db.commit()

    logger.debug(f"Stored trajectory for job={job_id} shot={shot_id} with {len(normalized_points)} points")
    return cursor.lastrowid


async def get_trajectory(job_id: str, shot_id: int) -> Optional[dict]:
    """Get trajectory data for a specific shot.

    Returns:
        Dict with trajectory data or None if not found
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT * FROM shot_trajectories
        WHERE job_id = ? AND shot_id = ?
        """,
        (job_id, shot_id),
    ) as cursor:
        row = await cursor.fetchone()

    if not row:
        return None

    return _row_to_dict(row)


async def get_trajectories_for_job(job_id: str) -> list[dict]:
    """Get all trajectories for a job.

    Returns:
        List of trajectory dicts ordered by shot_id
    """
    db = await get_db()

    async with db.execute(
        """
        SELECT * FROM shot_trajectories
        WHERE job_id = ?
        ORDER BY shot_id
        """,
        (job_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [_row_to_dict(row) for row in rows]


async def update_trajectory(
    job_id: str,
    shot_id: int,
    trajectory_points: list[dict],
    is_manual_override: bool = True,
) -> bool:
    """Update trajectory with manual edits.

    Args:
        job_id: The job ID
        shot_id: The shot number
        trajectory_points: New trajectory points (normalized 0-1 coords)
        is_manual_override: Whether this is a manual edit

    Returns:
        True if updated, False if trajectory not found
    """
    db = await get_db()

    cursor = await db.execute(
        """
        UPDATE shot_trajectories
        SET trajectory_json = ?,
            is_manual_override = ?,
            updated_at = ?
        WHERE job_id = ? AND shot_id = ?
        """,
        (
            serialize_json(trajectory_points),
            1 if is_manual_override else 0,
            datetime.utcnow().isoformat(),
            job_id,
            shot_id,
        ),
    )
    await db.commit()

    return cursor.rowcount > 0


async def delete_trajectory(job_id: str, shot_id: int) -> bool:
    """Delete a trajectory record.

    Returns:
        True if deleted, False if not found
    """
    db = await get_db()

    cursor = await db.execute(
        "DELETE FROM shot_trajectories WHERE job_id = ? AND shot_id = ?",
        (job_id, shot_id),
    )
    await db.commit()

    return cursor.rowcount > 0


def _row_to_dict(row) -> dict:
    """Convert database row to trajectory dict."""
    points = deserialize_json(row["trajectory_json"]) or []

    apex_point = None
    if row["apex_x"] is not None and row["apex_y"] is not None:
        apex_point = {
            "x": row["apex_x"],
            "y": row["apex_y"],
            "timestamp": row["apex_timestamp"],
        }

    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "points": points,
        "confidence": row["confidence"],
        "smoothness_score": row["smoothness_score"],
        "physics_plausibility": row["physics_plausibility"],
        "apex_point": apex_point,
        "launch_angle": row["launch_angle"],
        "flight_duration": row["flight_duration"],
        "has_gaps": bool(row["has_gaps"]),
        "gap_count": row["gap_count"],
        "is_manual_override": bool(row["is_manual_override"]),
        "frame_width": row["frame_width"],
        "frame_height": row["frame_height"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
```

### Verification
```bash
cd src/backend && python -c "
import asyncio
from backend.core.database import init_db, close_db
from backend.models.trajectory import create_trajectory, get_trajectory
async def test():
    await init_db()
    # Create test trajectory
    tid = await create_trajectory(
        'test-job', 1,
        [{'timestamp': 0.0, 'x': 0.5, 'y': 0.5, 'confidence': 0.9, 'interpolated': False}],
        confidence=0.85, frame_width=1920, frame_height=1080
    )
    print(f'Created trajectory ID: {tid}')
    # Retrieve it
    t = await get_trajectory('test-job', 1)
    print(f'Retrieved: {t}')
    assert t is not None
    print('Trajectory CRUD working!')
    await close_db()
asyncio.run(test())
"
```

---

## Task 3: API Schemas

**Owner:** Agent 3
**Files to MODIFY:** `src/backend/api/schemas.py`
**Dependencies:** None (can start immediately)

### Instructions

Add Pydantic models for trajectory data and tracer styling. Add these at the END of the file to avoid conflicts.

### Changes Required

Add the following classes at the end of `schemas.py`:

```python
# === TRAJECTORY SCHEMAS (Phase 2) ===

class TrajectoryPoint(BaseModel):
    """A point in the ball's trajectory (normalized coordinates)."""
    timestamp: float = Field(..., description="Time in seconds from video start")
    x: float = Field(..., ge=0, le=1, description="X position as fraction of frame width (0-1)")
    y: float = Field(..., ge=0, le=1, description="Y position as fraction of frame height (0-1)")
    confidence: float = Field(0, ge=0, le=1, description="Detection confidence")
    interpolated: bool = Field(False, description="Whether this point was interpolated")


class TrajectoryData(BaseModel):
    """Complete trajectory data for a shot."""
    shot_id: int
    points: list[TrajectoryPoint]
    confidence: float = Field(..., ge=0, le=1)
    smoothness_score: Optional[float] = None
    physics_plausibility: Optional[float] = None
    apex_point: Optional[TrajectoryPoint] = None
    launch_angle: Optional[float] = Field(None, description="Launch angle in degrees")
    flight_duration: Optional[float] = Field(None, description="Flight time in seconds")
    has_gaps: bool = False
    gap_count: int = 0
    is_manual_override: bool = False
    frame_width: int = Field(..., description="Source video width for coordinate scaling")
    frame_height: int = Field(..., description="Source video height for coordinate scaling")


class TrajectoryUpdateRequest(BaseModel):
    """Request to update trajectory with manual edits."""
    points: list[TrajectoryPoint]


class TracerStyle(BaseModel):
    """Styling options for shot tracer rendering."""
    color: str = Field("#FFFFFF", description="Tracer line color (hex)")
    line_width: int = Field(3, ge=1, le=10, description="Line width in pixels")
    glow_enabled: bool = Field(True, description="Whether to add glow effect")
    glow_color: str = Field("#FFFFFF", description="Glow color (hex)")
    glow_radius: int = Field(8, ge=0, le=20, description="Glow blur radius")
    show_apex_marker: bool = Field(True, description="Show marker at apex point")
    show_landing_marker: bool = Field(True, description="Show marker at landing point")
    animation_speed: float = Field(1.0, ge=0.5, le=3.0, description="Animation speed multiplier")
```

Also, find the `ExportClipsRequest` class and add these fields to it:

```python
# Add these fields to ExportClipsRequest:
render_tracer: bool = Field(False, description="Whether to render shot tracer overlay")
tracer_style: Optional[TracerStyle] = Field(None, description="Tracer styling options")
```

### Verification
```bash
cd src/backend && python -c "
from backend.api.schemas import TrajectoryPoint, TrajectoryData, TracerStyle, ExportClipsRequest
# Test TrajectoryPoint
pt = TrajectoryPoint(timestamp=1.5, x=0.5, y=0.3)
print(f'TrajectoryPoint: {pt}')
# Test TracerStyle
style = TracerStyle(color='#FF0000', glow_enabled=True)
print(f'TracerStyle: {style}')
# Test ExportClipsRequest has new fields
import inspect
sig = inspect.signature(ExportClipsRequest)
assert 'render_tracer' in sig.parameters, 'render_tracer field missing'
print('All schemas valid!')
"
```

---

## Task 4: Pipeline Trajectory Capture

**Owner:** Agent 4
**Files to MODIFY:** `src/backend/detection/pipeline.py`
**Dependencies:** Task 2 (trajectory model) should exist, but you can add import and call

### Instructions

Modify the detection pipeline to capture trajectory data using the existing `analyze_ball_flight()` method and store it.

### Changes Required

1. Add import at top of file (around line 14):
```python
from backend.models.trajectory import create_trajectory
```

2. Find the section around lines 200-251 where shots are confirmed. After the visual detection (around line 220), add trajectory analysis:

Replace this block (approximately lines 243-251):
```python
                # Only include if above minimum threshold
                if combined_confidence > 0.3:
                    confirmed_shots.append({
                        "strike_time": strike_time,
                        "audio_confidence": audio_confidence,
                        "visual_confidence": visual_confidence,
                        "combined_confidence": combined_confidence,
                        "audio_features": audio_features,
                        "visual_features": None,  # TODO: Extract visual trajectory features
                    })
```

With this expanded version:
```python
                # Only include if above minimum threshold
                if combined_confidence > 0.3:
                    # Analyze ball flight trajectory for tracer rendering
                    visual_features = None
                    try:
                        flight_analysis = self.ball_detector.analyze_ball_flight(
                            self.video_path,
                            strike_time - 0.5,  # Start slightly before strike
                            min(self.video_info.duration, strike_time + 8.0),  # Up to 8 seconds of flight
                            sample_fps=30.0,
                        )

                        if flight_analysis.trajectory and len(flight_analysis.trajectory) >= 2:
                            # Convert TrajectoryPoint objects to dicts
                            trajectory_points = [
                                {
                                    "timestamp": pt.timestamp,
                                    "x": pt.x,
                                    "y": pt.y,
                                    "confidence": pt.confidence,
                                    "interpolated": pt.interpolated,
                                }
                                for pt in flight_analysis.trajectory
                            ]

                            apex_dict = None
                            if flight_analysis.apex_point:
                                apex_dict = {
                                    "timestamp": flight_analysis.apex_point.timestamp,
                                    "x": flight_analysis.apex_point.x,
                                    "y": flight_analysis.apex_point.y,
                                }

                            visual_features = {
                                "trajectory": trajectory_points,
                                "apex_point": apex_dict,
                                "launch_angle": flight_analysis.estimated_launch_angle,
                                "flight_duration": flight_analysis.flight_duration,
                                "trajectory_confidence": flight_analysis.confidence,
                                "smoothness_score": flight_analysis.smoothness_score,
                                "physics_plausibility": flight_analysis.physics_plausibility,
                                "has_gaps": flight_analysis.has_gaps,
                                "gap_count": flight_analysis.gap_count,
                            }
                            logger.debug(
                                f"Captured trajectory for strike at {strike_time:.2f}s: "
                                f"{len(trajectory_points)} points, confidence={flight_analysis.confidence:.2f}"
                            )
                    except Exception as e:
                        logger.warning(f"Failed to analyze ball flight for strike at {strike_time:.2f}s: {e}")

                    confirmed_shots.append({
                        "strike_time": strike_time,
                        "audio_confidence": audio_confidence,
                        "visual_confidence": visual_confidence,
                        "combined_confidence": combined_confidence,
                        "audio_features": audio_features,
                        "visual_features": visual_features,
                    })
```

3. In the section where `DetectedShot` objects are created (around lines 298-311), after creating the shot, store the trajectory. Add this after the `shots.append(...)` call:

```python
                # Store trajectory if available
                if shot.get("visual_features") and shot["visual_features"].get("trajectory"):
                    vf = shot["visual_features"]
                    try:
                        await create_trajectory(
                            job_id=str(self.video_path),  # Use video path as job_id for now
                            shot_id=i + 1,
                            trajectory_points=vf["trajectory"],
                            confidence=vf.get("trajectory_confidence", 0),
                            smoothness_score=vf.get("smoothness_score"),
                            physics_plausibility=vf.get("physics_plausibility"),
                            apex_point=vf.get("apex_point"),
                            launch_angle=vf.get("launch_angle"),
                            flight_duration=vf.get("flight_duration"),
                            has_gaps=vf.get("has_gaps", False),
                            gap_count=vf.get("gap_count", 0),
                            frame_width=self._frame_width or 1920,
                            frame_height=self._frame_height or 1080,
                        )
                    except Exception as e:
                        logger.warning(f"Failed to store trajectory for shot {i+1}: {e}")
```

4. Add frame dimension tracking. In `__init__` add:
```python
        self._frame_width: Optional[int] = None
        self._frame_height: Optional[int] = None
```

And after `self.video_info = self.video_processor.metadata` add:
```python
        if self.video_info:
            self._frame_width = self.video_info.width
            self._frame_height = self.video_info.height
```

### Verification
Run detection on a test video and check logs for trajectory capture messages.

---

## Task 5: Tracer Rendering Module

**Owner:** Agent 5
**Files to CREATE:** `src/backend/processing/tracer.py`
**Dependencies:** None (can start immediately)

### Instructions

Create the OpenCV-based tracer rendering module. This draws the trajectory overlay on video frames.

### File to Create: `src/backend/processing/tracer.py`

```python
"""Shot tracer rendering using OpenCV.

Renders ball flight trajectory overlays on video frames with:
- Progressive animation (line grows as ball moves)
- Glow effect (Gaussian blur on separate layer)
- Bezier curve interpolation for smooth paths
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Tuple, List
import tempfile

import cv2
import numpy as np
from loguru import logger


@dataclass
class TracerStyle:
    """Configuration for tracer visual appearance."""
    color: Tuple[int, int, int] = (255, 255, 255)  # BGR white
    line_width: int = 3
    glow_enabled: bool = True
    glow_color: Tuple[int, int, int] = (255, 255, 255)  # BGR
    glow_radius: int = 8
    glow_intensity: float = 0.5
    show_apex_marker: bool = True
    show_landing_marker: bool = True
    apex_marker_radius: int = 6
    landing_marker_radius: int = 8
    fade_tail: bool = False
    tail_length_seconds: float = 0.5  # How much trail to show behind current position

    @classmethod
    def from_dict(cls, d: dict) -> "TracerStyle":
        """Create from API dict with hex colors."""
        style = cls()
        if "color" in d:
            style.color = hex_to_bgr(d["color"])
        if "line_width" in d:
            style.line_width = d["line_width"]
        if "glow_enabled" in d:
            style.glow_enabled = d["glow_enabled"]
        if "glow_color" in d:
            style.glow_color = hex_to_bgr(d["glow_color"])
        if "glow_radius" in d:
            style.glow_radius = d["glow_radius"]
        if "show_apex_marker" in d:
            style.show_apex_marker = d["show_apex_marker"]
        if "show_landing_marker" in d:
            style.show_landing_marker = d["show_landing_marker"]
        return style


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color string to BGR tuple."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)  # OpenCV uses BGR


def bgr_to_hex(bgr: Tuple[int, int, int]) -> str:
    """Convert BGR tuple to hex string."""
    b, g, r = bgr
    return f"#{r:02x}{g:02x}{b:02x}"


class TracerRenderer:
    """Renders shot tracer overlays on video frames."""

    def __init__(self, style: Optional[TracerStyle] = None):
        self.style = style or TracerStyle()

    def render_tracer_on_frame(
        self,
        frame: np.ndarray,
        trajectory_points: List[dict],
        current_time: float,
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
    ) -> np.ndarray:
        """Render the tracer line up to current_time on a frame.

        Args:
            frame: BGR image as numpy array (modified in place)
            trajectory_points: List of dicts with timestamp, x (0-1), y (0-1)
            current_time: Current video timestamp in seconds
            frame_width: Frame width for denormalizing coordinates
            frame_height: Frame height for denormalizing coordinates
            apex_point: Optional apex point dict

        Returns:
            Frame with tracer overlay
        """
        if not trajectory_points:
            return frame

        # Filter points up to current time
        visible_points = [
            p for p in trajectory_points
            if p["timestamp"] <= current_time
        ]

        if len(visible_points) < 2:
            return frame

        # Convert normalized coords to pixel coords
        pixel_points = []
        for p in visible_points:
            px = int(p["x"] * frame_width)
            py = int(p["y"] * frame_height)
            pixel_points.append((px, py))

        # Draw the tracer
        frame = self._draw_tracer_line(frame, pixel_points)

        # Draw apex marker if we've passed it
        if self.style.show_apex_marker and apex_point:
            if apex_point["timestamp"] <= current_time:
                ax = int(apex_point["x"] * frame_width)
                ay = int(apex_point["y"] * frame_height)
                self._draw_apex_marker(frame, (ax, ay))

        # Draw landing marker at last visible point
        if self.style.show_landing_marker and len(visible_points) >= 2:
            # Check if we're at the end of the trajectory
            if visible_points[-1]["timestamp"] >= trajectory_points[-1]["timestamp"] - 0.1:
                lx, ly = pixel_points[-1]
                self._draw_landing_marker(frame, (lx, ly))

        return frame

    def _draw_tracer_line(
        self,
        frame: np.ndarray,
        points: List[Tuple[int, int]],
    ) -> np.ndarray:
        """Draw the tracer line with optional glow effect."""
        if len(points) < 2:
            return frame

        pts = np.array(points, dtype=np.int32)

        if self.style.glow_enabled:
            # Create glow on separate layer
            glow_layer = np.zeros_like(frame)

            # Draw thicker line for glow
            cv2.polylines(
                glow_layer,
                [pts],
                isClosed=False,
                color=self.style.glow_color,
                thickness=self.style.line_width + self.style.glow_radius,
                lineType=cv2.LINE_AA,
            )

            # Apply Gaussian blur for glow effect
            glow_layer = cv2.GaussianBlur(
                glow_layer,
                (self.style.glow_radius * 2 + 1, self.style.glow_radius * 2 + 1),
                0,
            )

            # Blend glow layer with frame
            frame = cv2.addWeighted(
                frame, 1.0,
                glow_layer, self.style.glow_intensity,
                0,
            )

        # Draw main tracer line
        cv2.polylines(
            frame,
            [pts],
            isClosed=False,
            color=self.style.color,
            thickness=self.style.line_width,
            lineType=cv2.LINE_AA,
        )

        return frame

    def _draw_apex_marker(self, frame: np.ndarray, point: Tuple[int, int]) -> None:
        """Draw a marker at the apex point."""
        # Draw filled circle with border
        cv2.circle(frame, point, self.style.apex_marker_radius + 2, (0, 0, 0), -1, cv2.LINE_AA)
        cv2.circle(frame, point, self.style.apex_marker_radius, self.style.color, -1, cv2.LINE_AA)

    def _draw_landing_marker(self, frame: np.ndarray, point: Tuple[int, int]) -> None:
        """Draw a marker at the landing point."""
        # Draw X marker
        r = self.style.landing_marker_radius
        color = self.style.color
        thickness = 2
        cv2.line(frame, (point[0] - r, point[1] - r), (point[0] + r, point[1] + r), color, thickness, cv2.LINE_AA)
        cv2.line(frame, (point[0] - r, point[1] + r), (point[0] + r, point[1] - r), color, thickness, cv2.LINE_AA)


class TracerExporter:
    """Exports video clips with tracer overlay."""

    def __init__(
        self,
        video_path: Path,
        style: Optional[TracerStyle] = None,
    ):
        self.video_path = Path(video_path)
        self.renderer = TracerRenderer(style)
        self.style = style or TracerStyle()

    def export_with_tracer(
        self,
        output_path: Path,
        start_time: float,
        end_time: float,
        trajectory_points: List[dict],
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> Path:
        """Export a clip with tracer overlay rendered frame-by-frame.

        Args:
            output_path: Where to save the output video
            start_time: Clip start time in seconds
            end_time: Clip end time in seconds
            trajectory_points: Normalized trajectory points
            frame_width: Original frame width for coordinate scaling
            frame_height: Original frame height
            apex_point: Optional apex point for marker
            progress_callback: Called with progress 0-100

        Returns:
            Path to output video
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {self.video_path}")

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            # Use temp file for video without audio, then add audio back
            temp_video = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            temp_video_path = temp_video.name
            temp_video.close()

            # Set up video writer
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))

            if not writer.isOpened():
                raise ValueError("Could not create video writer")

            # Seek to start
            start_frame = int(start_time * fps)
            end_frame = int(end_time * fps)
            total_frames = end_frame - start_frame

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            frame_count = 0
            while cap.isOpened() and frame_count < total_frames:
                ret, frame = cap.read()
                if not ret:
                    break

                # Calculate current time relative to video start
                current_time = start_time + (frame_count / fps)

                # Render tracer
                frame = self.renderer.render_tracer_on_frame(
                    frame,
                    trajectory_points,
                    current_time,
                    width,
                    height,
                    apex_point,
                )

                writer.write(frame)
                frame_count += 1

                if progress_callback and frame_count % 30 == 0:
                    progress = (frame_count / total_frames) * 100
                    progress_callback(min(99, progress))

            writer.release()

            # Add audio from original using ffmpeg
            self._add_audio(temp_video_path, output_path, start_time, end_time)

            # Clean up temp file
            Path(temp_video_path).unlink(missing_ok=True)

            if progress_callback:
                progress_callback(100)

            logger.info(f"Exported clip with tracer to {output_path}")
            return output_path

        finally:
            cap.release()

    def _add_audio(
        self,
        video_path: str,
        output_path: Path,
        start_time: float,
        end_time: float,
    ) -> None:
        """Add audio from original video to the tracer video."""
        import subprocess

        duration = end_time - start_time

        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,  # Video with tracer (no audio)
            "-ss", str(start_time),
            "-t", str(duration),
            "-i", str(self.video_path),  # Original video (for audio)
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-c:a", "aac",
            "-map", "0:v:0",
            "-map", "1:a:0?",
            "-shortest",
            str(output_path),
        ]

        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to add audio: {e.stderr.decode() if e.stderr else e}")
            # Fall back to video without audio
            import shutil
            shutil.copy(video_path, output_path)
```

### Verification
```bash
cd src/backend && python -c "
from backend.processing.tracer import TracerRenderer, TracerStyle, hex_to_bgr
import numpy as np

# Test color conversion
assert hex_to_bgr('#FF0000') == (0, 0, 255), 'Red should be BGR (0,0,255)'
assert hex_to_bgr('#00FF00') == (0, 255, 0), 'Green should be BGR (0,255,0)'

# Test renderer
style = TracerStyle(color=(255, 255, 255), glow_enabled=True)
renderer = TracerRenderer(style)

# Create test frame
frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
points = [
    {'timestamp': 0.0, 'x': 0.1, 'y': 0.5},
    {'timestamp': 0.5, 'x': 0.3, 'y': 0.3},
    {'timestamp': 1.0, 'x': 0.5, 'y': 0.2},
    {'timestamp': 1.5, 'x': 0.7, 'y': 0.4},
]

result = renderer.render_tracer_on_frame(frame, points, 1.0, 1920, 1080)
assert result.shape == (1080, 1920, 3)
print('TracerRenderer working!')
"
```

---

## Task 6: Trajectory API Endpoints

**Owner:** Agent 6
**Files to MODIFY:** `src/backend/api/routes.py`
**Dependencies:** Task 2 (trajectory model) and Task 3 (schemas)

### Instructions

Add API endpoints to retrieve and update trajectory data. Add these endpoints in a new section, don't modify existing endpoints.

### Changes Required

1. Add imports at top:
```python
from backend.models.trajectory import (
    get_trajectory,
    get_trajectories_for_job,
    update_trajectory as update_trajectory_db,
)
from backend.api.schemas import TrajectoryData, TrajectoryPoint, TrajectoryUpdateRequest
```

2. Add new endpoints (add these after existing endpoints, before the end of the file):

```python
# === TRAJECTORY ENDPOINTS (Phase 2) ===

@router.get("/trajectory/{job_id}/{shot_id}")
async def get_shot_trajectory(job_id: str, shot_id: int):
    """Get trajectory data for a specific shot.

    Returns trajectory points in normalized coordinates (0-1).
    """
    trajectory = await get_trajectory(job_id, shot_id)

    if not trajectory:
        raise HTTPException(
            status_code=404,
            detail=f"No trajectory found for job {job_id} shot {shot_id}",
        )

    # Convert to response format
    points = [
        TrajectoryPoint(
            timestamp=p["timestamp"],
            x=p["x"],
            y=p["y"],
            confidence=p.get("confidence", 0),
            interpolated=p.get("interpolated", False),
        )
        for p in trajectory["points"]
    ]

    apex = None
    if trajectory["apex_point"]:
        ap = trajectory["apex_point"]
        apex = TrajectoryPoint(
            timestamp=ap.get("timestamp", 0),
            x=ap["x"],
            y=ap["y"],
            confidence=1.0,
            interpolated=False,
        )

    return TrajectoryData(
        shot_id=trajectory["shot_id"],
        points=points,
        confidence=trajectory["confidence"],
        smoothness_score=trajectory["smoothness_score"],
        physics_plausibility=trajectory["physics_plausibility"],
        apex_point=apex,
        launch_angle=trajectory["launch_angle"],
        flight_duration=trajectory["flight_duration"],
        has_gaps=trajectory["has_gaps"],
        gap_count=trajectory["gap_count"],
        is_manual_override=trajectory["is_manual_override"],
        frame_width=trajectory["frame_width"],
        frame_height=trajectory["frame_height"],
    )


@router.get("/trajectories/{job_id}")
async def get_job_trajectories(job_id: str):
    """Get all trajectories for a job."""
    trajectories = await get_trajectories_for_job(job_id)

    if not trajectories:
        return {"job_id": job_id, "trajectories": []}

    result = []
    for t in trajectories:
        points = [
            TrajectoryPoint(
                timestamp=p["timestamp"],
                x=p["x"],
                y=p["y"],
                confidence=p.get("confidence", 0),
                interpolated=p.get("interpolated", False),
            )
            for p in t["points"]
        ]

        apex = None
        if t["apex_point"]:
            ap = t["apex_point"]
            apex = TrajectoryPoint(
                timestamp=ap.get("timestamp", 0),
                x=ap["x"],
                y=ap["y"],
                confidence=1.0,
                interpolated=False,
            )

        result.append(TrajectoryData(
            shot_id=t["shot_id"],
            points=points,
            confidence=t["confidence"],
            smoothness_score=t["smoothness_score"],
            physics_plausibility=t["physics_plausibility"],
            apex_point=apex,
            launch_angle=t["launch_angle"],
            flight_duration=t["flight_duration"],
            has_gaps=t["has_gaps"],
            gap_count=t["gap_count"],
            is_manual_override=t["is_manual_override"],
            frame_width=t["frame_width"],
            frame_height=t["frame_height"],
        ))

    return {"job_id": job_id, "trajectories": result}


@router.put("/trajectory/{job_id}/{shot_id}")
async def update_shot_trajectory(
    job_id: str,
    shot_id: int,
    request: TrajectoryUpdateRequest,
):
    """Update trajectory with manual edits.

    Points should be in normalized coordinates (0-1).
    """
    points_dicts = [
        {
            "timestamp": p.timestamp,
            "x": p.x,
            "y": p.y,
            "confidence": p.confidence,
            "interpolated": p.interpolated,
        }
        for p in request.points
    ]

    success = await update_trajectory_db(
        job_id=job_id,
        shot_id=shot_id,
        trajectory_points=points_dicts,
        is_manual_override=True,
    )

    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"No trajectory found for job {job_id} shot {shot_id}",
        )

    return {"status": "updated", "job_id": job_id, "shot_id": shot_id}
```

### Verification
```bash
# Start server and test endpoints
cd src && uvicorn backend.main:app --port 8420 &
sleep 3
curl http://localhost:8420/api/trajectories/test-job
# Should return {"job_id": "test-job", "trajectories": []}
```

---

## Task 7: Export Integration

**Owner:** Agent 7
**Files to MODIFY:** `src/backend/processing/clips.py`, `src/backend/api/routes.py` (export section only)
**Dependencies:** Task 5 (tracer module)

### Instructions

Integrate tracer rendering into the clip export flow. Modify the export to optionally render tracers.

### Changes to `src/backend/processing/clips.py`

1. Add import at top:
```python
from backend.processing.tracer import TracerExporter, TracerStyle
```

2. Add method to `ClipExporter` class:

```python
    def export_clip_with_tracer(
        self,
        start_time: float,
        end_time: float,
        output_path: Path,
        trajectory_points: list[dict],
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
        tracer_style: Optional[dict] = None,
        progress_callback: Optional[ProgressCallback] = None,
    ) -> "ExportResult":
        """Export a clip with shot tracer overlay.

        Args:
            start_time: Clip start in seconds
            end_time: Clip end in seconds
            output_path: Where to save output
            trajectory_points: Normalized trajectory points
            frame_width: Source video width
            frame_height: Source video height
            apex_point: Optional apex point for marker
            tracer_style: Optional style configuration dict
            progress_callback: Progress callback

        Returns:
            ExportResult with status
        """
        from backend.processing.tracer import TracerExporter, TracerStyle

        output_path = Path(output_path)

        try:
            # Create style from dict if provided
            style = None
            if tracer_style:
                style = TracerStyle.from_dict(tracer_style)

            # Create exporter and render
            exporter = TracerExporter(self.video_path, style)

            def tracer_progress(p: float):
                if progress_callback:
                    progress_callback("Rendering tracer", p)

            exporter.export_with_tracer(
                output_path=output_path,
                start_time=start_time,
                end_time=end_time,
                trajectory_points=trajectory_points,
                frame_width=frame_width,
                frame_height=frame_height,
                apex_point=apex_point,
                progress_callback=tracer_progress,
            )

            return ExportResult(
                success=True,
                output_path=output_path,
                duration=end_time - start_time,
            )

        except Exception as e:
            logger.exception(f"Failed to export clip with tracer: {e}")
            return ExportResult(
                success=False,
                output_path=output_path,
                error=str(e),
            )
```

### Changes to `src/backend/api/routes.py` (export section)

Find the `run_export_job` function and modify the clip export loop to check for tracer rendering:

Add import:
```python
from backend.models.trajectory import get_trajectory
```

In `run_export_job`, find where clips are exported (look for the loop that calls `exporter.export_clip` or similar). Modify it to check `render_tracer`:

```python
# Inside the export loop, replace the export call with:
if request.render_tracer:
    # Get trajectory for this shot
    trajectory = await get_trajectory(request.job_id, clip.shot_id)

    if trajectory and trajectory.get("points"):
        tracer_style_dict = None
        if request.tracer_style:
            tracer_style_dict = request.tracer_style.model_dump()

        result = exporter.export_clip_with_tracer(
            start_time=clip.start_time,
            end_time=clip.end_time,
            output_path=output_path,
            trajectory_points=trajectory["points"],
            frame_width=trajectory["frame_width"],
            frame_height=trajectory["frame_height"],
            apex_point=trajectory.get("apex_point"),
            tracer_style=tracer_style_dict,
            progress_callback=clip_progress,
        )
    else:
        # No trajectory, fall back to normal export
        logger.warning(f"No trajectory for shot {clip.shot_id}, exporting without tracer")
        result = exporter.export_clip(...)  # existing call
else:
    result = exporter.export_clip(...)  # existing call
```

### Verification
Test by exporting a clip with `render_tracer: true` in the request.

---

## Task 8: Frontend Implementation

**Owner:** Agent 8
**Files to CREATE:** `src/frontend/src/components/TrajectoryEditor.tsx`
**Files to MODIFY:** `src/frontend/src/stores/appStore.ts`, `src/frontend/src/components/ClipReview.tsx`, `src/frontend/src/styles/global.css`
**Dependencies:** Task 6 (trajectory API)

### Instructions

Implement the frontend trajectory visualization and editing UI.

### File to Create: `src/frontend/src/components/TrajectoryEditor.tsx`

```tsx
import { useRef, useEffect, useState, useCallback } from 'react'

interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

interface TrajectoryEditorProps {
  videoRef: React.RefObject<HTMLVideoElement>
  trajectory: {
    points: TrajectoryPoint[]
    apex_point?: TrajectoryPoint
    frame_width: number
    frame_height: number
  } | null
  currentTime: number
  onTrajectoryUpdate?: (points: TrajectoryPoint[]) => void
  disabled?: boolean
  showTracer?: boolean
}

export function TrajectoryEditor({
  videoRef,
  trajectory,
  currentTime,
  onTrajectoryUpdate,
  disabled = false,
  showTracer = true,
}: TrajectoryEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null)
  const [localPoints, setLocalPoints] = useState<TrajectoryPoint[]>([])

  // Sync local points with trajectory prop
  useEffect(() => {
    if (trajectory?.points) {
      setLocalPoints([...trajectory.points])
    }
  }, [trajectory?.points])

  // Resize canvas to match video
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateSize = () => {
      const rect = video.getBoundingClientRect()
      setCanvasSize({ width: rect.width, height: rect.height })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(video)

    return () => observer.disconnect()
  }, [videoRef])

  // Draw trajectory
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !showTracer) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!localPoints.length) return

    // Filter points up to current time
    const visiblePoints = localPoints.filter(p => p.timestamp <= currentTime)
    if (visiblePoints.length < 2) return

    // Convert normalized coords to canvas coords
    const toCanvas = (x: number, y: number) => ({
      x: x * canvas.width,
      y: y * canvas.height,
    })

    // Draw glow layer
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 12
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.filter = 'blur(8px)'

    ctx.beginPath()
    const first = toCanvas(visiblePoints[0].x, visiblePoints[0].y)
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < visiblePoints.length; i++) {
      const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
      ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()
    ctx.restore()

    // Draw main line
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < visiblePoints.length; i++) {
      const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
      ctx.lineTo(pt.x, pt.y)
    }
    ctx.stroke()

    // Draw apex marker if visible
    if (trajectory?.apex_point && trajectory.apex_point.timestamp <= currentTime) {
      const apex = toCanvas(trajectory.apex_point.x, trajectory.apex_point.y)
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.arc(apex.x, apex.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Draw control points if not disabled (for editing)
    if (!disabled) {
      for (let i = 0; i < visiblePoints.length; i++) {
        const pt = toCanvas(visiblePoints[i].x, visiblePoints[i].y)
        ctx.fillStyle = visiblePoints[i].interpolated ? '#888888' : '#00FF00'
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }, [localPoints, currentTime, canvasSize, showTracer, disabled, trajectory?.apex_point])

  // Mouse handlers for point dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Find closest point
    const visiblePoints = localPoints.filter(p => p.timestamp <= currentTime)
    let closestIdx = -1
    let closestDist = Infinity

    for (let i = 0; i < visiblePoints.length; i++) {
      const pt = visiblePoints[i]
      const dist = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2)
      if (dist < 0.03 && dist < closestDist) { // 3% threshold
        closestDist = dist
        closestIdx = localPoints.indexOf(pt)
      }
    }

    if (closestIdx >= 0) {
      setDraggingPoint(closestIdx)
    }
  }, [disabled, localPoints, currentTime])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingPoint === null || !canvasRef.current) return

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))

    setLocalPoints(prev => {
      const updated = [...prev]
      updated[draggingPoint] = {
        ...updated[draggingPoint],
        x,
        y,
        interpolated: false, // Manual edit
      }
      return updated
    })
  }, [draggingPoint])

  const handleMouseUp = useCallback(() => {
    if (draggingPoint !== null) {
      setDraggingPoint(null)
      onTrajectoryUpdate?.(localPoints)
    }
  }, [draggingPoint, localPoints, onTrajectoryUpdate])

  if (!showTracer) return null

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      className="trajectory-canvas"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: draggingPoint !== null ? 'grabbing' : 'crosshair',
      }}
    />
  )
}
```

### Changes to `src/frontend/src/stores/appStore.ts`

Add trajectory types and state:

```typescript
// Add these types
interface TrajectoryPoint {
  timestamp: number
  x: number
  y: number
  confidence: number
  interpolated: boolean
}

interface Trajectory {
  shot_id: number
  points: TrajectoryPoint[]
  confidence: number
  apex_point?: TrajectoryPoint
  is_manual_override: boolean
  frame_width: number
  frame_height: number
}

// Add to AppState interface:
trajectories: Record<number, Trajectory>
setTrajectory: (shotId: number, trajectory: Trajectory) => void
clearTrajectories: () => void

// Add to create() implementation:
trajectories: {},
setTrajectory: (shotId, trajectory) => set((state) => ({
  trajectories: { ...state.trajectories, [shotId]: trajectory }
})),
clearTrajectories: () => set({ trajectories: {} }),
```

### Changes to `src/frontend/src/components/ClipReview.tsx`

1. Add imports:
```tsx
import { TrajectoryEditor } from './TrajectoryEditor'
```

2. Add state for trajectory:
```tsx
const [showTracer, setShowTracer] = useState(true)
const [trajectory, setTrajectory] = useState<any>(null)
const [exportWithTracer, setExportWithTracer] = useState(true)
```

3. Fetch trajectory when shot changes (add useEffect):
```tsx
useEffect(() => {
  if (currentShot) {
    fetch(`http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setTrajectory(data))
      .catch(() => setTrajectory(null))
  }
}, [currentShot?.id, jobId])
```

4. Add TrajectoryEditor inside video container:
```tsx
<div className="video-container">
  <video ref={videoRef} ... />
  <TrajectoryEditor
    videoRef={videoRef}
    trajectory={trajectory}
    currentTime={currentTime}
    showTracer={showTracer}
    disabled={false}
    onTrajectoryUpdate={(points) => {
      // Save updated trajectory
      fetch(`http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot?.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
      })
    }}
  />
</div>
```

5. Add tracer controls in UI:
```tsx
<div className="tracer-controls">
  <label>
    <input
      type="checkbox"
      checked={showTracer}
      onChange={(e) => setShowTracer(e.target.checked)}
    />
    Show Tracer
  </label>
</div>
```

6. Add tracer option to export:
```tsx
// In export section
<label>
  <input
    type="checkbox"
    checked={exportWithTracer}
    onChange={(e) => setExportWithTracer(e.target.checked)}
  />
  Render Shot Tracers
</label>
```

7. Include in export request:
```tsx
// When calling export API
body: JSON.stringify({
  ...existingParams,
  render_tracer: exportWithTracer,
  tracer_style: exportWithTracer ? { color: '#FFFFFF', glow_enabled: true } : undefined,
})
```

### Changes to `src/frontend/src/styles/global.css`

Add at the end:
```css
/* Trajectory Editor */
.trajectory-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.tracer-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin: var(--spacing-sm) 0;
  padding: var(--spacing-sm);
  background-color: var(--color-bg-secondary);
  border-radius: var(--border-radius-sm);
}

.tracer-controls label {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  cursor: pointer;
}
```

### Verification
1. Run frontend: `cd src/frontend && npm run dev`
2. Load a processed job with trajectories
3. Verify trajectory line draws on video during playback
4. Verify "Show Tracer" toggle works
5. Verify points are draggable

---

## Agent Coordination Message

Send this message to each agent, changing only the task number (1-8):

```
Read /Users/ecoon/golf-clip/phase_2_plan.md and implement Task N. Follow the instructions exactly. Do not modify files assigned to other tasks. When done, verify your changes using the verification steps provided.
```

Where N is replaced with:
- `1` for Database Migration
- `2` for Trajectory CRUD Model
- `3` for API Schemas
- `4` for Pipeline Trajectory Capture
- `5` for Tracer Rendering Module
- `6` for Trajectory API Endpoints
- `7` for Export Integration
- `8` for Frontend Implementation

---

## Integration Order

After all agents complete, integrate in this order:
1. Tasks 1-3 can merge immediately (no conflicts)
2. Task 4 depends on Task 2's file existing
3. Tasks 5-6 can merge after 1-3
4. Task 7 depends on Tasks 5-6
5. Task 8 depends on Task 6

Run full test after all merges:
```bash
cd src/backend && pytest tests/ -v
cd src/frontend && npm run build
```
