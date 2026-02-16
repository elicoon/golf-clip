# Landing Point Marking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add user-confirmed landing points to improve shot tracer accuracy, replacing accept/reject with click-to-mark + SSE progress.

**Architecture:** Enhance ClipReview with click-to-mark landing interaction. New SSE endpoint generates trajectory with progress/warning events. Physics-based trajectory constrained to hit user-marked landing point while respecting early ball detections for mid-flight shape.

**Tech Stack:** FastAPI (SSE), React (EventSource), SQLite (schema v4), OpenCV (trajectory generation)

---

## Task Overview

| Task | Component | Can Parallelize With |
|------|-----------|---------------------|
| 1 | Database: Add landing columns | 2, 3 |
| 2 | Backend: update_shot_landing function | 1, 3 |
| 3 | Backend: SSE endpoint skeleton | 1, 2 |
| 4 | Backend: track_with_landing_point method | After 1-3 |
| 5 | Backend: Wire SSE to trajectory generation | After 4 |
| 6 | Frontend: Landing point state & click handler | After 3 |
| 7 | Frontend: SSE connection & progress bar | After 6 |
| 8 | Frontend: Landing marker in TrajectoryEditor | After 6 |
| 9 | Frontend: Update buttons & flow | After 7, 8 |
| 10 | Integration testing | After all |

---

## Task 1: Database Migration for Landing Columns

**Files:**
- Modify: `src/backend/core/database.py:14` (SCHEMA_VERSION)
- Modify: `src/backend/core/database.py:73` (_apply_migrations)
- Create new migration function

**Step 1: Write the failing test**

Create: `src/backend/tests/test_landing_migration.py`

```python
"""Test database migration for landing point columns."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def temp_db_path():
    """Create a temporary database path."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield Path(path)
    if os.path.exists(path):
        os.unlink(path)


def test_schema_v4_adds_landing_columns(temp_db_path):
    """Test that schema v4 migration adds landing_x and landing_y to shots."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        # Must reimport after patching
        import importlib
        import backend.core.database as db_module
        importlib.reload(db_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            # Initialize database (applies all migrations)
            loop.run_until_complete(db_module.init_db())

            # Check that landing columns exist
            async def check_columns():
                db = await db_module.get_db()
                async with db.execute("PRAGMA table_info(shots)") as cursor:
                    columns = await cursor.fetchall()
                    column_names = [col["name"] for col in columns]
                    assert "landing_x" in column_names, "landing_x column missing"
                    assert "landing_y" in column_names, "landing_y column missing"

            loop.run_until_complete(check_columns())
            loop.run_until_complete(db_module.close_db())
        finally:
            loop.close()
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/ecoon/golf-clip/.worktrees/landing-point/src/backend
pytest tests/test_landing_migration.py -v
```

Expected: FAIL with "landing_x column missing"

**Step 3: Update SCHEMA_VERSION**

In `src/backend/core/database.py`, change line 16:

```python
# Current schema version - increment when making schema changes
SCHEMA_VERSION = 4
```

**Step 4: Add migration call**

In `src/backend/core/database.py`, update `_apply_migrations` around line 73:

```python
async def _apply_migrations(current_version: int) -> None:
    """Apply database migrations incrementally."""
    if current_version < 1:
        await _migrate_v1()
    if current_version < 2:
        await _migrate_v2()
    if current_version < 3:
        await _migrate_v3()
    if current_version < 4:
        await _migrate_v4()
```

**Step 5: Add migration function**

Add after `_migrate_v3` function (around line 205):

```python
async def _migrate_v4() -> None:
    """Add landing point columns to shots table for user-marked ball landing."""
    logger.info("Applying migration v4: Landing point columns")

    await _db_connection.executescript(
        """
        ALTER TABLE shots ADD COLUMN landing_x REAL;
        ALTER TABLE shots ADD COLUMN landing_y REAL;
        """
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (4, datetime.utcnow().isoformat(), "Landing point columns for user-marked ball landing"),
    )

    logger.info("Migration v4 applied successfully")
```

**Step 6: Run test to verify it passes**

```bash
cd /Users/ecoon/golf-clip/.worktrees/landing-point/src/backend
pytest tests/test_landing_migration.py -v
```

Expected: PASS

**Step 7: Run full test suite**

```bash
pytest tests/ -v -x --tb=short
```

Expected: All tests pass (114+)

**Step 8: Commit**

```bash
git add src/backend/core/database.py src/backend/tests/test_landing_migration.py
git commit -m "feat: add landing_x/landing_y columns to shots table (schema v4)"
```

---

## Task 2: Backend update_shot_landing Function

**Files:**
- Modify: `src/backend/models/job.py` (add function)
- Modify: `src/backend/models/job.py:319` (_VALID_SHOT_COLUMNS)

**Step 1: Write the failing test**

Create: `src/backend/tests/test_landing_update.py`

```python
"""Test update_shot_landing function."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def temp_db_path():
    """Create a temporary database path."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield Path(path)
    if os.path.exists(path):
        os.unlink(path)


def test_update_shot_landing(temp_db_path):
    """Test that update_shot_landing saves landing coordinates."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        import importlib
        import backend.core.database as db_module
        import backend.models.job as job_module
        importlib.reload(db_module)
        importlib.reload(job_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(db_module.init_db())

            async def test_landing():
                # Create a job and shot
                job = await job_module.create_job(
                    job_id="test-job-123",
                    video_path="/tmp/test.mp4",
                    output_dir="/tmp/output",
                    auto_approve=True,
                    video_info=None,
                )

                await job_module.create_shots("test-job-123", [
                    {
                        "id": 1,
                        "strike_time": 10.5,
                        "clip_start": 8.5,
                        "clip_end": 14.5,
                        "confidence": 0.8,
                        "audio_confidence": 0.7,
                        "visual_confidence": 0.6,
                    }
                ])

                # Update landing point
                result = await job_module.update_shot_landing(
                    job_id="test-job-123",
                    shot_id=1,
                    landing_x=0.65,
                    landing_y=0.82,
                )
                assert result is True

                # Verify landing point was saved
                shots = await job_module.get_shots_for_job("test-job-123")
                assert len(shots) == 1
                assert shots[0]["landing_x"] == 0.65
                assert shots[0]["landing_y"] == 0.82

            loop.run_until_complete(test_landing())
            loop.run_until_complete(db_module.close_db())
        finally:
            loop.close()


def test_update_shot_landing_not_found(temp_db_path):
    """Test that update_shot_landing returns False for non-existent shot."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        import importlib
        import backend.core.database as db_module
        import backend.models.job as job_module
        importlib.reload(db_module)
        importlib.reload(job_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(db_module.init_db())

            async def test_not_found():
                result = await job_module.update_shot_landing(
                    job_id="nonexistent",
                    shot_id=999,
                    landing_x=0.5,
                    landing_y=0.5,
                )
                assert result is False

            loop.run_until_complete(test_not_found())
            loop.run_until_complete(db_module.close_db())
        finally:
            loop.close()
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_landing_update.py -v
```

Expected: FAIL with "module 'backend.models.job' has no attribute 'update_shot_landing'"

**Step 3: Update _VALID_SHOT_COLUMNS**

In `src/backend/models/job.py`, update around line 319:

```python
_VALID_SHOT_COLUMNS = {
    "shot_number", "strike_time", "landing_time", "clip_start", "clip_end",
    "confidence", "shot_type", "audio_confidence", "visual_confidence",
    "confidence_reasons_json", "landing_x", "landing_y",
}
```

**Step 4: Update shot_row_to_dict**

In `src/backend/models/job.py`, update the `shot_row_to_dict` function around line 34:

```python
def shot_row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a database row to a shot dictionary matching the API schema."""
    return {
        "id": row["shot_number"],  # Use shot_number as the API-facing ID
        "strike_time": row["strike_time"],
        "landing_time": row["landing_time"],
        "clip_start": row["clip_start"],
        "clip_end": row["clip_end"],
        "confidence": row["confidence"],
        "shot_type": row["shot_type"],
        "audio_confidence": row["audio_confidence"],
        "visual_confidence": row["visual_confidence"],
        "confidence_reasons": deserialize_json(row["confidence_reasons_json"]) or [],
        "landing_x": row["landing_x"],
        "landing_y": row["landing_y"],
    }
```

**Step 5: Add update_shot_landing function**

Add after `update_shot` function (around line 372):

```python
async def update_shot_landing(
    job_id: str,
    shot_id: int,
    landing_x: float,
    landing_y: float,
) -> bool:
    """Update the landing point for a shot.

    Args:
        job_id: The job ID the shot belongs to.
        shot_id: The shot number to update.
        landing_x: Normalized X coordinate (0-1) where ball lands.
        landing_y: Normalized Y coordinate (0-1) where ball lands.

    Returns:
        True if the shot was updated, False if not found.
    """
    db = await get_db()

    cursor = await db.execute(
        "UPDATE shots SET landing_x = ?, landing_y = ? WHERE job_id = ? AND shot_number = ?",
        (landing_x, landing_y, job_id, shot_id),
    )
    await db.commit()

    if cursor.rowcount > 0:
        logger.debug(f"Updated landing point for job {job_id}, shot {shot_id}: ({landing_x}, {landing_y})")
        return True
    return False
```

**Step 6: Run test to verify it passes**

```bash
pytest tests/test_landing_update.py -v
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/backend/models/job.py src/backend/tests/test_landing_update.py
git commit -m "feat: add update_shot_landing function for saving landing coordinates"
```

---

## Task 3: Backend SSE Endpoint Skeleton

**Files:**
- Modify: `src/backend/api/routes.py` (add endpoint)
- Modify: `src/backend/api/schemas.py` (add response schemas)

**Step 1: Write the failing test**

Create: `src/backend/tests/test_trajectory_generate_sse.py`

```python
"""Test SSE endpoint for trajectory generation."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db_path():
    """Create a temporary database path."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield Path(path)
    if os.path.exists(path):
        os.unlink(path)


def test_generate_trajectory_sse_endpoint_exists(temp_db_path):
    """Test that the SSE endpoint exists and accepts parameters."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        import importlib
        import backend.core.database as db_module
        importlib.reload(db_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(db_module.init_db())

        from backend.main import app
        client = TestClient(app)

        # Should return 404 for non-existent job, not 422 (validation error)
        # This confirms the endpoint exists and parameters are valid
        response = client.get(
            "/api/trajectory/nonexistent-job/1/generate",
            params={"landing_x": 0.5, "landing_y": 0.5}
        )

        # 404 means endpoint exists but job not found
        # 422 would mean parameters invalid
        # 405 would mean endpoint doesn't exist
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}"

        loop.run_until_complete(db_module.close_db())
        loop.close()


def test_generate_trajectory_sse_validates_coordinates(temp_db_path):
    """Test that coordinates must be between 0 and 1."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        import importlib
        import backend.core.database as db_module
        importlib.reload(db_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(db_module.init_db())

        from backend.main import app
        client = TestClient(app)

        # Invalid coordinates should return 422
        response = client.get(
            "/api/trajectory/test-job/1/generate",
            params={"landing_x": 1.5, "landing_y": 0.5}  # x > 1 is invalid
        )
        assert response.status_code == 422

        loop.run_until_complete(db_module.close_db())
        loop.close()
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_trajectory_generate_sse.py -v
```

Expected: FAIL with 404 or route not found

**Step 3: Add SSE helper function to routes.py**

In `src/backend/api/routes.py`, add after the imports (around line 60):

```python
import json

def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
```

**Step 4: Add the SSE endpoint**

In `src/backend/api/routes.py`, add after the trajectory endpoints (search for `update_trajectory_db`):

```python
@router.get("/trajectory/{job_id}/{shot_id}/generate")
async def generate_trajectory_sse(
    job_id: str,
    shot_id: int,
    landing_x: float = Query(..., ge=0, le=1, description="Landing X coordinate (0-1)"),
    landing_y: float = Query(..., ge=0, le=1, description="Landing Y coordinate (0-1)"),
):
    """Generate trajectory with SSE progress updates.

    Returns Server-Sent Events with:
    - event: progress - Progress updates during generation
    - event: warning - Non-fatal detection issues
    - event: complete - Final trajectory data
    - event: error - Fatal errors
    """
    from fastapi import Query
    from backend.models.job import get_job, update_shot_landing

    # Verify job exists
    job = await get_job(job_id, include_shots=False)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # Step 1: Save landing point
            yield sse_event("progress", {
                "step": "saving",
                "progress": 5,
                "message": "Saving landing point..."
            })

            await update_shot_landing(job_id, shot_id, landing_x, landing_y)

            # Step 2: Placeholder for trajectory generation
            # Will be implemented in Task 5
            yield sse_event("progress", {
                "step": "generating",
                "progress": 50,
                "message": "Generating trajectory..."
            })

            # For now, return a placeholder complete event
            yield sse_event("complete", {
                "trajectory": None,
                "progress": 100,
                "message": "Trajectory generation not yet implemented"
            })

        except Exception as e:
            logger.error(f"Trajectory generation failed: {e}")
            yield sse_event("error", {
                "error": str(e),
                "progress": 0
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
```

**Step 5: Add Query import if missing**

Make sure `Query` is imported at the top of routes.py:

```python
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Request, Query
```

**Step 6: Run test to verify it passes**

```bash
pytest tests/test_trajectory_generate_sse.py -v
```

Expected: PASS

**Step 7: Commit**

```bash
git add src/backend/api/routes.py src/backend/tests/test_trajectory_generate_sse.py
git commit -m "feat: add SSE endpoint skeleton for trajectory generation"
```

---

## Task 4: Backend track_with_landing_point Method

**Files:**
- Modify: `src/backend/detection/tracker.py` (add method)

**Step 1: Write the failing test**

Create: `src/backend/tests/test_track_with_landing.py`

```python
"""Test track_with_landing_point trajectory generation."""

import pytest
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.detection.tracker import ConstrainedBallTracker
from backend.detection.origin import OriginDetection


class TestTrackWithLandingPoint:
    """Tests for track_with_landing_point method."""

    def test_generates_trajectory_ending_at_landing(self):
        """Trajectory should end at the user-marked landing point."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(
            x=500,
            y=800,
            confidence=0.9,
            method="test",
        )

        # Mock video path (won't actually read)
        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),  # Normalized coords
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        assert "points" in result
        assert len(result["points"]) > 0

        # Last point should be at landing position
        last_point = result["points"][-1]
        assert abs(last_point["x"] - 0.7) < 0.01
        assert abs(last_point["y"] - 0.85) < 0.01

    def test_trajectory_starts_at_origin(self):
        """Trajectory should start at the detected origin."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(
            x=960,  # Center of 1920
            y=900,  # Near bottom of 1080
            confidence=0.9,
            method="test",
        )

        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.6, 0.9),
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        first_point = result["points"][0]

        # First point should be at origin (normalized)
        expected_x = 960 / 1920  # 0.5
        expected_y = 900 / 1080  # ~0.833
        assert abs(first_point["x"] - expected_x) < 0.01
        assert abs(first_point["y"] - expected_y) < 0.01

    def test_trajectory_has_apex_above_endpoints(self):
        """Trajectory apex should be above both origin and landing."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(x=500, y=900, confidence=0.9, method="test")

        with patch.object(tracker, 'track_flight', return_value=[]):
            result = tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
            )

        assert result is not None
        assert "apex_point" in result

        # Apex y should be less than both endpoints (higher on screen)
        apex_y = result["apex_point"]["y"]
        origin_y = result["points"][0]["y"]
        landing_y = result["points"][-1]["y"]

        assert apex_y < origin_y, "Apex should be above origin"
        assert apex_y < landing_y, "Apex should be above landing"

    def test_progress_callback_is_called(self):
        """Progress callback should be called during generation."""
        tracker = ConstrainedBallTracker()

        origin = OriginDetection(x=500, y=900, confidence=0.9, method="test")

        progress_calls = []
        def progress_cb(percent, message):
            progress_calls.append((percent, message))

        with patch.object(tracker, 'track_flight', return_value=[]):
            tracker.track_with_landing_point(
                video_path=Path("/fake/video.mp4"),
                origin=origin,
                strike_time=10.0,
                landing_point=(0.7, 0.85),
                frame_width=1920,
                frame_height=1080,
                progress_callback=progress_cb,
            )

        assert len(progress_calls) > 0
        # Should have progress updates
        assert any(p[0] > 0 for p in progress_calls)
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_track_with_landing.py -v
```

Expected: FAIL with AttributeError (method doesn't exist)

**Step 3: Add track_with_landing_point method**

In `src/backend/detection/tracker.py`, add after `track_precise_trajectory` method (around line 1050):

```python
    def track_with_landing_point(
        self,
        video_path: Path,
        origin: OriginDetection,
        strike_time: float,
        landing_point: Tuple[float, float],
        frame_width: int,
        frame_height: int,
        progress_callback: Optional[Callable[[int, str], None]] = None,
        warning_callback: Optional[Callable[[str, str], None]] = None,
    ) -> Optional[dict]:
        """Generate trajectory constrained to hit user-marked landing point.

        Uses hybrid approach:
        1. Detect early ball positions (first 200ms) for launch angle
        2. Constrain parabola to pass through origin and landing point
        3. Use early detections to determine apex timing

        Args:
            video_path: Path to video file
            origin: Detected ball origin (from origin.py)
            strike_time: When ball was struck (seconds)
            landing_point: User-marked landing (x, y) in normalized coords (0-1)
            frame_width: Video width in pixels
            frame_height: Video height in pixels
            progress_callback: Called with (percent, message) during generation
            warning_callback: Called with (warning_code, message) for non-fatal issues

        Returns:
            Trajectory dict with points constrained to hit landing point
        """
        def emit_progress(percent: int, message: str):
            if progress_callback:
                progress_callback(percent, message)

        def emit_warning(code: str, message: str):
            if warning_callback:
                warning_callback(code, message)

        emit_progress(10, "Detecting early ball positions...")

        # Try to detect early ball movement for launch angle
        early_detections = []
        try:
            early_detections = self.track_flight(
                video_path,
                origin,
                strike_time,
                end_time=strike_time + 0.2,
                max_flight_duration=0.2,
            )
        except Exception as e:
            emit_warning("early_ball_detection_failed", f"No ball detected in first 200ms: {e}")
            logger.warning(f"Early ball detection failed: {e}")

        emit_progress(30, "Extracting launch parameters...")

        # Extract launch params from early detections
        if len(early_detections) >= 3:
            launch_params = self._extract_launch_params(
                early_detections, origin, frame_width, frame_height
            )
        else:
            emit_warning(
                "early_ball_detection_failed",
                "No ball detected in first 200ms, using default launch angle"
            )
            launch_params = {
                "launch_angle": 18.0,
                "lateral_angle": 0.0,
                "apex_height": 0.45,
                "apex_time": 1.2,
                "flight_duration": 3.0,
                "shot_shape": "straight",
            }

        emit_progress(50, "Generating physics trajectory...")

        # Normalize origin
        origin_x = origin.x / frame_width
        origin_y = origin.y / frame_height
        landing_x, landing_y = landing_point

        # Calculate trajectory that hits both origin and landing
        trajectory = self._generate_constrained_trajectory(
            origin_point=(origin_x, origin_y),
            landing_point=(landing_x, landing_y),
            strike_time=strike_time,
            launch_params=launch_params,
        )

        emit_progress(80, "Smoothing trajectory...")

        if trajectory:
            emit_progress(100, "Trajectory complete")

        return trajectory

    def _generate_constrained_trajectory(
        self,
        origin_point: Tuple[float, float],
        landing_point: Tuple[float, float],
        strike_time: float,
        launch_params: dict,
    ) -> Optional[dict]:
        """Generate parabolic trajectory constrained to hit both endpoints.

        Args:
            origin_point: Start point (x, y) normalized 0-1
            landing_point: End point (x, y) normalized 0-1
            strike_time: When ball was struck
            launch_params: Launch parameters from early detection

        Returns:
            Trajectory dict with points
        """
        origin_x, origin_y = origin_point
        landing_x, landing_y = landing_point

        # Flight duration from launch params, adjusted by distance
        dx = landing_x - origin_x
        dy = landing_y - origin_y
        distance = np.sqrt(dx**2 + dy**2)

        # Estimate flight duration based on horizontal distance
        # Longer horizontal distance = longer flight
        base_duration = launch_params.get("flight_duration", 3.0)
        flight_duration = max(2.0, min(5.0, base_duration * (distance / 0.3)))

        # Apex time ratio from launch params (earlier apex = higher launch)
        # Higher launch angle = apex happens earlier in flight
        apex_ratio = 0.4 + (launch_params.get("launch_angle", 18.0) / 90.0) * 0.2
        apex_time = flight_duration * apex_ratio

        # Calculate apex height needed for parabola through both points
        # For a parabola: y = y0 + v0*t - 0.5*g*t^2
        # At landing: landing_y = origin_y + v0*T - 0.5*g*T^2
        # At apex (t=apex_time): v0 = g*apex_time, apex_y = origin_y + 0.5*g*apex_time^2

        # Solve for apex height that makes parabola pass through landing point
        # apex_height = how much above origin_y the apex is
        # We need: landing_y = origin_y + (apex_height / apex_time^2) * apex_time * T - 0.5 * (2*apex_height/apex_time^2) * T^2

        # Simplify: at t=T, y should equal landing_y
        # y(T) = origin_y + (2*apex_height/apex_time) * T - (apex_height/apex_time^2) * T^2

        T = flight_duration
        t_a = apex_time

        # Solve quadratic for apex_height:
        # landing_y - origin_y = apex_height * (2*T/t_a - T^2/t_a^2)
        coefficient = 2 * T / t_a - (T * T) / (t_a * t_a)

        if abs(coefficient) < 0.001:
            # Degenerate case, use default
            apex_height = 0.3
        else:
            apex_height = (origin_y - landing_y) / coefficient

        # Clamp apex height to reasonable range (ball should go up)
        apex_height = max(0.1, min(0.6, apex_height))

        # Recalculate gravity from apex height
        # At apex: 0 = v0 - g*t_a, so v0 = g*t_a
        # Apex height: apex_height = v0*t_a - 0.5*g*t_a^2 = 0.5*g*t_a^2
        # So: g = 2*apex_height / t_a^2
        gravity = 2 * apex_height / (t_a * t_a)
        v_y0 = gravity * t_a

        # Lateral velocity (constant horizontal movement)
        v_x = dx / T

        # Generate trajectory points
        sample_rate = 30.0
        points = []
        apex_idx = 0
        min_y = origin_y

        t = 0.0
        while t <= T:
            y_offset = v_y0 * t - 0.5 * gravity * t * t
            x_offset = v_x * t

            screen_x = origin_x + x_offset
            screen_y = origin_y - y_offset  # Subtract because screen y increases downward

            if screen_y < min_y:
                min_y = screen_y
                apex_idx = len(points)

            points.append({
                "timestamp": strike_time + t,
                "x": max(0.0, min(1.0, screen_x)),
                "y": max(0.0, min(1.0, screen_y)),
                "confidence": 0.85,
                "interpolated": True,
            })
            t += 1.0 / sample_rate

        # Ensure last point is exactly at landing
        if points:
            points[-1]["x"] = landing_x
            points[-1]["y"] = landing_y

        if len(points) < 2:
            logger.warning("Failed to generate trajectory points")
            return None

        apex_point = {
            "timestamp": points[apex_idx]["timestamp"],
            "x": points[apex_idx]["x"],
            "y": points[apex_idx]["y"],
        }

        logger.info(
            f"Generated constrained trajectory: {len(points)} points, "
            f"origin=({origin_x:.3f}, {origin_y:.3f}), "
            f"landing=({landing_x:.3f}, {landing_y:.3f}), "
            f"apex_y={min_y:.3f}, duration={T:.2f}s"
        )

        return {
            "points": points,
            "apex_point": apex_point,
            "landing_point": {
                "timestamp": points[-1]["timestamp"],
                "x": landing_x,
                "y": landing_y,
            },
            "confidence": 0.85,
            "method": "constrained_landing",
            "launch_angle": launch_params.get("launch_angle", 18.0),
            "lateral_angle": launch_params.get("lateral_angle", 0.0),
            "shot_shape": launch_params.get("shot_shape", "straight"),
            "flight_duration": T,
        }
```

**Step 4: Add Callable import if needed**

At top of `tracker.py`, ensure this import exists:

```python
from typing import List, Optional, Tuple, Callable
```

**Step 5: Run test to verify it passes**

```bash
pytest tests/test_track_with_landing.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/backend/detection/tracker.py src/backend/tests/test_track_with_landing.py
git commit -m "feat: add track_with_landing_point method for constrained trajectory"
```

---

## Task 5: Wire SSE to Trajectory Generation

**Files:**
- Modify: `src/backend/api/routes.py` (update SSE endpoint)

**Step 1: Update the SSE endpoint**

Replace the placeholder implementation in `generate_trajectory_sse` with the full implementation:

```python
@router.get("/trajectory/{job_id}/{shot_id}/generate")
async def generate_trajectory_sse(
    job_id: str,
    shot_id: int,
    landing_x: float = Query(..., ge=0, le=1, description="Landing X coordinate (0-1)"),
    landing_y: float = Query(..., ge=0, le=1, description="Landing Y coordinate (0-1)"),
):
    """Generate trajectory with SSE progress updates.

    Returns Server-Sent Events with:
    - event: progress - Progress updates during generation
    - event: warning - Non-fatal detection issues
    - event: complete - Final trajectory data
    - event: error - Fatal errors
    """
    from backend.models.job import get_job, get_shots_for_job, update_shot_landing
    from backend.models.trajectory import create_trajectory, get_trajectory
    from backend.detection.tracker import ConstrainedBallTracker
    from backend.detection.origin import BallOriginDetector
    from backend.core.video import get_video_info

    # Verify job exists
    job = await get_job(job_id, include_shots=False)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    video_path = Path(job["video_path"])
    if not video_path.exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    # Get shot info
    shots = await get_shots_for_job(job_id)
    shot = next((s for s in shots if s["id"] == shot_id), None)
    if not shot:
        raise HTTPException(status_code=404, detail=f"Shot {shot_id} not found in job {job_id}")

    # Get video dimensions
    video_info = get_video_info(str(video_path))
    frame_width = video_info.width
    frame_height = video_info.height

    # Queues for progress/warning from sync code
    progress_queue: asyncio.Queue = asyncio.Queue()
    warning_queue: asyncio.Queue = asyncio.Queue()

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # Step 1: Save landing point
            yield sse_event("progress", {
                "step": "saving",
                "progress": 5,
                "message": "Saving landing point..."
            })

            await update_shot_landing(job_id, shot_id, landing_x, landing_y)

            # Step 2: Detect ball origin
            yield sse_event("progress", {
                "step": "origin_detection",
                "progress": 10,
                "message": "Detecting ball origin..."
            })

            origin_detector = BallOriginDetector()
            origin = origin_detector.detect_origin(
                str(video_path),
                shot["strike_time"],
            )

            if origin is None:
                yield sse_event("error", {
                    "error": "Could not find ball position at impact. Try a different video angle.",
                    "progress": 0
                })
                return

            if origin.confidence < 0.7:
                yield sse_event("warning", {
                    "step": "origin_detection",
                    "progress": 15,
                    "message": f"Low confidence origin detection ({origin.confidence:.0%}), tracer may be inaccurate",
                    "warning": "low_origin_confidence"
                })

            # Step 3: Generate trajectory with landing constraint
            tracker = ConstrainedBallTracker(origin_detector=origin_detector)

            warnings_emitted = []

            def progress_callback(percent: int, message: str):
                # Map 0-100 to 20-90 range
                mapped = 20 + int(percent * 0.7)
                progress_queue.put_nowait({"progress": mapped, "message": message})

            def warning_callback(code: str, message: str):
                warning_queue.put_nowait({"code": code, "message": message})

            # Run trajectory generation in thread pool
            loop = asyncio.get_event_loop()
            trajectory_result = await loop.run_in_executor(
                None,
                lambda: tracker.track_with_landing_point(
                    video_path=video_path,
                    origin=origin,
                    strike_time=shot["strike_time"],
                    landing_point=(landing_x, landing_y),
                    frame_width=frame_width,
                    frame_height=frame_height,
                    progress_callback=progress_callback,
                    warning_callback=warning_callback,
                )
            )

            # Drain progress queue
            while not progress_queue.empty():
                try:
                    prog = progress_queue.get_nowait()
                    yield sse_event("progress", {
                        "step": "generating",
                        "progress": prog["progress"],
                        "message": prog["message"]
                    })
                except asyncio.QueueEmpty:
                    break

            # Drain warning queue
            while not warning_queue.empty():
                try:
                    warn = warning_queue.get_nowait()
                    yield sse_event("warning", {
                        "step": "generating",
                        "progress": 50,
                        "message": warn["message"],
                        "warning": warn["code"]
                    })
                except asyncio.QueueEmpty:
                    break

            if trajectory_result is None:
                yield sse_event("error", {
                    "error": "Failed to generate trajectory. Try marking a different landing point.",
                    "progress": 0
                })
                return

            # Step 4: Save trajectory to database
            yield sse_event("progress", {
                "step": "saving_trajectory",
                "progress": 95,
                "message": "Saving trajectory..."
            })

            await create_trajectory(
                job_id=job_id,
                shot_id=shot_id,
                trajectory_points=trajectory_result["points"],
                confidence=trajectory_result.get("confidence", 0.8),
                apex_point=trajectory_result.get("apex_point"),
                launch_angle=trajectory_result.get("launch_angle"),
                flight_duration=trajectory_result.get("flight_duration"),
                frame_width=frame_width,
                frame_height=frame_height,
            )

            # Step 5: Return complete trajectory
            final_trajectory = await get_trajectory(job_id, shot_id)

            yield sse_event("complete", {
                "trajectory": final_trajectory,
                "progress": 100
            })

        except Exception as e:
            logger.error(f"Trajectory generation failed: {e}")
            yield sse_event("error", {
                "error": str(e),
                "progress": 0
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
```

**Step 2: Run tests**

```bash
pytest tests/ -v -x --tb=short
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/backend/api/routes.py
git commit -m "feat: wire SSE endpoint to trajectory generation with progress/warnings"
```

---

## Task 6: Frontend Landing Point State & Click Handler

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`

**Step 1: Add new state variables**

In ClipReview.tsx, add after existing state declarations (around line 58):

```typescript
const [landingPoint, setLandingPoint] = useState<{x: number, y: number} | null>(null)
const [trajectoryProgress, setTrajectoryProgress] = useState<number | null>(null)
const [trajectoryMessage, setTrajectoryMessage] = useState<string>('')
const [detectionWarnings, setDetectionWarnings] = useState<string[]>([])
const [trajectoryError, setTrajectoryError] = useState<string | null>(null)
const [eventSourceRef, setEventSourceRef] = useState<EventSource | null>(null)
```

**Step 2: Add click handler**

Add after the existing handlers (around line 200):

```typescript
const handleVideoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
  if (!videoRef.current || loadingState === 'loading' || trajectoryProgress !== null) return

  const rect = videoRef.current.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height

  // Clamp to valid range
  const clampedX = Math.max(0, Math.min(1, x))
  const clampedY = Math.max(0, Math.min(1, y))

  setLandingPoint({ x: clampedX, y: clampedY })
  setTrajectoryError(null)
  generateTrajectorySSE(clampedX, clampedY)
}, [loadingState, trajectoryProgress])

const clearLandingPoint = useCallback(() => {
  // Cancel any ongoing SSE connection
  if (eventSourceRef) {
    eventSourceRef.close()
    setEventSourceRef(null)
  }

  setLandingPoint(null)
  setTrajectory(null)
  setTrajectoryProgress(null)
  setTrajectoryMessage('')
  setDetectionWarnings([])
  setTrajectoryError(null)
}, [eventSourceRef])
```

**Step 3: Reset landing point when shot changes**

Add to the useEffect that handles shot changes (around line 67):

```typescript
// Reset landing point when shot changes
useEffect(() => {
  setLandingPoint(null)
  setTrajectoryProgress(null)
  setTrajectoryMessage('')
  setDetectionWarnings([])
  setTrajectoryError(null)
}, [currentShot?.id])
```

**Step 4: Add click handler to video container**

Update the video container div (around line 559):

```tsx
<div
  className={`video-container ${!videoLoaded ? 'video-loading' : ''}`}
  onClick={handleVideoClick}
  style={{ cursor: landingPoint === null ? 'crosshair' : 'default' }}
>
```

**Step 5: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat: add landing point state and click handler to ClipReview"
```

---

## Task 7: Frontend SSE Connection & Progress Bar

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`

**Step 1: Add SSE connection function**

Add after the click handler:

```typescript
const generateTrajectorySSE = useCallback((landingX: number, landingY: number) => {
  // Cancel previous connection if any
  if (eventSourceRef) {
    eventSourceRef.close()
  }

  setTrajectoryProgress(0)
  setTrajectoryMessage('Starting...')
  setDetectionWarnings([])
  setTrajectoryError(null)

  const url = `http://127.0.0.1:8420/api/trajectory/${jobId}/${currentShot?.id}/generate?landing_x=${landingX}&landing_y=${landingY}`
  const eventSource = new EventSource(url)
  setEventSourceRef(eventSource)

  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data)
    setTrajectoryProgress(data.progress)
    setTrajectoryMessage(data.message || '')
  })

  eventSource.addEventListener('warning', (e) => {
    const data = JSON.parse(e.data)
    setDetectionWarnings(prev => [...prev, data.message])
  })

  eventSource.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data)
    setTrajectory(data.trajectory)
    setTrajectoryProgress(null)
    setTrajectoryMessage('')
    eventSource.close()
    setEventSourceRef(null)
  })

  eventSource.addEventListener('error', (e) => {
    try {
      const data = JSON.parse((e as any).data)
      setTrajectoryError(data.error || 'Failed to generate trajectory')
    } catch {
      setTrajectoryError('Connection lost during trajectory generation')
    }
    setTrajectoryProgress(null)
    eventSource.close()
    setEventSourceRef(null)
  })

  eventSource.onerror = () => {
    setTrajectoryError('Connection lost during trajectory generation')
    setTrajectoryProgress(null)
    eventSource.close()
    setEventSourceRef(null)
  }
}, [jobId, currentShot?.id, eventSourceRef])
```

**Step 2: Add progress bar UI**

Add after the tracer controls div (around line 665):

```tsx
{/* Landing point section */}
<div className="landing-point-section">
  {trajectoryProgress !== null ? (
    <div className="trajectory-progress">
      <div className="progress-header">
        Generating tracer... {trajectoryProgress}%
      </div>
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${trajectoryProgress}%` }}
        />
      </div>
      <div className="progress-message">{trajectoryMessage}</div>
    </div>
  ) : landingPoint ? (
    <div className="landing-confirmed">
      <span className="landing-icon">📍</span>
      <span>Landing: ({landingPoint.x.toFixed(2)}, {landingPoint.y.toFixed(2)})</span>
      <button
        className="btn-clear"
        onClick={clearLandingPoint}
        title="Clear landing point"
      >
        Clear
      </button>
    </div>
  ) : (
    <div className="landing-prompt">
      <span className="landing-icon">📍</span>
      <span>Click on video to mark landing point</span>
    </div>
  )}

  {trajectoryError && (
    <div className="trajectory-error">
      <span className="error-icon">⚠</span>
      <span>{trajectoryError}</span>
    </div>
  )}

  {detectionWarnings.length > 0 && (
    <div className="detection-warnings">
      {detectionWarnings.map((warning, i) => (
        <div key={i} className="warning-item">
          <span className="warning-icon">⚠</span>
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )}
</div>
```

**Step 3: Add CSS styles**

Add to the existing styles in the component or App.css:

```css
.landing-point-section {
  margin: 16px 0;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.trajectory-progress {
  text-align: center;
}

.progress-header {
  font-weight: 500;
  margin-bottom: 8px;
}

.progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80, #22c55e);
  transition: width 0.3s ease;
}

.progress-message {
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.6);
}

.landing-confirmed {
  display: flex;
  align-items: center;
  gap: 8px;
}

.landing-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.6);
}

.landing-icon {
  font-size: 1.2rem;
}

.btn-clear {
  margin-left: auto;
  padding: 4px 12px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
}

.btn-clear:hover {
  background: rgba(255, 255, 255, 0.1);
}

.trajectory-error {
  margin-top: 8px;
  padding: 8px;
  background: rgba(239, 68, 68, 0.2);
  border-radius: 4px;
  color: #ef4444;
  display: flex;
  align-items: center;
  gap: 8px;
}

.detection-warnings {
  margin-top: 8px;
}

.warning-item {
  padding: 6px 8px;
  background: rgba(234, 179, 8, 0.1);
  border-radius: 4px;
  color: #eab308;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 0.9rem;
}

.warning-icon {
  flex-shrink: 0;
}
```

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx src/frontend/src/App.css
git commit -m "feat: add SSE connection and progress bar for trajectory generation"
```

---

## Task 8: Landing Marker in TrajectoryEditor

**Files:**
- Modify: `src/frontend/src/components/TrajectoryEditor.tsx`

**Step 1: Add landing point prop**

Update the component props interface:

```typescript
interface TrajectoryEditorProps {
  videoRef: React.RefObject<HTMLVideoElement>
  trajectory: TrajectoryData | null
  currentTime: number
  showTracer: boolean
  disabled: boolean
  onTrajectoryUpdate: (points: TrajectoryPoint[]) => void
  landingPoint?: { x: number; y: number } | null  // NEW
}
```

**Step 2: Destructure new prop**

```typescript
export function TrajectoryEditor({
  videoRef,
  trajectory,
  currentTime,
  showTracer,
  disabled,
  onTrajectoryUpdate,
  landingPoint,  // NEW
}: TrajectoryEditorProps) {
```

**Step 3: Add landing marker rendering**

In the render function, after drawing the trajectory line, add:

```typescript
// Draw landing marker (X shape)
if (landingPoint && canvasWidth && canvasHeight) {
  const markerX = landingPoint.x * canvasWidth
  const markerY = landingPoint.y * canvasHeight
  const markerSize = 12

  ctx.save()

  // Glow effect
  ctx.shadowColor = 'rgba(255, 255, 255, 0.8)'
  ctx.shadowBlur = 8

  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.lineCap = 'round'

  // Draw X
  ctx.beginPath()
  ctx.moveTo(markerX - markerSize, markerY - markerSize)
  ctx.lineTo(markerX + markerSize, markerY + markerSize)
  ctx.moveTo(markerX + markerSize, markerY - markerSize)
  ctx.lineTo(markerX - markerSize, markerY + markerSize)
  ctx.stroke()

  ctx.restore()
}
```

**Step 4: Update ClipReview to pass landing point**

In ClipReview.tsx, update the TrajectoryEditor usage:

```tsx
<TrajectoryEditor
  videoRef={videoRef}
  trajectory={trajectory}
  currentTime={currentTime}
  showTracer={showTracer}
  disabled={false}
  landingPoint={landingPoint}  // NEW
  onTrajectoryUpdate={(points) => {
    // ... existing code
  }}
/>
```

**Step 5: Commit**

```bash
git add src/frontend/src/components/TrajectoryEditor.tsx src/frontend/src/components/ClipReview.tsx
git commit -m "feat: add landing marker (X) to TrajectoryEditor overlay"
```

---

## Task 9: Update Buttons & Flow

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`

**Step 1: Replace Accept/Reject with Skip/Next**

Find the review actions div and replace:

```tsx
<div className="review-actions">
  <button
    onClick={handleReject}
    className="btn-secondary btn-skip"
    disabled={loadingState === 'loading' || trajectoryProgress !== null}
    title="Skip Shot (Escape)"
  >
    Skip Shot
  </button>
  <button
    onClick={handleAccept}
    className="btn-primary btn-next"
    disabled={loadingState === 'loading' || trajectoryProgress !== null || landingPoint === null}
    title={landingPoint === null ? "Mark landing point first" : "Next (Enter)"}
  >
    {loadingState === 'loading' ? (
      <>
        <span className="spinner" />
        Saving...
      </>
    ) : (
      'Next →'
    )}
  </button>
</div>
```

**Step 2: Update keyboard shortcuts**

In the keyboard handler, update Enter to require landing point:

```typescript
case 'Enter':
  e.preventDefault()
  if (landingPoint !== null) {
    handleAccept()
  }
  break
```

**Step 3: Update handleAccept**

The existing handleAccept should work as-is since it already marks as approved and moves to next. The landing point is already saved via SSE.

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat: replace Accept/Reject with Skip/Next, require landing point for Next"
```

---

## Task 10: Integration Testing

**Files:**
- Create: `src/backend/tests/test_landing_integration.py`

**Step 1: Write integration test**

```python
"""Integration tests for landing point marking flow."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db_path():
    """Create a temporary database path."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield Path(path)
    if os.path.exists(path):
        os.unlink(path)


def test_full_landing_point_flow(temp_db_path):
    """Test complete flow: create job, add shot, mark landing, generate trajectory."""
    with patch("backend.core.database.DB_PATH", temp_db_path):
        import importlib
        import backend.core.database as db_module
        import backend.models.job as job_module
        importlib.reload(db_module)
        importlib.reload(job_module)

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            loop.run_until_complete(db_module.init_db())

            async def setup():
                # Create job
                await job_module.create_job(
                    job_id="integration-test",
                    video_path="/tmp/fake.mp4",
                    output_dir="/tmp/output",
                    auto_approve=True,
                    video_info={"width": 1920, "height": 1080, "fps": 60},
                )

                # Create shot
                await job_module.create_shots("integration-test", [
                    {
                        "id": 1,
                        "strike_time": 10.0,
                        "clip_start": 8.0,
                        "clip_end": 14.0,
                        "confidence": 0.5,
                        "audio_confidence": 0.6,
                        "visual_confidence": 0.4,
                    }
                ])

                # Mark landing point
                result = await job_module.update_shot_landing(
                    "integration-test", 1, 0.65, 0.85
                )
                assert result is True

                # Verify landing was saved
                shots = await job_module.get_shots_for_job("integration-test")
                assert shots[0]["landing_x"] == 0.65
                assert shots[0]["landing_y"] == 0.85

            loop.run_until_complete(setup())
            loop.run_until_complete(db_module.close_db())

        finally:
            loop.close()
```

**Step 2: Run all tests**

```bash
pytest tests/ -v --tb=short
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/backend/tests/test_landing_integration.py
git commit -m "test: add integration test for landing point flow"
```

---

## Final Steps

After all tasks complete:

1. **Run full test suite:**
   ```bash
   cd /Users/ecoon/golf-clip/.worktrees/landing-point
   source /Users/ecoon/golf-clip/.venv/bin/activate
   cd src/backend && pytest tests/ -v
   cd ../frontend && npm run build
   ```

2. **Manual testing:**
   - Start backend: `uvicorn backend.main:app --reload --port 8420`
   - Start frontend: `npm run dev`
   - Upload test video
   - Click on video to mark landing point
   - Verify progress bar appears
   - Verify tracer is generated ending at landing point
   - Verify warnings display if detection issues occur

3. **Create PR or merge:**
   Use `superpowers:finishing-a-development-branch` skill
