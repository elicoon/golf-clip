# Tracer Feedback System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Capture user feedback on auto-generated tracers to improve trajectory prediction over time.

**Architecture:** Simplified review flow that auto-generates tracers after landing point marking, collects implicit feedback through user actions, and stores deltas between auto-generated and user-configured parameters for ML training.

**Tech Stack:** FastAPI, React/TypeScript, SQLite, scikit-learn (future ML)

---

## Overview

### New Review Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Video auto-plays, user sees shot                            │
├─────────────────────────────────────────────────────────────────┤
│  2. "Is this a golf shot?"                                      │
│     ├─ No → false_positive feedback → next shot                 │
│     └─ Yes → proceed                                            │
├─────────────────────────────────────────────────────────────────┤
│  3. "Mark where the ball landed" (mandatory)                    │
│     User clicks on video → landing point set                    │
├─────────────────────────────────────────────────────────────────┤
│  4. Auto-generate tracer immediately                            │
│     System uses: origin (auto) + landing (user) + early detect  │
├─────────────────────────────────────────────────────────────────┤
│  5. "Does this tracer look right?"                              │
│     ├─ Yes → record tracer_accepted → Next button enabled       │
│     └─ No, adjust → show config panel                           │
├─────────────────────────────────────────────────────────────────┤
│  6. Config Panel (if adjusting):                                │
│     - Shot height: Low / Medium / High                          │
│     - Shot shape: Hook / Draw / Straight / Fade / Slice         │
│     - Starting line: Left / Center / Right                      │
│     - Flight time: 1.0s - 6.0s slider                           │
│     - Apex point: (click to mark, optional)                     │
│     - [Generate] button                                         │
│     - Hint: "Click Generate to see updated tracer"              │
├─────────────────────────────────────────────────────────────────┤
│  7. "Tracer still doesn't look right" button:                   │
│     ├─ Check: tried all optional inputs?                        │
│     │   └─ No → "Try marking the apex point" / "Try adjusting X"│
│     └─ Yes → Thank you message → offer:                         │
│         - Accept current trajectory                             │
│         - Skip shot entirely                                    │
│         - Accept shot without trajectory                        │
├─────────────────────────────────────────────────────────────────┤
│  8. User clicks "Next →" = satisfied, move to next shot         │
│     (Can re-mark landing/apex anytime before clicking Next)     │
└─────────────────────────────────────────────────────────────────┘
```

### Feedback Data Captured

| User Action | Feedback Type | Data Stored |
|-------------|---------------|-------------|
| "No golf shot" | `false_positive` | shot_id, confidence |
| Auto-tracer accepted immediately | `tracer_auto_accepted` | auto_params |
| Configured then accepted | `tracer_configured` | auto_params, final_params, delta |
| "Still doesn't look right" → accept anyway | `tracer_reluctant_accept` | auto_params, final_params, all inputs tried |
| "Still doesn't look right" → skip | `tracer_skip` | auto_params, final_params |
| "Still doesn't look right" → no tracer | `tracer_rejected` | auto_params, final_params |

### ML Training Data (The Delta)

```json
{
  "origin": {"x": 0.45, "y": 0.85},
  "landing": {"x": 0.72, "y": 0.65},
  "auto_params": {
    "height": "medium",
    "shape": "straight",
    "starting_line": "center",
    "flight_time": 3.0,
    "apex": null
  },
  "final_params": {
    "height": "high",
    "shape": "draw",
    "starting_line": "right",
    "flight_time": 4.5,
    "apex": {"x": 0.55, "y": 0.25}
  },
  "delta": {
    "height": "+1",
    "shape": "straight→draw",
    "starting_line": "center→right",
    "flight_time": "+1.5",
    "apex": "added"
  },
  "outcome": "tracer_configured"
}
```

---

## Task 1: Database Schema for Tracer Feedback

**Files:**
- Modify: `src/backend/core/database.py` - Add migration v6
- Modify: `src/backend/models/trajectory.py` - Add tracer feedback CRUD
- Create: `src/backend/tests/test_tracer_feedback_db.py`

**Step 1: Write failing test for tracer feedback storage**

```python
# src/backend/tests/test_tracer_feedback_db.py
import pytest
from backend.models.trajectory import (
    create_tracer_feedback,
    get_tracer_feedback,
    get_tracer_feedback_for_job,
)

@pytest.mark.asyncio
async def test_create_tracer_feedback():
    """Test creating tracer feedback with auto and final params."""
    feedback = await create_tracer_feedback(
        job_id="test-job-123",
        shot_id=1,
        feedback_type="tracer_configured",
        auto_params={
            "height": "medium",
            "shape": "straight",
            "starting_line": "center",
            "flight_time": 3.0,
        },
        final_params={
            "height": "high",
            "shape": "draw",
            "starting_line": "right",
            "flight_time": 4.5,
            "apex": {"x": 0.55, "y": 0.25},
        },
        origin_point={"x": 0.45, "y": 0.85},
        landing_point={"x": 0.72, "y": 0.65},
    )

    assert feedback["id"] is not None
    assert feedback["feedback_type"] == "tracer_configured"
    assert feedback["auto_params"]["height"] == "medium"
    assert feedback["final_params"]["height"] == "high"


@pytest.mark.asyncio
async def test_get_tracer_feedback():
    """Test retrieving tracer feedback by ID."""
    # Create then retrieve
    created = await create_tracer_feedback(
        job_id="test-job-456",
        shot_id=2,
        feedback_type="tracer_auto_accepted",
        auto_params={"height": "medium", "shape": "straight"},
        final_params=None,  # Auto-accepted, no changes
        origin_point={"x": 0.5, "y": 0.8},
        landing_point={"x": 0.7, "y": 0.6},
    )

    retrieved = await get_tracer_feedback(created["id"])
    assert retrieved is not None
    assert retrieved["feedback_type"] == "tracer_auto_accepted"
    assert retrieved["final_params"] is None


@pytest.mark.asyncio
async def test_tracer_feedback_export():
    """Test exporting tracer feedback for ML training."""
    from backend.models.trajectory import export_tracer_feedback

    # Create several feedback records
    await create_tracer_feedback(
        job_id="export-test",
        shot_id=1,
        feedback_type="tracer_configured",
        auto_params={"height": "low"},
        final_params={"height": "high"},
        origin_point={"x": 0.5, "y": 0.8},
        landing_point={"x": 0.7, "y": 0.6},
    )

    export = await export_tracer_feedback()
    assert export["total_records"] >= 1
    assert "records" in export
    # Check delta is computed
    record = next(r for r in export["records"] if r["job_id"] == "export-test")
    assert "delta" in record
```

**Step 2: Run test to verify it fails**

```bash
pytest src/backend/tests/test_tracer_feedback_db.py -v
# Expected: FAIL - functions don't exist
```

**Step 3: Add database migration v6**

```python
# In database.py, add to MIGRATIONS list:
(
    6,
    """
    CREATE TABLE IF NOT EXISTS tracer_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        shot_id INTEGER NOT NULL,
        feedback_type TEXT NOT NULL,
        auto_params_json TEXT,
        final_params_json TEXT,
        origin_point_json TEXT,
        landing_point_json TEXT,
        apex_point_json TEXT,
        created_at TEXT NOT NULL,
        environment TEXT DEFAULT 'prod',
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tracer_feedback_job ON tracer_feedback(job_id);
    CREATE INDEX IF NOT EXISTS idx_tracer_feedback_type ON tracer_feedback(feedback_type);
    """,
    "Tracer feedback table for trajectory ML training",
),
```

**Step 4: Implement CRUD functions in trajectory.py**

```python
async def create_tracer_feedback(
    job_id: str,
    shot_id: int,
    feedback_type: str,
    auto_params: dict | None,
    final_params: dict | None,
    origin_point: dict,
    landing_point: dict,
    apex_point: dict | None = None,
) -> dict:
    """Create tracer feedback record."""
    from backend.core.environment import get_environment

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """
            INSERT INTO tracer_feedback
            (job_id, shot_id, feedback_type, auto_params_json, final_params_json,
             origin_point_json, landing_point_json, apex_point_json, created_at, environment)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                shot_id,
                feedback_type,
                json.dumps(auto_params) if auto_params else None,
                json.dumps(final_params) if final_params else None,
                json.dumps(origin_point),
                json.dumps(landing_point),
                json.dumps(apex_point) if apex_point else None,
                datetime.utcnow().isoformat(),
                get_environment(),
            ),
        )
        await db.commit()

        return {
            "id": cursor.lastrowid,
            "job_id": job_id,
            "shot_id": shot_id,
            "feedback_type": feedback_type,
            "auto_params": auto_params,
            "final_params": final_params,
        }


async def export_tracer_feedback(environment: str | None = None) -> dict:
    """Export tracer feedback with computed deltas for ML training."""
    # Implementation computes delta between auto_params and final_params
    ...
```

**Step 5: Run tests to verify they pass**

```bash
pytest src/backend/tests/test_tracer_feedback_db.py -v
# Expected: PASS
```

**Step 6: Commit**

```bash
git add src/backend/core/database.py src/backend/models/trajectory.py src/backend/tests/test_tracer_feedback_db.py
git commit -m "feat: add tracer feedback database schema and CRUD

- Add migration v6 for tracer_feedback table
- Store auto_params vs final_params for ML training
- Add export function with delta computation"
```

---

## Task 2: Tracer Feedback API Endpoints

**Files:**
- Modify: `src/backend/api/routes.py` - Add tracer feedback endpoints
- Modify: `src/backend/api/schemas.py` - Add request/response models
- Create: `src/backend/tests/test_tracer_feedback_api.py`

**Step 1: Write failing tests**

```python
# src/backend/tests/test_tracer_feedback_api.py
import pytest
from fastapi.testclient import TestClient

def test_submit_tracer_feedback(client: TestClient, sample_job_id: str):
    """Test submitting tracer feedback."""
    response = client.post(
        f"/api/tracer-feedback/{sample_job_id}",
        json={
            "shot_id": 1,
            "feedback_type": "tracer_configured",
            "auto_params": {"height": "medium", "shape": "straight"},
            "final_params": {"height": "high", "shape": "draw"},
            "origin_point": {"x": 0.5, "y": 0.8},
            "landing_point": {"x": 0.7, "y": 0.6},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["feedback_type"] == "tracer_configured"


def test_get_tracer_feedback_stats(client: TestClient):
    """Test getting tracer feedback statistics."""
    response = client.get("/api/tracer-feedback/stats")
    assert response.status_code == 200
    data = response.json()
    assert "total_feedback" in data
    assert "auto_accepted_rate" in data


def test_export_tracer_feedback(client: TestClient):
    """Test exporting tracer feedback for ML."""
    response = client.get("/api/tracer-feedback/export")
    assert response.status_code == 200
    data = response.json()
    assert "records" in data
    assert "total_records" in data
```

**Step 2: Run tests to verify they fail**

```bash
pytest src/backend/tests/test_tracer_feedback_api.py -v
# Expected: FAIL - endpoints don't exist
```

**Step 3: Add Pydantic schemas**

```python
# In schemas.py
class TracerFeedbackRequest(BaseModel):
    shot_id: int
    feedback_type: Literal[
        "tracer_auto_accepted",
        "tracer_configured",
        "tracer_reluctant_accept",
        "tracer_skip",
        "tracer_rejected",
    ]
    auto_params: dict | None = None
    final_params: dict | None = None
    origin_point: dict
    landing_point: dict
    apex_point: dict | None = None


class TracerFeedbackResponse(BaseModel):
    id: int
    job_id: str
    shot_id: int
    feedback_type: str
    auto_params: dict | None
    final_params: dict | None
    created_at: str
    environment: str


class TracerFeedbackStats(BaseModel):
    total_feedback: int
    auto_accepted: int
    configured: int
    rejected: int
    auto_accepted_rate: float
    common_adjustments: dict  # e.g., {"height": {"+1": 45, "-1": 12}}
```

**Step 4: Implement API endpoints**

```python
# In routes.py
@app.post("/api/tracer-feedback/{job_id}")
async def submit_tracer_feedback(
    job_id: str,
    request: TracerFeedbackRequest,
) -> TracerFeedbackResponse:
    """Submit feedback on tracer quality."""
    ...


@app.get("/api/tracer-feedback/stats")
async def get_tracer_feedback_stats() -> TracerFeedbackStats:
    """Get tracer feedback statistics."""
    ...


@app.get("/api/tracer-feedback/export")
async def export_tracer_feedback_data(
    environment: str | None = None,
) -> dict:
    """Export tracer feedback for ML training."""
    ...
```

**Step 5: Run tests**

```bash
pytest src/backend/tests/test_tracer_feedback_api.py -v
# Expected: PASS
```

**Step 6: Commit**

```bash
git add src/backend/api/routes.py src/backend/api/schemas.py src/backend/tests/test_tracer_feedback_api.py
git commit -m "feat: add tracer feedback API endpoints

- POST /api/tracer-feedback/{job_id} - submit feedback
- GET /api/tracer-feedback/stats - statistics
- GET /api/tracer-feedback/export - ML training export"
```

---

## Task 3: Simplify Frontend Review Flow - Remove Target, Restructure Steps

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Modify: `src/frontend/src/components/PointStatusTracker.tsx`
- Modify: `src/frontend/src/stores/appStore.ts`

**Step 1: Update PointStatusTracker for new 2-step flow**

Old steps: Target → Landing → Apex → Generate
New steps: Landing → Tracer Review

```typescript
// PointStatusTracker.tsx - simplified
const STEPS = [
  { id: 'landing', label: 'Mark Landing', instruction: 'Click where the ball landed' },
  { id: 'review', label: 'Review Tracer', instruction: 'Does the tracer look right?' },
];
```

**Step 2: Update ClipReview for new flow**

Key changes:
1. Remove target point marking
2. Auto-generate tracer immediately after landing marked
3. Show "Does this look right?" prompt
4. Add "Adjust Tracer" button that reveals config panel
5. Add "Tracer still doesn't look right" flow
6. Allow re-marking landing at any time

**Step 3: Test manually in browser**

```bash
npm run dev
# Navigate to review screen
# Verify: Target step is gone
# Verify: Landing → auto-generate → review prompt
```

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx src/frontend/src/components/PointStatusTracker.tsx
git commit -m "refactor: simplify review flow to Landing → Tracer Review

- Remove target point marking (low value)
- Auto-generate tracer after landing marked
- Add 'Does this look right?' prompt"
```

---

## Task 4: Add Tracer Configuration Panel with Generate Button

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Create: `src/frontend/src/components/TracerConfigPanel.tsx`

**Step 1: Create TracerConfigPanel component**

```typescript
// TracerConfigPanel.tsx
interface TracerConfigPanelProps {
  config: TracerConfig;
  onChange: (config: TracerConfig) => void;
  onGenerate: () => void;
  hasChanges: boolean;  // Show hint when true
  onMarkApex: () => void;
  apexMarked: boolean;
}

export function TracerConfigPanel({ ... }: TracerConfigPanelProps) {
  return (
    <div className="tracer-config-panel">
      {/* Shot Height */}
      <div className="config-row">
        <label>Shot height:</label>
        <ToggleGroup value={config.height} onChange={...}>
          <ToggleButton value="low">Low</ToggleButton>
          <ToggleButton value="medium">Medium</ToggleButton>
          <ToggleButton value="high">High</ToggleButton>
        </ToggleGroup>
      </div>

      {/* Shot Shape */}
      <div className="config-row">
        <label>Shot shape:</label>
        <ToggleGroup value={config.shape} onChange={...}>
          <ToggleButton value="hook">Hook</ToggleButton>
          <ToggleButton value="draw">Draw</ToggleButton>
          <ToggleButton value="straight">Straight</ToggleButton>
          <ToggleButton value="fade">Fade</ToggleButton>
          <ToggleButton value="slice">Slice</ToggleButton>
        </ToggleGroup>
      </div>

      {/* Starting Line */}
      <div className="config-row">
        <label>Starting line:</label>
        <ToggleGroup value={config.startingLine} onChange={...}>
          <ToggleButton value="left">Left</ToggleButton>
          <ToggleButton value="center">Center</ToggleButton>
          <ToggleButton value="right">Right</ToggleButton>
        </ToggleGroup>
      </div>

      {/* Flight Time */}
      <div className="config-row">
        <label>Flight time: {config.flightTime}s</label>
        <Slider min={1.0} max={6.0} step={0.5} value={config.flightTime} onChange={...} />
      </div>

      {/* Apex Point */}
      <div className="config-row">
        <label>Apex point:</label>
        <Button onClick={onMarkApex}>
          {apexMarked ? '✓ Marked (click to re-mark)' : 'Click to mark on video'}
        </Button>
      </div>

      {/* Generate Button */}
      <Button variant="primary" onClick={onGenerate}>
        Generate
      </Button>

      {/* Hint when changes pending */}
      {hasChanges && (
        <p className="config-hint">Click Generate to see updated tracer</p>
      )}
    </div>
  );
}
```

**Step 2: Integrate into ClipReview**

**Step 3: Test manually**

**Step 4: Commit**

```bash
git add src/frontend/src/components/TracerConfigPanel.tsx src/frontend/src/components/ClipReview.tsx
git commit -m "feat: add TracerConfigPanel with Generate button

- All config options in collapsible panel
- Show hint when changes made but not generated
- Apex marking integrated into panel"
```

---

## Task 5: Add "Tracer Still Doesn't Look Right" Flow

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Create: `src/frontend/src/components/TracerFeedbackModal.tsx`

**Step 1: Create TracerFeedbackModal component**

```typescript
// TracerFeedbackModal.tsx
interface TracerFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasTriedAllInputs: boolean;
  missingInputs: string[];  // e.g., ["apex point", "shot shape"]
  onAcceptAnyway: () => void;
  onSkipShot: () => void;
  onAcceptNoTracer: () => void;
}

export function TracerFeedbackModal({ ... }: TracerFeedbackModalProps) {
  if (!hasTriedAllInputs) {
    return (
      <Modal isOpen={isOpen} onClose={onClose}>
        <h3>Try a few more options</h3>
        <p>You haven't tried all the configuration options yet.</p>
        <ul>
          {missingInputs.map(input => (
            <li key={input}>Try {input}</li>
          ))}
        </ul>
        <Button onClick={onClose}>OK, I'll try that</Button>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3>Thanks for your feedback</h3>
      <p>We'll use this to improve trajectory generation in the future.</p>
      <p>What would you like to do?</p>
      <div className="modal-actions">
        <Button onClick={onAcceptAnyway}>Accept current trajectory</Button>
        <Button onClick={onAcceptNoTracer}>Accept shot without trajectory</Button>
        <Button variant="secondary" onClick={onSkipShot}>Skip this shot</Button>
      </div>
    </Modal>
  );
}
```

**Step 2: Track which inputs user has tried**

```typescript
// In ClipReview.tsx state
const [triedInputs, setTriedInputs] = useState<Set<string>>(new Set());

// When user changes any config, add to set
const handleConfigChange = (key: string, value: any) => {
  setTriedInputs(prev => new Set([...prev, key]));
  setConfig(prev => ({ ...prev, [key]: value }));
};

// Check if all optional inputs tried
const allOptionalInputs = ['height', 'shape', 'startingLine', 'flightTime', 'apex'];
const hasTriedAll = allOptionalInputs.every(input => triedInputs.has(input));
```

**Step 3: Integrate modal into ClipReview**

**Step 4: Test manually**

**Step 5: Commit**

```bash
git add src/frontend/src/components/TracerFeedbackModal.tsx src/frontend/src/components/ClipReview.tsx
git commit -m "feat: add 'Tracer still doesn't look right' flow

- Check if user has tried all config options
- Prompt to try missing options first
- Thank user and offer: accept anyway / no tracer / skip"
```

---

## Task 6: Implement Tracer-less Export Support

**Files:**
- Modify: `src/backend/api/routes.py` - Update export endpoint
- Modify: `src/backend/api/schemas.py` - Add render_tracer flag per shot
- Modify: `src/backend/processing/clips.py` - Support no-tracer export
- Create: `src/backend/tests/test_export_no_tracer.py`

**Step 1: Write failing test**

```python
# src/backend/tests/test_export_no_tracer.py
def test_export_shot_without_tracer(client: TestClient, sample_job_with_shots: str):
    """Test exporting a shot without tracer overlay."""
    response = client.post(
        "/api/export",
        json={
            "job_id": sample_job_with_shots,
            "shots": [
                {"shot_id": 1, "render_tracer": True},
                {"shot_id": 2, "render_tracer": False},  # No tracer
            ],
            "output_dir": "/tmp/test_export",
        },
    )
    assert response.status_code == 200
    # Verify shot 2 was exported without tracer
```

**Step 2: Update schema**

```python
class ExportShotConfig(BaseModel):
    shot_id: int
    render_tracer: bool = True  # Default to rendering tracer
```

**Step 3: Update export logic**

**Step 4: Run tests**

**Step 5: Commit**

```bash
git add src/backend/api/routes.py src/backend/api/schemas.py src/backend/processing/clips.py src/backend/tests/test_export_no_tracer.py
git commit -m "feat: support exporting shots without tracer overlay

- Add render_tracer flag per shot in export request
- Skip tracer rendering when flag is false"
```

---

## Task 7: Frontend Tracer Feedback Submission

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Modify: `src/frontend/src/stores/appStore.ts`

**Step 1: Add feedback submission logic**

```typescript
// In ClipReview.tsx
const submitTracerFeedback = async (
  feedbackType: TracerFeedbackType,
  autoParams: TracerConfig,
  finalParams: TracerConfig | null,
) => {
  try {
    await fetch(`http://127.0.0.1:8420/api/tracer-feedback/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shot_id: currentShot.id,
        feedback_type: feedbackType,
        auto_params: autoParams,
        final_params: finalParams,
        origin_point: currentShot.origin,
        landing_point: landingPoint,
        apex_point: apexPoint,
      }),
    });
  } catch (error) {
    console.error('Failed to submit tracer feedback:', error);
  }
};

// Call on various actions:
// - "Looks good" after auto-generate → tracer_auto_accepted
// - "Next" after configuring → tracer_configured
// - "Accept anyway" from modal → tracer_reluctant_accept
// - "Skip shot" from modal → tracer_skip
// - "Accept without tracer" from modal → tracer_rejected
```

**Step 2: Store auto-generated params for comparison**

```typescript
const [autoGeneratedParams, setAutoGeneratedParams] = useState<TracerConfig | null>(null);

// When auto-generating after landing:
const handleAutoGenerate = async () => {
  const params = await generateTracer(origin, landing);
  setAutoGeneratedParams(params);  // Save for feedback
  setCurrentConfig(params);
};
```

**Step 3: Test manually**

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx src/frontend/src/stores/appStore.ts
git commit -m "feat: submit tracer feedback on user actions

- Track auto-generated params vs final params
- Submit feedback on: accept, configure, reject, skip"
```

---

## Task 8: Re-marking Landing and Apex Points

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Modify: `src/frontend/src/components/TrajectoryEditor.tsx`

**Step 1: Add re-mark functionality**

```typescript
// In ClipReview.tsx
const [isRemarkingLanding, setIsRemarkingLanding] = useState(false);
const [isRemarkingApex, setIsRemarkingApex] = useState(false);

const handleVideoClick = (x: number, y: number) => {
  if (isRemarkingLanding || !landingPoint) {
    setLandingPoint({ x, y });
    setIsRemarkingLanding(false);
    // Trigger auto-generate with new landing
    handleAutoGenerate();
  } else if (isRemarkingApex) {
    setApexPoint({ x, y });
    setIsRemarkingApex(false);
    setHasChanges(true);
  }
};

// UI buttons
<Button onClick={() => setIsRemarkingLanding(true)}>Re-mark landing</Button>
<Button onClick={() => setIsRemarkingApex(true)}>Mark apex</Button>
```

**Step 2: Visual feedback for re-marking mode**

```typescript
// Show cursor change and instruction when in re-mark mode
{isRemarkingLanding && (
  <div className="remark-overlay">Click to mark new landing point</div>
)}
```

**Step 3: Test manually**

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx src/frontend/src/components/TrajectoryEditor.tsx
git commit -m "feat: allow re-marking landing and apex points

- Re-mark landing triggers new auto-generate
- Re-mark apex adds to config changes"
```

---

## Task 9: ML Training Data Export and Delta Analysis

**Files:**
- Create: `src/backend/ml/tracer_analysis.py`
- Create: `src/backend/tests/test_tracer_analysis.py`

**Step 1: Write failing tests**

```python
# src/backend/tests/test_tracer_analysis.py
import pytest
from backend.ml.tracer_analysis import (
    compute_delta,
    analyze_common_adjustments,
    suggest_default_params,
)

def test_compute_delta():
    """Test computing delta between auto and final params."""
    auto = {"height": "medium", "shape": "straight", "flight_time": 3.0}
    final = {"height": "high", "shape": "draw", "flight_time": 4.5}

    delta = compute_delta(auto, final)

    assert delta["height"] == {"from": "medium", "to": "high", "change": "+1"}
    assert delta["shape"] == {"from": "straight", "to": "draw"}
    assert delta["flight_time"] == {"from": 3.0, "to": 4.5, "change": 1.5}


def test_analyze_common_adjustments():
    """Test analyzing patterns in user adjustments."""
    feedback_records = [
        {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
        {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
        {"auto_params": {"height": "medium"}, "final_params": {"height": "low"}},
    ]

    analysis = analyze_common_adjustments(feedback_records)

    # Most common: medium → high (2 out of 3)
    assert analysis["height"]["most_common_change"] == ("medium", "high")
    assert analysis["height"]["change_frequency"] == 2/3


def test_suggest_default_params():
    """Test suggesting better defaults based on feedback."""
    # If users consistently change medium → high, suggest high as default
    feedback_records = [
        {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
        {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
        {"auto_params": {"height": "medium"}, "final_params": {"height": "high"}},
    ]

    suggestions = suggest_default_params(feedback_records)

    assert suggestions["height"] == "high"  # Users prefer high
```

**Step 2: Implement analysis module**

```python
# src/backend/ml/tracer_analysis.py
"""Analyze tracer feedback to improve default parameters."""

HEIGHT_ORDER = ["low", "medium", "high"]
SHAPE_ORDER = ["hook", "draw", "straight", "fade", "slice"]


def compute_delta(auto_params: dict, final_params: dict) -> dict:
    """Compute the difference between auto-generated and user-configured params."""
    delta = {}

    for key in auto_params:
        if key not in final_params:
            continue
        auto_val = auto_params[key]
        final_val = final_params[key]

        if auto_val == final_val:
            continue

        if key == "height":
            change = HEIGHT_ORDER.index(final_val) - HEIGHT_ORDER.index(auto_val)
            delta[key] = {"from": auto_val, "to": final_val, "change": f"{change:+d}"}
        elif key == "flight_time":
            change = final_val - auto_val
            delta[key] = {"from": auto_val, "to": final_val, "change": change}
        else:
            delta[key] = {"from": auto_val, "to": final_val}

    return delta


def analyze_common_adjustments(feedback_records: list[dict]) -> dict:
    """Analyze patterns in how users adjust auto-generated params."""
    ...


def suggest_default_params(feedback_records: list[dict], min_samples: int = 10) -> dict:
    """Suggest better default params based on user feedback patterns."""
    ...
```

**Step 3: Run tests**

**Step 4: Commit**

```bash
git add src/backend/ml/tracer_analysis.py src/backend/tests/test_tracer_analysis.py
git commit -m "feat: add tracer feedback analysis for ML training

- Compute deltas between auto and final params
- Analyze common adjustment patterns
- Suggest improved defaults based on feedback"
```

---

## Task 10: Documentation Update

**Files:**
- Modify: `CLAUDE.md` - Add tracer feedback documentation

**Step 1: Add documentation section**

```markdown
## Tracer Feedback System

The tracer feedback system collects user corrections to auto-generated trajectories for ML improvement.

### Review Flow

1. Video auto-plays, user confirms "Is this a golf shot?"
2. User marks landing point (mandatory)
3. System auto-generates tracer
4. User accepts or configures adjustments
5. Feedback captured for ML training

### Feedback Types

| Type | When | Data |
|------|------|------|
| `tracer_auto_accepted` | User accepts auto-generated | auto_params |
| `tracer_configured` | User adjusts then accepts | auto_params, final_params, delta |
| `tracer_reluctant_accept` | User accepts despite issues | auto_params, final_params |
| `tracer_skip` | User skips shot entirely | auto_params, final_params |
| `tracer_rejected` | User accepts shot without tracer | auto_params, final_params |

### ML Training Data

The key training signal is the **delta** between auto-generated and user-configured params:

```json
{
  "origin": {"x": 0.45, "y": 0.85},
  "landing": {"x": 0.72, "y": 0.65},
  "delta": {
    "height": {"from": "medium", "to": "high", "change": "+1"},
    "flight_time": {"from": 3.0, "to": 4.5, "change": 1.5}
  }
}
```

### Future ML Improvements

1. **Stage 1: Bias correction** - Learn global adjustments (e.g., "always add 0.5s to flight time")
2. **Stage 2: Position-based prediction** - Learn from origin/landing positions
3. **Stage 3: Per-user calibration** - Personalize defaults per user
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add tracer feedback system documentation"
```

---

## ML Strategy: Using Deltas to Improve Trajectory Generation

### What We Collect

For each `tracer_configured` feedback:
```json
{
  "origin": {"x": 0.45, "y": 0.85},
  "landing": {"x": 0.72, "y": 0.65},
  "distance": 0.32,  // computed
  "angle": 42.5,     // computed (degrees from horizontal)
  "auto_params": {
    "height": "medium",
    "shape": "straight",
    "starting_line": "center",
    "flight_time": 3.0
  },
  "final_params": {
    "height": "high",
    "shape": "draw",
    "starting_line": "right",
    "flight_time": 4.5
  }
}
```

### Stage 1: Global Bias Correction (10+ samples)

**Question:** Are our defaults systematically wrong?

**Analysis:**
```python
# Count how often each param is adjusted in each direction
height_changes = Counter([delta["height"]["change"] for delta in deltas if "height" in delta])
# Result: {"+1": 45, "-1": 12, "+2": 8}
# Insight: Users increase height 45+8=53 times, decrease only 12 times
# Action: Change default from "medium" to between "medium" and "high"
```

**Implementation:**
- Track adjustment frequencies per parameter
- If >60% adjustments go one direction, shift default

### Stage 2: Position-Based Prediction (50+ samples)

**Question:** Do origin/landing positions predict what adjustments are needed?

**Features:**
- `landing_distance`: How far ball traveled (normalized)
- `landing_angle`: Angle from origin to landing
- `origin_y`: Vertical position of ball origin (low in frame = closer to camera)

**Model:** Simple decision rules or logistic regression
```python
# Example learned rule:
if landing_distance > 0.5:  # Long shot
    default_height = "high"
    default_flight_time = 4.0
else:  # Short shot
    default_height = "low"
    default_flight_time = 2.0
```

### Stage 3: Pattern Learning (200+ samples)

**Question:** Can we predict the exact params a user will want?

**Approach:** Train a small model to predict each param:
```python
# For each parameter, train classifier:
# Input: origin, landing, distance, angle
# Output: predicted value (low/medium/high for height, etc.)

from sklearn.ensemble import RandomForestClassifier

X = [[r["distance"], r["angle"], r["origin"]["y"]] for r in records]
y = [r["final_params"]["height"] for r in records]

model = RandomForestClassifier(n_estimators=10, max_depth=3)
model.fit(X, y)
```

### Success Metrics

Track over time:
- **Auto-accept rate**: % of tracers accepted without changes (goal: increase)
- **Average adjustments**: Mean number of params changed per shot (goal: decrease)
- **Time to accept**: How long users spend configuring (goal: decrease)

### Rollback Safety

Same as shot detection ML:
- Keep timestamped backups of prediction models
- A/B test new defaults before full rollout
- Manual trigger only (no auto-updates)

---

## Execution Checklist

- [ ] Task 1: Database schema for tracer feedback
- [ ] Task 2: API endpoints for tracer feedback
- [ ] Task 3: Simplify frontend review flow
- [ ] Task 4: Tracer configuration panel
- [ ] Task 5: "Still doesn't look right" flow
- [ ] Task 6: Tracer-less export support
- [ ] Task 7: Frontend feedback submission
- [ ] Task 8: Re-marking points
- [ ] Task 9: ML training data analysis
- [ ] Task 10: Documentation

After all tasks:
- [ ] Run full test suite
- [ ] E2E browser testing
- [ ] Verify feedback collection via API
- [ ] Code review
