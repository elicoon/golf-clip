# GolfClip Parallel Development Tasks

These are standalone tasks that can be executed by separate Claude Code instances in parallel. Each prompt is self-contained with all necessary context.

---

## Task 1: Frontend SSE Integration

**Estimated complexity:** Medium
**Files to modify:** `golf-clip/src/frontend/src/components/ProcessingView.tsx`
**Dependencies:** None (backend SSE endpoint already exists)

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Replace polling with SSE (Server-Sent Events) for real-time progress updates.

Files you own (only modify these):
- golf-clip/src/frontend/src/components/ProcessingView.tsx

Context:
- The backend now has an SSE endpoint: GET /api/progress/{job_id}
- SSE events are JSON with: { job_id, step, progress, details, timestamp }
- The endpoint sends a "complete" event type when finished
- Keepalive comments are sent every 30s

Current state:
- ProcessingView.tsx polls /api/status/{jobId} every 1 second
- This is inefficient and has latency

Requirements:
1. Replace setInterval polling with EventSource for SSE
2. Connect to http://127.0.0.1:8420/api/progress/{jobId}
3. Parse incoming JSON events and update UI state
4. Handle the "complete" event to transition views
5. Implement reconnection logic on connection drop (max 3 retries)
6. Clean up EventSource on component unmount
7. Fall back to polling if SSE fails to connect

The SSE event format from backend:
{
  "job_id": "uuid",
  "step": "Analyzing audio for strikes",
  "progress": 45.5,
  "details": null,
  "timestamp": "2024-01-15T10:30:00Z"
}

Keep the existing UI structure - just change how data is fetched.
```

---

## Task 2: Frontend Cancel Job Feature

**Estimated complexity:** Low
**Files to modify:** `golf-clip/src/frontend/src/components/ProcessingView.tsx`
**Dependencies:** None (backend cancel endpoint already exists)

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Add a cancel button to stop processing jobs.

Files you own (only modify these):
- golf-clip/src/frontend/src/components/ProcessingView.tsx

Context:
- The backend has a cancel endpoint: POST /api/cancel/{job_id}
- It returns: { "status": "cancelling", "message": "Cancellation requested" }
- The job status will transition to "cancelled" shortly after

Requirements:
1. Add a "Cancel" button below the progress bar
2. Style it as a secondary/danger button (use existing CSS variables)
3. On click, POST to /api/cancel/{jobId}
4. Show "Cancelling..." state while waiting
5. When status becomes "cancelled", show a message and return to home view
6. Disable the button if job is already completing

CSS variables available in global.css:
- --color-error: #ef4444
- --color-error-dark: #dc2626
- Button styles exist for .btn-primary, create .btn-danger similarly

Add the button in a way that doesn't disrupt the existing progress UI.
```

---

## Task 3: End-to-End Integration Tests

**Estimated complexity:** Medium
**Files to create:** `golf-clip/src/backend/tests/test_integration.py`
**Dependencies:** None

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Create end-to-end integration tests for the API.

Files you own (only modify/create these):
- golf-clip/src/backend/tests/test_integration.py
- golf-clip/src/backend/tests/conftest.py (if needed)

Context:
- Backend is FastAPI at golf-clip/src/backend/
- Main app is in main.py, routes in api/routes.py
- Uses pytest for testing

Requirements:
1. Create pytest fixtures for:
   - FastAPI TestClient
   - A small test video file (create a 2-second synthetic video using ffmpeg or opencv)
   - Cleanup of test artifacts

2. Test the full processing flow:
   - POST /api/process with test video
   - Poll /api/status/{job_id} until complete or timeout
   - GET /api/shots/{job_id} to verify shots detected
   - POST /api/shots/{job_id}/update to approve shots
   - POST /api/export to export clips
   - Verify exported files exist

3. Test error cases:
   - Process non-existent file (404)
   - Get status for invalid job_id (404)
   - Cancel already-completed job (400)

4. Test job management:
   - GET /api/jobs returns job list
   - DELETE /api/jobs/{job_id} removes job

Use pytest-asyncio for async tests. The backend routes are async.

Note: The detection pipeline uses ML models, so tests may take 30-60 seconds.
Consider adding a @pytest.mark.slow decorator for the full flow test.
```

---

## Task 4: Shot Type Classification

**Estimated complexity:** High
**Files to modify:** `golf-clip/src/backend/detection/pipeline.py`
**Files to create:** `golf-clip/src/backend/detection/classifier.py`
**Dependencies:** None

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Implement shot type classification (drive, iron, chip, putt).

Files you own (only modify/create these):
- golf-clip/src/backend/detection/classifier.py (new)
- golf-clip/src/backend/detection/pipeline.py (integrate classifier)

Context:
- The pipeline detects shots but shot_type is always None
- DetectedShot schema has: shot_type: Optional[str] (drive, iron, chip, putt)
- We have audio confidence and visual confidence per shot
- AudioStrikeDetector provides spectral features (frequency_centroid, spectral_flatness)

Requirements:
1. Create ShotClassifier class in classifier.py with:
   - classify(audio_features: dict, visual_features: dict, clip_duration: float) -> tuple[str, float]
   - Returns (shot_type, confidence)

2. Classification heuristics based on:
   - Audio: Drives have louder, lower-frequency impacts than chips
   - Duration: Putts have short flight time, drives have long
   - Ball trajectory: Chips have high arc, putts stay low (if visual data available)

3. Simple rule-based classifier for MVP:
   - clip_duration > 6s AND audio strong -> "drive"
   - clip_duration 3-6s -> "iron"
   - clip_duration 1-3s AND high visual arc -> "chip"
   - clip_duration < 3s AND low trajectory -> "putt"
   - Default to "iron" if uncertain

4. Integrate into pipeline.py:
   - Import and instantiate ShotClassifier
   - Call classify() when building DetectedShot objects
   - Pass audio features from the strike detection

Keep it simple - this is MVP. A future ML model can replace these heuristics.
```

---

## Task 5: SQLite Persistence Layer

**Estimated complexity:** Medium-High
**Files to create:** `golf-clip/src/backend/core/database.py`, `golf-clip/src/backend/models/job.py`
**Files to modify:** `golf-clip/src/backend/api/routes.py`
**Dependencies:** None

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Add SQLite persistence for jobs so they survive app restarts.

Files you own (only modify/create these):
- golf-clip/src/backend/core/database.py (new)
- golf-clip/src/backend/models/job.py (new)
- golf-clip/src/backend/api/routes.py (update to use DB)

Context:
- Currently jobs are stored in an in-memory dict: jobs: dict[str, dict] = {}
- Jobs have: video_path, output_dir, status, progress, current_step, shots, video_info, created_at, completed_at, error, cancelled
- SQLite file should go in ~/.golfclip/golfclip.db

Requirements:
1. Create database.py with:
   - SQLite connection using aiosqlite for async
   - init_db() to create tables on startup
   - get_db() dependency for FastAPI

2. Create job.py with SQLAlchemy models (or raw SQL):
   - Job table: id mod(UUID), video_path, output_dir, status, progress, current_step, created_at, started_at, completed_at, error_json, cancelled
   - Shot table: id, job_id (FK), strike_time, landing_time, clip_start, clip_end, confidence, shot_type, audio_confidence, visual_confidence, confidence_reasons_json

3. Update routes.py:
   - Replace `jobs` dict with database operations
   - Keep the same API contract (no breaking changes)
   - Load existing jobs on startup
   - The SSE progress queues can stay in-memory (transient)

4. Add to main.py lifespan:
   - Call init_db() on startup

Use aiosqlite for async SQLite. Keep the migration simple - just CREATE TABLE IF NOT EXISTS.
```

---

## Task 6: YOLO Model Pre-download

**Estimated complexity:** Low
**Files to modify:** `golf-clip/src/backend/main.py`, `golf-clip/src/backend/detection/visual.py`
**Dependencies:** None

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Pre-download the YOLO model on app startup instead of first use.

Files you own (only modify these):
- golf-clip/src/backend/main.py
- golf-clip/src/backend/detection/visual.py

Context:
- BallDetector in visual.py downloads yolov8n.pt on first use
- This causes a delay during the first video processing
- Model is stored in ~/.golfclip/models/
- Settings has: models_dir and yolo_model (default: yolov8n.pt)

Requirements:
1. Add a function in visual.py:
   - ensure_model_downloaded() -> bool
   - Downloads model if not present
   - Returns True if model is ready
   - Logs download progress

2. Update main.py lifespan startup:
   - Call ensure_model_downloaded()
   - Log success or failure
   - Don't block startup if download fails (user might be offline)

3. Add a health check enhancement:
   - GET /health should include "model_ready": true/false

4. Consider adding a dedicated endpoint:
   - GET /api/model-status -> { "downloaded": bool, "path": str, "size_mb": float }

Keep the lazy loading in BallDetector.load_model() as fallback.
```

---

## Task 7: Export Progress Tracking

**Estimated complexity:** Low-Medium
**Files to modify:** `golf-clip/src/backend/api/routes.py`, `golf-clip/src/frontend/src/components/ClipReview.tsx`
**Dependencies:** None

### Prompt:

```
I'm working on GolfClip, a Mac desktop app that auto-detects golf shots in video.

Your task: Add progress tracking for clip export (currently blocks with no feedback).

Files you own (only modify these):
- golf-clip/src/backend/api/routes.py
- golf-clip/src/frontend/src/components/ClipReview.tsx

Context:
- POST /api/export currently exports all clips synchronously
- For many clips, this can take a while with no user feedback
- The extract_clip function in video.py handles individual clips

Requirements:

Backend (routes.py):
1. Create a new export job model similar to processing jobs
2. POST /api/export returns immediately with an export_job_id
3. Add GET /api/export/{export_job_id}/status endpoint
4. Track: total_clips, exported_count, current_clip, errors
5. Run export in background task

Frontend (ClipReview.tsx):
1. After calling /api/export, show an export progress modal
2. Poll /api/export/{id}/status every 500ms
3. Show "Exporting clip 3 of 12..." with progress bar
4. When complete, show success message with output directory
5. Handle partial failures gracefully (show which clips failed)

Keep the existing export request/response schemas compatible.
The ExportClipsResponse schema already has an errors array.
```

---

## Execution Order Recommendations

**Can run fully in parallel (no dependencies):**
- Task 1 (SSE)
- Task 2 (Cancel)
- Task 3 (Tests)
- Task 4 (Classifier)
- Task 6 (Model download)

**Should run after Task 1 is merged:**
- Task 7 (Export progress) - similar pattern to SSE

**Should run last (touches many files):**
- Task 5 (SQLite) - significant refactor of routes.py

---

## Notes for All Tasks

- The backend runs on http://127.0.0.1:8420
- Use existing code patterns and styles
- Don't modify files outside your ownership list
- Test your changes work with the existing system
- Keep backwards compatibility with the API
