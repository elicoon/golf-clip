# Feedback-Driven ML Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture implicit user feedback during shot review to train ML models that reduce false positives.

**Architecture:** Add `environment` column to feedback table, modify frontend to submit feedback on Skip/Next actions, create CLI tools for staged ML analysis (threshold tuning → weight optimization → recalibration).

**Tech Stack:** Python 3.11, FastAPI, SQLite, scikit-learn (LogisticRegression, IsotonicRegression), React/TypeScript

---

## Task 1: Add Environment Column to Database Schema

**Files:**
- Modify: `src/backend/core/database.py:16` (SCHEMA_VERSION)
- Modify: `src/backend/core/database.py:66-75` (_apply_migrations)
- Modify: `src/backend/models/job.py:421-434` (feedback_row_to_dict)
- Modify: `src/backend/models/job.py:437-501` (create_feedback)
- Test: `src/backend/tests/test_feedback.py`

**Step 1: Write the failing test**

Add to `src/backend/tests/test_feedback.py`:

```python
class TestFeedbackEnvironment:
    """Tests for environment tagging in feedback."""

    async def test_feedback_defaults_to_prod(self, test_db, test_job_with_shots):
        """Feedback should default to 'prod' environment."""
        job_id = test_job_with_shots

        response = client.post(
            f"/api/feedback/{job_id}",
            json={"feedback": [{"shot_id": 1, "feedback_type": "true_positive"}]}
        )
        assert response.status_code == 200

        # Get the feedback and check environment
        get_response = client.get(f"/api/feedback/{job_id}")
        assert get_response.status_code == 200
        feedback = get_response.json()
        assert len(feedback) == 1
        assert feedback[0]["environment"] == "prod"

    async def test_feedback_uses_dev_when_debug(self, test_db, test_job_with_shots, monkeypatch):
        """Feedback should use 'dev' environment when debug mode is on."""
        monkeypatch.setattr("backend.core.config.settings.debug", True)

        job_id = test_job_with_shots
        response = client.post(
            f"/api/feedback/{job_id}",
            json={"feedback": [{"shot_id": 1, "feedback_type": "false_positive"}]}
        )
        assert response.status_code == 200

        get_response = client.get(f"/api/feedback/{job_id}")
        feedback = get_response.json()
        assert feedback[0]["environment"] == "dev"
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_feedback.py::TestFeedbackEnvironment -v`
Expected: FAIL - "environment" key not in response

**Step 3: Update schema version and add migration**

In `src/backend/core/database.py`, change line 16:

```python
SCHEMA_VERSION = 5
```

Add migration call in `_apply_migrations` after line 75:

```python
    if current_version < 5:
        await _migrate_v5()
```

Add new migration function after `_migrate_v4`:

```python
async def _migrate_v5() -> None:
    """Add environment column to shot_feedback for dev/prod tagging."""
    logger.info("Applying migration v5: Add environment column to shot_feedback")

    await _db_connection.execute(
        "ALTER TABLE shot_feedback ADD COLUMN environment TEXT DEFAULT 'prod'"
    )
    await _db_connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_feedback_environment ON shot_feedback(environment)"
    )

    await _db_connection.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
        (5, datetime.utcnow().isoformat(), "Add environment column to shot_feedback"),
    )

    logger.info("Migration v5 applied successfully")
```

**Step 4: Update feedback_row_to_dict**

In `src/backend/models/job.py`, update `feedback_row_to_dict` (around line 421):

```python
def feedback_row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert a database row to a feedback dictionary."""
    return {
        "id": row["id"],
        "job_id": row["job_id"],
        "shot_id": row["shot_id"],
        "feedback_type": row["feedback_type"],
        "notes": row["notes"],
        "confidence_snapshot": row["confidence_snapshot"],
        "audio_confidence_snapshot": row["audio_confidence_snapshot"],
        "visual_confidence_snapshot": row["visual_confidence_snapshot"],
        "detection_features": deserialize_json(row["detection_features_json"]),
        "created_at": row["created_at"],
        "environment": row["environment"],
    }
```

**Step 5: Update create_feedback to accept and store environment**

In `src/backend/models/job.py`, update `create_feedback` signature and body:

```python
async def create_feedback(
    job_id: str,
    shot_id: int,
    feedback_type: str,
    notes: Optional[str] = None,
    confidence_snapshot: Optional[float] = None,
    audio_confidence_snapshot: Optional[float] = None,
    visual_confidence_snapshot: Optional[float] = None,
    detection_features: Optional[dict] = None,
    environment: str = "prod",
) -> dict[str, Any]:
    """Create a feedback record for a shot.

    Args:
        job_id: The job ID the shot belongs to.
        shot_id: The shot number being rated.
        feedback_type: Either 'true_positive' or 'false_positive'.
        notes: Optional user notes about the feedback.
        confidence_snapshot: The shot's confidence at feedback time.
        audio_confidence_snapshot: Audio confidence at feedback time.
        visual_confidence_snapshot: Visual confidence at feedback time.
        detection_features: Full detection feature dict for ML training.
        environment: 'prod' or 'dev' - source environment.

    Returns:
        The created feedback record as a dictionary.
    """
    db = await get_db()
    created_at = datetime.utcnow().isoformat()

    cursor = await db.execute(
        """
        INSERT INTO shot_feedback (
            job_id, shot_id, feedback_type, notes,
            confidence_snapshot, audio_confidence_snapshot,
            visual_confidence_snapshot, detection_features_json, created_at,
            environment
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            job_id,
            shot_id,
            feedback_type,
            notes,
            confidence_snapshot,
            audio_confidence_snapshot,
            visual_confidence_snapshot,
            serialize_json(detection_features),
            created_at,
            environment,
        ),
    )
    await db.commit()

    feedback_id = cursor.lastrowid
    logger.debug(f"Created feedback {feedback_id} for job {job_id}, shot {shot_id}: {feedback_type} ({environment})")

    return {
        "id": feedback_id,
        "job_id": job_id,
        "shot_id": shot_id,
        "feedback_type": feedback_type,
        "notes": notes,
        "confidence_snapshot": confidence_snapshot,
        "audio_confidence_snapshot": audio_confidence_snapshot,
        "visual_confidence_snapshot": visual_confidence_snapshot,
        "detection_features": detection_features,
        "created_at": created_at,
        "environment": environment,
    }
```

**Step 6: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_feedback.py -v`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/backend/core/database.py src/backend/models/job.py src/backend/tests/test_feedback.py
git commit -m "feat(db): add environment column to shot_feedback for dev/prod tagging"
```

---

## Task 2: Add Environment Helper and Update API

**Files:**
- Create: `src/backend/core/environment.py`
- Modify: `src/backend/api/schemas.py:236-247` (ShotFeedbackResponse)
- Modify: `src/backend/api/routes.py:1151-1172` (submit_feedback)
- Test: `src/backend/tests/test_feedback.py`

**Step 1: Create environment detection helper**

Create `src/backend/core/environment.py`:

```python
"""Environment detection for feedback tagging."""

import os

from backend.core.config import settings


def get_environment() -> str:
    """Determine if running in dev or prod environment.

    Returns:
        'dev' if any dev indicator is present, 'prod' otherwise.
    """
    # Explicit environment override
    if os.getenv("GOLFCLIP_ENV") == "dev":
        return "dev"

    # Debug mode indicates development
    if settings.debug:
        return "dev"

    return "prod"
```

**Step 2: Update ShotFeedbackResponse schema**

In `src/backend/api/schemas.py`, update `ShotFeedbackResponse` (around line 236):

```python
class ShotFeedbackResponse(BaseModel):
    """Response for a single feedback record."""

    id: int
    job_id: str
    shot_id: int
    feedback_type: str
    notes: Optional[str]
    confidence_snapshot: Optional[float]
    audio_confidence_snapshot: Optional[float]
    visual_confidence_snapshot: Optional[float]
    created_at: str
    environment: str = Field("prod", description="Environment: 'prod' or 'dev'")
```

**Step 3: Update submit_feedback to use environment**

In `src/backend/api/routes.py`, add import at top (around line 41):

```python
from backend.core.environment import get_environment
```

Update `submit_feedback` function (around line 1151) to pass environment:

```python
        # Snapshot detection features at feedback time
        feedback_record = await create_feedback(
            job_id=job_id,
            shot_id=item.shot_id,
            feedback_type=item.feedback_type.value,
            notes=item.notes,
            confidence_snapshot=shot.get("confidence"),
            audio_confidence_snapshot=shot.get("audio_confidence"),
            visual_confidence_snapshot=shot.get("visual_confidence"),
            detection_features=shot.get("confidence_reasons"),
            environment=get_environment(),
        )

        created_feedback.append(ShotFeedbackResponse(
            id=feedback_record["id"],
            job_id=feedback_record["job_id"],
            shot_id=feedback_record["shot_id"],
            feedback_type=feedback_record["feedback_type"],
            notes=feedback_record["notes"],
            confidence_snapshot=feedback_record["confidence_snapshot"],
            audio_confidence_snapshot=feedback_record["audio_confidence_snapshot"],
            visual_confidence_snapshot=feedback_record["visual_confidence_snapshot"],
            created_at=feedback_record["created_at"],
            environment=feedback_record["environment"],
        ))
```

Also update `get_job_feedback` response (around line 1187):

```python
    return [
        ShotFeedbackResponse(
            id=record["id"],
            job_id=record["job_id"],
            shot_id=record["shot_id"],
            feedback_type=record["feedback_type"],
            notes=record["notes"],
            confidence_snapshot=record["confidence_snapshot"],
            audio_confidence_snapshot=record["audio_confidence_snapshot"],
            visual_confidence_snapshot=record["visual_confidence_snapshot"],
            created_at=record["created_at"],
            environment=record["environment"],
        )
        for record in feedback_records
    ]
```

**Step 4: Run tests**

Run: `cd src/backend && pytest tests/test_feedback.py -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/core/environment.py src/backend/api/schemas.py src/backend/api/routes.py
git commit -m "feat(api): use environment helper for feedback tagging"
```

---

## Task 3: Add Implicit Feedback Submission in Frontend

**Files:**
- Modify: `src/frontend/src/components/ClipReview.tsx:379-391` (handleReject)
- Modify: `src/frontend/src/components/ClipReview.tsx:330-377` (handleAccept area)

**Step 1: Add feedback submission to handleReject (Skip Shot)**

In `src/frontend/src/components/ClipReview.tsx`, update `handleReject` (around line 379):

```typescript
  const handleReject = async () => {
    if (!currentShot || loadingState === 'loading') return

    // Submit false positive feedback
    try {
      await fetch(`http://127.0.0.1:8420/api/feedback/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: [{
            shot_id: currentShot.id,
            feedback_type: 'false_positive',
          }]
        }),
      })
    } catch (error) {
      // Don't block the UI on feedback errors - just log
      console.error('Failed to submit feedback:', error)
    }

    // Skip this shot (don't include in export)
    updateShot(currentShot.id, { confidence: 0 })

    if (currentShotIndex < shotsNeedingReview.length - 1) {
      setCurrentShotIndex(currentShotIndex + 1)
    } else {
      await exportClips()
    }
  }
```

**Step 2: Add feedback submission when user proceeds (after marking landing point)**

Find the function that handles "Next" after trajectory generation (likely in the trajectory generation complete handler). Add true positive feedback submission there.

In the trajectory generation success handler or Next button handler, add:

```typescript
  // Submit true positive feedback when user proceeds with the shot
  const submitTruePositiveFeedback = async () => {
    if (!currentShot) return

    try {
      await fetch(`http://127.0.0.1:8420/api/feedback/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback: [{
            shot_id: currentShot.id,
            feedback_type: 'true_positive',
          }]
        }),
      })
    } catch (error) {
      console.error('Failed to submit feedback:', error)
    }
  }
```

Call `submitTruePositiveFeedback()` in `handleAccept` before/after the existing logic.

**Step 3: Test manually**

1. Start backend: `uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload`
2. Start frontend: `cd src/frontend && npm run dev`
3. Upload a video, go to review
4. Click "Skip Shot" - check backend logs for feedback submission
5. Mark landing point and proceed - check backend logs for feedback submission
6. Verify: `curl http://127.0.0.1:8420/api/feedback/stats`

**Step 4: Commit**

```bash
git add src/frontend/src/components/ClipReview.tsx
git commit -m "feat(ui): submit implicit feedback on Skip/Next actions"
```

---

## Task 4: Create ML Module Structure

**Files:**
- Create: `src/backend/ml/__init__.py`
- Create: `src/backend/ml/config.py`
- Test: `src/backend/tests/test_ml_config.py`

**Step 1: Write the failing test**

Create `src/backend/tests/test_ml_config.py`:

```python
"""Tests for ML config loading and saving."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest


class TestMLConfig:
    """Tests for ML configuration management."""

    def test_load_default_config(self, tmp_path):
        """Should return defaults when no config file exists."""
        with patch("backend.ml.config.ML_CONFIG_PATH", tmp_path / "ml_config.json"):
            from backend.ml.config import load_ml_config

            config = load_ml_config()

            assert config["confidence_threshold"] == 0.70
            assert "feature_weights" in config
            assert config["calibration_model"] is None

    def test_save_and_load_config(self, tmp_path):
        """Should persist config to disk and load it back."""
        config_path = tmp_path / "ml_config.json"

        with patch("backend.ml.config.ML_CONFIG_PATH", config_path):
            from backend.ml.config import load_ml_config, save_ml_config

            # Modify and save
            config = load_ml_config()
            config["confidence_threshold"] = 0.85
            save_ml_config(config)

            # Load fresh
            loaded = load_ml_config()
            assert loaded["confidence_threshold"] == 0.85

    def test_save_creates_backup(self, tmp_path):
        """Saving should create a timestamped backup of existing config."""
        config_path = tmp_path / "ml_config.json"

        with patch("backend.ml.config.ML_CONFIG_PATH", config_path):
            from backend.ml.config import load_ml_config, save_ml_config

            # Save initial config
            config = load_ml_config()
            save_ml_config(config)

            # Save again - should create backup
            config["confidence_threshold"] = 0.90
            save_ml_config(config)

            # Check backup exists
            backups = list(tmp_path.glob("ml_config.backup.*.json"))
            assert len(backups) >= 1
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_ml_config.py -v`
Expected: FAIL - module 'backend.ml' not found

**Step 3: Create ML module**

Create `src/backend/ml/__init__.py`:

```python
"""ML module for feedback-driven model improvement."""
```

Create `src/backend/ml/config.py`:

```python
"""ML configuration loading and saving."""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from loguru import logger

# Config file location
ML_CONFIG_PATH = Path.home() / ".golfclip" / "ml_config.json"

# Default configuration
DEFAULT_CONFIG = {
    "version": 1,
    "confidence_threshold": 0.70,
    "feature_weights": {
        "height": 0.20,
        "flatness": 0.10,
        "centroid": 0.15,
        "prominence": 0.15,
        "rise": 0.10,
        "decay": 0.20,
        "zcr": 0.10,
    },
    "calibration_model": None,
    "updated_at": None,
    "update_history": [],
}


def load_ml_config() -> dict[str, Any]:
    """Load ML configuration from disk, or return defaults.

    Returns:
        Configuration dictionary.
    """
    if ML_CONFIG_PATH.exists():
        try:
            with open(ML_CONFIG_PATH) as f:
                config = json.load(f)
                logger.debug(f"Loaded ML config from {ML_CONFIG_PATH}")
                return config
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Failed to load ML config: {e}, using defaults")

    return DEFAULT_CONFIG.copy()


def save_ml_config(config: dict[str, Any]) -> None:
    """Save ML configuration to disk, creating backup of existing.

    Args:
        config: Configuration dictionary to save.
    """
    ML_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Create backup if file exists
    if ML_CONFIG_PATH.exists():
        timestamp = datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%S")
        backup_path = ML_CONFIG_PATH.parent / f"ml_config.backup.{timestamp}.json"
        ML_CONFIG_PATH.rename(backup_path)
        logger.info(f"Created backup: {backup_path}")

    # Update timestamp
    config["updated_at"] = datetime.utcnow().isoformat()

    # Save
    with open(ML_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

    logger.info(f"Saved ML config to {ML_CONFIG_PATH}")


def get_backup_files() -> list[Path]:
    """Get list of backup config files, sorted by date (newest first).

    Returns:
        List of backup file paths.
    """
    if not ML_CONFIG_PATH.parent.exists():
        return []

    backups = list(ML_CONFIG_PATH.parent.glob("ml_config.backup.*.json"))
    return sorted(backups, reverse=True)


def restore_backup(backup_path: Path) -> dict[str, Any]:
    """Restore configuration from a backup file.

    Args:
        backup_path: Path to backup file.

    Returns:
        Restored configuration dictionary.
    """
    with open(backup_path) as f:
        config = json.load(f)

    save_ml_config(config)
    logger.info(f"Restored config from {backup_path}")

    return config
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_ml_config.py -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/ml/ src/backend/tests/test_ml_config.py
git commit -m "feat(ml): add ML config loading and saving with backup support"
```

---

## Task 5: Create Feedback Stats CLI

**Files:**
- Create: `src/backend/ml/feedback_stats.py`
- Test: `src/backend/tests/test_ml_feedback_stats.py`

**Step 1: Write the failing test**

Create `src/backend/tests/test_ml_feedback_stats.py`:

```python
"""Tests for feedback stats CLI."""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock

import pytest

from backend.ml.feedback_stats import (
    get_feedback_summary,
    get_available_stages,
    get_weekly_trend,
)


class TestFeedbackSummary:
    """Tests for feedback summary."""

    @pytest.mark.asyncio
    async def test_summary_with_data(self):
        """Should return correct counts and breakdown."""
        mock_feedback = [
            {"feedback_type": "true_positive", "environment": "prod"},
            {"feedback_type": "true_positive", "environment": "prod"},
            {"feedback_type": "false_positive", "environment": "prod"},
            {"feedback_type": "true_positive", "environment": "dev"},
        ]

        with patch("backend.ml.feedback_stats.get_all_feedback", new_callable=AsyncMock) as mock:
            mock.return_value = mock_feedback
            summary = await get_feedback_summary()

        assert summary["total"] == 4
        assert summary["prod"]["total"] == 3
        assert summary["prod"]["tp"] == 2
        assert summary["prod"]["fp"] == 1
        assert summary["dev"]["total"] == 1

    @pytest.mark.asyncio
    async def test_summary_empty(self):
        """Should handle no feedback gracefully."""
        with patch("backend.ml.feedback_stats.get_all_feedback", new_callable=AsyncMock) as mock:
            mock.return_value = []
            summary = await get_feedback_summary()

        assert summary["total"] == 0
        assert summary["prod"]["total"] == 0


class TestAvailableStages:
    """Tests for stage availability."""

    def test_no_stages_with_few_samples(self):
        """Should show no stages available with < 10 samples."""
        summary = {"prod": {"total": 5, "tp": 3, "fp": 2}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is False
        assert stages["stage_2"]["available"] is False
        assert stages["stage_3"]["available"] is False

    def test_stage_1_available(self):
        """Should show stage 1 available with >= 10 samples."""
        summary = {"prod": {"total": 15, "tp": 10, "fp": 5}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is False

    def test_stage_2_available(self):
        """Should show stage 2 available with >= 50 samples."""
        summary = {"prod": {"total": 60, "tp": 45, "fp": 15}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is True
        assert stages["stage_3"]["available"] is False

    def test_stage_3_available(self):
        """Should show stage 3 available with >= 200 samples."""
        summary = {"prod": {"total": 250, "tp": 200, "fp": 50}}
        stages = get_available_stages(summary)

        assert stages["stage_1"]["available"] is True
        assert stages["stage_2"]["available"] is True
        assert stages["stage_3"]["available"] is True
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_ml_feedback_stats.py -v`
Expected: FAIL - cannot import from backend.ml.feedback_stats

**Step 3: Create feedback_stats module**

Create `src/backend/ml/feedback_stats.py`:

```python
"""Feedback statistics and trend analysis."""

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from backend.models.job import get_all_feedback


async def get_feedback_summary(env_filter: str = "all") -> dict[str, Any]:
    """Get summary of all feedback, optionally filtered by environment.

    Args:
        env_filter: 'prod', 'dev', or 'all'

    Returns:
        Summary dictionary with counts by environment.
    """
    all_feedback = await get_all_feedback(limit=10000)

    # Filter if needed
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    # Count by environment
    summary = {
        "total": len(all_feedback),
        "prod": {"total": 0, "tp": 0, "fp": 0},
        "dev": {"total": 0, "tp": 0, "fp": 0},
    }

    for f in all_feedback:
        env = f.get("environment", "prod")
        if env not in summary:
            summary[env] = {"total": 0, "tp": 0, "fp": 0}

        summary[env]["total"] += 1
        if f["feedback_type"] == "true_positive":
            summary[env]["tp"] += 1
        else:
            summary[env]["fp"] += 1

    return summary


def get_available_stages(summary: dict[str, Any]) -> dict[str, Any]:
    """Determine which ML stages are available based on sample count.

    Args:
        summary: Feedback summary from get_feedback_summary().

    Returns:
        Dictionary with stage availability and requirements.
    """
    prod_count = summary.get("prod", {}).get("total", 0)

    return {
        "stage_1": {
            "name": "Threshold Tuning",
            "min_samples": 10,
            "available": prod_count >= 10,
            "samples_needed": max(0, 10 - prod_count),
        },
        "stage_2": {
            "name": "Weight Optimization",
            "min_samples": 50,
            "available": prod_count >= 50,
            "samples_needed": max(0, 50 - prod_count),
        },
        "stage_3": {
            "name": "Confidence Recalibration",
            "min_samples": 200,
            "available": prod_count >= 200,
            "samples_needed": max(0, 200 - prod_count),
        },
    }


async def get_weekly_trend(weeks: int = 4, env_filter: str = "prod") -> list[dict[str, Any]]:
    """Get weekly FP rate trend.

    Args:
        weeks: Number of weeks to include.
        env_filter: Environment to filter by.

    Returns:
        List of weekly stats, oldest first.
    """
    all_feedback = await get_all_feedback(limit=10000)

    # Filter by environment
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    # Group by week
    weekly = defaultdict(lambda: {"tp": 0, "fp": 0})
    now = datetime.utcnow()

    for f in all_feedback:
        created = datetime.fromisoformat(f["created_at"].replace("Z", "+00:00").replace("+00:00", ""))
        days_ago = (now - created).days
        week_num = days_ago // 7

        if week_num < weeks:
            if f["feedback_type"] == "true_positive":
                weekly[week_num]["tp"] += 1
            else:
                weekly[week_num]["fp"] += 1

    # Build trend list
    trend = []
    for week_num in range(weeks - 1, -1, -1):
        data = weekly[week_num]
        total = data["tp"] + data["fp"]
        fp_rate = data["fp"] / total if total > 0 else 0

        week_start = now - timedelta(days=(week_num + 1) * 7)

        trend.append({
            "week_of": week_start.strftime("%Y-%m-%d"),
            "total": total,
            "tp": data["tp"],
            "fp": data["fp"],
            "fp_rate": round(fp_rate, 3),
        })

    return trend


def print_stats(summary: dict, stages: dict, trend: list | None = None) -> None:
    """Print formatted stats to console.

    Args:
        summary: Feedback summary.
        stages: Available stages.
        trend: Optional weekly trend data.
    """
    print(f"\nTotal feedback: {summary['total']} samples")

    for env in ["prod", "dev"]:
        data = summary.get(env, {"total": 0, "tp": 0, "fp": 0})
        if data["total"] > 0:
            precision = data["tp"] / data["total"]
            print(f"  {env}: {data['total']} ({data['tp']} TP, {data['fp']} FP) - precision {precision:.1%}")

    print("\nAvailable stages:")
    for stage_id, stage in stages.items():
        if stage["available"]:
            print(f"  ✓ {stage_id}: {stage['name']} ({stage['min_samples']}+ samples) - READY")
        else:
            print(f"  ✗ {stage_id}: {stage['name']} ({stage['min_samples']}+ samples) - need {stage['samples_needed']} more")

    if trend:
        print("\nWeekly FP Rate Trend (prod only):")
        for week in trend:
            if week["total"] > 0:
                print(f"  Week of {week['week_of']}: {week['fp_rate']:.0%} FP ({week['fp']}/{week['total']} shots skipped)")
            else:
                print(f"  Week of {week['week_of']}: no data")


async def main(show_trend: bool = False, env_filter: str = "prod") -> None:
    """Main entry point for CLI."""
    from backend.core.database import init_db

    await init_db()

    summary = await get_feedback_summary()
    stages = get_available_stages(summary)

    trend = None
    if show_trend:
        trend = await get_weekly_trend(env_filter=env_filter)

    print_stats(summary, stages, trend)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="View feedback statistics")
    parser.add_argument("--trend", action="store_true", help="Show weekly FP rate trend")
    parser.add_argument("--env", choices=["prod", "dev", "all"], default="prod", help="Environment filter")

    args = parser.parse_args()

    asyncio.run(main(show_trend=args.trend, env_filter=args.env))
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_ml_feedback_stats.py -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/ml/feedback_stats.py src/backend/tests/test_ml_feedback_stats.py
git commit -m "feat(ml): add feedback stats CLI with trend analysis"
```

---

## Task 6: Implement Stage 1 - Threshold Tuning

**Files:**
- Create: `src/backend/ml/stages.py`
- Test: `src/backend/tests/test_ml_stages.py`

**Step 1: Write the failing test**

Create `src/backend/tests/test_ml_stages.py`:

```python
"""Tests for ML stage implementations."""

import pytest

from backend.ml.stages import analyze_threshold


class TestThresholdTuning:
    """Tests for Stage 1: Threshold tuning."""

    def test_finds_optimal_threshold(self):
        """Should find threshold that reduces FP while keeping TP."""
        # Simulate feedback with confidence scores
        feedback = [
            # True positives at high confidence
            {"feedback_type": "true_positive", "confidence_snapshot": 0.85},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.82},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.78},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.75},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.72},
            # False positives at lower confidence
            {"feedback_type": "false_positive", "confidence_snapshot": 0.71},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.68},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.65},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.62},
        ]

        result = analyze_threshold(feedback, current_threshold=0.60)

        # Should recommend higher threshold to filter FPs
        assert result["recommended_threshold"] > 0.70
        assert result["projected_fp_rate"] < result["current_fp_rate"]
        assert result["projected_tp_retention"] >= 0.80  # Keep most TPs

    def test_handles_empty_feedback(self):
        """Should handle empty feedback gracefully."""
        result = analyze_threshold([], current_threshold=0.70)

        assert result["recommended_threshold"] == 0.70
        assert result["samples_analyzed"] == 0

    def test_handles_all_tp(self):
        """Should keep threshold low when all are true positives."""
        feedback = [
            {"feedback_type": "true_positive", "confidence_snapshot": 0.75},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.72},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.68},
        ]

        result = analyze_threshold(feedback, current_threshold=0.70)

        # No FPs to filter, don't raise threshold unnecessarily
        assert result["recommended_threshold"] <= 0.70
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestThresholdTuning -v`
Expected: FAIL - cannot import analyze_threshold

**Step 3: Implement threshold analysis**

Create `src/backend/ml/stages.py`:

```python
"""ML stage implementations for feedback-driven improvement."""

from typing import Any

import numpy as np
from loguru import logger


def analyze_threshold(
    feedback: list[dict[str, Any]],
    current_threshold: float = 0.70,
    target_tp_retention: float = 0.95,
) -> dict[str, Any]:
    """Stage 1: Analyze feedback to find optimal confidence threshold.

    Args:
        feedback: List of feedback records with confidence_snapshot.
        current_threshold: Current confidence threshold.
        target_tp_retention: Minimum TP retention rate to maintain.

    Returns:
        Analysis results with recommended threshold.
    """
    if not feedback:
        return {
            "samples_analyzed": 0,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Extract confidence scores by type
    tp_scores = [
        f["confidence_snapshot"]
        for f in feedback
        if f["feedback_type"] == "true_positive" and f.get("confidence_snapshot") is not None
    ]
    fp_scores = [
        f["confidence_snapshot"]
        for f in feedback
        if f["feedback_type"] == "false_positive" and f.get("confidence_snapshot") is not None
    ]

    total = len(tp_scores) + len(fp_scores)
    if total == 0:
        return {
            "samples_analyzed": 0,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Current rates (assuming all samples passed current threshold)
    current_fp_rate = len(fp_scores) / total
    current_tp_rate = len(tp_scores) / total

    # If no FPs, keep current threshold
    if len(fp_scores) == 0:
        return {
            "samples_analyzed": total,
            "current_threshold": current_threshold,
            "recommended_threshold": current_threshold,
            "current_fp_rate": 0,
            "current_tp_rate": 1.0,
            "projected_fp_rate": 0,
            "projected_tp_retention": 1.0,
        }

    # Search for optimal threshold
    # Try thresholds from 0.50 to 0.95 in 0.01 increments
    best_threshold = current_threshold
    best_fp_rate = current_fp_rate
    best_tp_retention = 1.0

    for thresh in np.arange(0.50, 0.96, 0.01):
        # Count how many would pass at this threshold
        tp_passing = sum(1 for s in tp_scores if s >= thresh)
        fp_passing = sum(1 for s in fp_scores if s >= thresh)

        # Calculate rates
        tp_retention = tp_passing / len(tp_scores) if tp_scores else 1.0
        new_total = tp_passing + fp_passing
        new_fp_rate = fp_passing / new_total if new_total > 0 else 0

        # Check if this threshold meets our constraints and improves FP rate
        if tp_retention >= target_tp_retention and new_fp_rate < best_fp_rate:
            best_threshold = thresh
            best_fp_rate = new_fp_rate
            best_tp_retention = tp_retention

    return {
        "samples_analyzed": total,
        "current_threshold": current_threshold,
        "recommended_threshold": round(best_threshold, 2),
        "current_fp_rate": round(current_fp_rate, 3),
        "current_tp_rate": round(current_tp_rate, 3),
        "projected_fp_rate": round(best_fp_rate, 3),
        "projected_tp_retention": round(best_tp_retention, 3),
    }
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestThresholdTuning -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/ml/stages.py src/backend/tests/test_ml_stages.py
git commit -m "feat(ml): implement Stage 1 threshold tuning analysis"
```

---

## Task 7: Implement Stage 2 - Feature Weight Optimization

**Files:**
- Modify: `src/backend/ml/stages.py`
- Modify: `src/backend/tests/test_ml_stages.py`

**Step 1: Write the failing test**

Add to `src/backend/tests/test_ml_stages.py`:

```python
from backend.ml.stages import analyze_weights


class TestWeightOptimization:
    """Tests for Stage 2: Feature weight optimization."""

    def test_learns_discriminative_weights(self):
        """Should learn weights that separate TP from FP."""
        # Create feedback where decay_ratio clearly separates TP from FP
        feedback = []

        # True positives have high decay ratio (ball strikes decay fast)
        for _ in range(30):
            feedback.append({
                "feedback_type": "true_positive",
                "detection_features": {
                    "peak_height": 0.7 + np.random.normal(0, 0.1),
                    "decay_ratio": 0.8 + np.random.normal(0, 0.05),  # High decay
                    "spectral_flatness": 0.3 + np.random.normal(0, 0.05),
                    "frequency_centroid": 3500 + np.random.normal(0, 200),
                    "zero_crossing_rate": 0.25 + np.random.normal(0, 0.05),
                }
            })

        # False positives have low decay ratio (sustained sounds)
        for _ in range(20):
            feedback.append({
                "feedback_type": "false_positive",
                "detection_features": {
                    "peak_height": 0.6 + np.random.normal(0, 0.1),
                    "decay_ratio": 0.3 + np.random.normal(0, 0.05),  # Low decay
                    "spectral_flatness": 0.3 + np.random.normal(0, 0.05),
                    "frequency_centroid": 3500 + np.random.normal(0, 200),
                    "zero_crossing_rate": 0.25 + np.random.normal(0, 0.05),
                }
            })

        result = analyze_weights(feedback)

        assert result["samples_analyzed"] == 50
        assert "learned_weights" in result
        # Decay ratio should have higher weight since it's discriminative
        weights = result["learned_weights"]
        assert weights["decay"] > weights["flatness"]  # decay is more important

    def test_handles_insufficient_samples(self):
        """Should return None weights with insufficient samples."""
        feedback = [
            {"feedback_type": "true_positive", "detection_features": {"peak_height": 0.8}},
        ] * 5

        result = analyze_weights(feedback)

        assert result["learned_weights"] is None
        assert "error" in result
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestWeightOptimization -v`
Expected: FAIL - cannot import analyze_weights

**Step 3: Implement weight optimization**

Add to `src/backend/ml/stages.py`:

```python
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


# Feature names in order
FEATURE_NAMES = ["height", "flatness", "centroid", "prominence", "rise", "decay", "zcr"]

# Mapping from detection_features keys to our normalized names
FEATURE_KEY_MAP = {
    "peak_height": "height",
    "spectral_flatness": "flatness",
    "frequency_centroid": "centroid",
    "onset_strength": "prominence",  # Using onset_strength as prominence proxy
    "decay_ratio": "decay",
    "zero_crossing_rate": "zcr",
}


def analyze_weights(
    feedback: list[dict[str, Any]],
    min_samples: int = 50,
) -> dict[str, Any]:
    """Stage 2: Learn optimal feature weights using logistic regression.

    Args:
        feedback: List of feedback records with detection_features.
        min_samples: Minimum samples required for training.

    Returns:
        Analysis results with learned weights.
    """
    # Filter to samples with detection features
    valid_feedback = [
        f for f in feedback
        if f.get("detection_features") and isinstance(f["detection_features"], dict)
    ]

    if len(valid_feedback) < min_samples:
        return {
            "samples_analyzed": len(valid_feedback),
            "learned_weights": None,
            "error": f"Insufficient samples: {len(valid_feedback)} < {min_samples} required",
        }

    # Build feature matrix and labels
    X = []
    y = []

    for f in valid_feedback:
        features = f["detection_features"]

        # Extract features in consistent order
        row = []
        for key, name in FEATURE_KEY_MAP.items():
            value = features.get(key, 0.5)  # Default to 0.5 if missing
            row.append(value)

        X.append(row)
        y.append(1 if f["feedback_type"] == "true_positive" else 0)

    X = np.array(X)
    y = np.array(y)

    # Standardize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Train logistic regression
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_scaled, y)

    # Convert coefficients to weights (normalize to sum to 1)
    coefs = np.abs(model.coef_[0])
    weights = coefs / coefs.sum()

    # Build weight dictionary
    learned_weights = {}
    for i, name in enumerate(FEATURE_KEY_MAP.values()):
        learned_weights[name] = round(float(weights[i]), 3)

    # Calculate model accuracy on training data
    accuracy = model.score(X_scaled, y)

    return {
        "samples_analyzed": len(valid_feedback),
        "learned_weights": learned_weights,
        "model_accuracy": round(accuracy, 3),
        "feature_importances": {
            name: round(float(coefs[i]), 3)
            for i, name in enumerate(FEATURE_KEY_MAP.values())
        },
    }
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestWeightOptimization -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/ml/stages.py src/backend/tests/test_ml_stages.py
git commit -m "feat(ml): implement Stage 2 feature weight optimization"
```

---

## Task 8: Implement Stage 3 - Confidence Recalibration

**Files:**
- Modify: `src/backend/ml/stages.py`
- Modify: `src/backend/tests/test_ml_stages.py`

**Step 1: Write the failing test**

Add to `src/backend/tests/test_ml_stages.py`:

```python
from backend.ml.stages import analyze_calibration


class TestConfidenceRecalibration:
    """Tests for Stage 3: Confidence recalibration."""

    def test_calibrates_overconfident_scores(self):
        """Should reduce confidence when FP rate is high at that level."""
        feedback = []

        # At confidence 0.70-0.75, lots of false positives
        for _ in range(40):
            feedback.append({
                "feedback_type": "false_positive",
                "confidence_snapshot": 0.72,
            })
        for _ in range(10):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.73,
            })

        # At confidence 0.85+, all true positives
        for _ in range(50):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.87,
            })

        # More samples to meet minimum
        for _ in range(100):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.80,
            })

        result = analyze_calibration(feedback)

        assert result["calibration_map"] is not None
        # 0.72 should map to lower calibrated confidence
        assert result["calibration_map"]["0.72"] < 0.72

    def test_handles_insufficient_samples(self):
        """Should return None calibration with insufficient samples."""
        feedback = [
            {"feedback_type": "true_positive", "confidence_snapshot": 0.8}
        ] * 50

        result = analyze_calibration(feedback)

        assert result["calibration_map"] is None
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestConfidenceRecalibration -v`
Expected: FAIL - cannot import analyze_calibration

**Step 3: Implement calibration analysis**

Add to `src/backend/ml/stages.py`:

```python
from sklearn.isotonic import IsotonicRegression


def analyze_calibration(
    feedback: list[dict[str, Any]],
    min_samples: int = 200,
) -> dict[str, Any]:
    """Stage 3: Learn confidence calibration using isotonic regression.

    Maps raw confidence scores to calibrated probabilities based on
    actual TP rate at each confidence level.

    Args:
        feedback: List of feedback records with confidence_snapshot.
        min_samples: Minimum samples required for calibration.

    Returns:
        Analysis results with calibration mapping.
    """
    # Filter to samples with confidence
    valid_feedback = [
        f for f in feedback
        if f.get("confidence_snapshot") is not None
    ]

    if len(valid_feedback) < min_samples:
        return {
            "samples_analyzed": len(valid_feedback),
            "calibration_map": None,
            "error": f"Insufficient samples: {len(valid_feedback)} < {min_samples} required",
        }

    # Build arrays
    confidences = np.array([f["confidence_snapshot"] for f in valid_feedback])
    labels = np.array([1 if f["feedback_type"] == "true_positive" else 0 for f in valid_feedback])

    # Fit isotonic regression
    iso_reg = IsotonicRegression(out_of_bounds="clip")
    iso_reg.fit(confidences, labels)

    # Build calibration map for common confidence values
    calibration_map = {}
    for conf in np.arange(0.50, 0.96, 0.01):
        calibrated = iso_reg.predict([conf])[0]
        calibration_map[f"{conf:.2f}"] = round(float(calibrated), 3)

    # Calculate reliability metrics
    # Bin confidences and compare predicted vs actual
    bins = np.arange(0.5, 1.0, 0.1)
    bin_counts = []
    bin_accuracies = []

    for i in range(len(bins) - 1):
        mask = (confidences >= bins[i]) & (confidences < bins[i + 1])
        if mask.sum() > 0:
            bin_counts.append(int(mask.sum()))
            bin_accuracies.append(float(labels[mask].mean()))
        else:
            bin_counts.append(0)
            bin_accuracies.append(0)

    return {
        "samples_analyzed": len(valid_feedback),
        "calibration_map": calibration_map,
        "bin_counts": bin_counts,
        "bin_accuracies": bin_accuracies,
    }
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && pytest tests/test_ml_stages.py::TestConfidenceRecalibration -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/ml/stages.py src/backend/tests/test_ml_stages.py
git commit -m "feat(ml): implement Stage 3 confidence recalibration"
```

---

## Task 9: Create Analysis CLI

**Files:**
- Create: `src/backend/ml/analyze.py`
- Test: Manual integration testing

**Step 1: Create analyze CLI**

Create `src/backend/ml/analyze.py`:

```python
"""ML analysis and apply CLI."""

import argparse
import asyncio
from typing import Optional

from loguru import logger

from backend.core.database import init_db
from backend.models.job import get_all_feedback
from backend.ml.config import load_ml_config, save_ml_config
from backend.ml.stages import analyze_threshold, analyze_weights, analyze_calibration


async def run_analysis(
    stage: int,
    env_filter: str = "prod",
    dry_run: bool = True,
) -> dict:
    """Run ML analysis for a specific stage.

    Args:
        stage: Stage number (1, 2, or 3).
        env_filter: Environment filter ('prod', 'dev', 'all').
        dry_run: If True, don't apply changes.

    Returns:
        Analysis results.
    """
    await init_db()

    # Get feedback data
    all_feedback = await get_all_feedback(limit=10000)

    # Filter by environment
    if env_filter != "all":
        all_feedback = [f for f in all_feedback if f.get("environment", "prod") == env_filter]

    print(f"\nAnalyzing {len(all_feedback)} feedback samples ({env_filter} environment)")

    config = load_ml_config()

    if stage == 1:
        result = analyze_threshold(all_feedback, current_threshold=config["confidence_threshold"])

        print(f"\n=== Stage 1: Threshold Tuning ===")
        print(f"Samples analyzed: {result['samples_analyzed']}")
        print(f"Current threshold: {result['current_threshold']}")
        print(f"Recommended threshold: {result['recommended_threshold']}")
        print(f"\nProjected impact:")
        print(f"  FP rate: {result['current_fp_rate']:.1%} → {result['projected_fp_rate']:.1%}")
        print(f"  TP retention: {result['projected_tp_retention']:.1%}")

        if not dry_run and result["recommended_threshold"] != config["confidence_threshold"]:
            old_threshold = config["confidence_threshold"]
            config["confidence_threshold"] = result["recommended_threshold"]
            config["update_history"].append({
                "stage": 1,
                "change": {"confidence_threshold": {"old": old_threshold, "new": result["recommended_threshold"]}},
                "samples_used": result["samples_analyzed"],
            })
            save_ml_config(config)
            print(f"\n✓ Applied: confidence_threshold updated to {result['recommended_threshold']}")
        elif dry_run:
            print(f"\nTo apply: python -m backend.ml.analyze --stage 1 --apply")

    elif stage == 2:
        result = analyze_weights(all_feedback)

        print(f"\n=== Stage 2: Weight Optimization ===")
        print(f"Samples analyzed: {result['samples_analyzed']}")

        if result["learned_weights"]:
            print(f"Model accuracy: {result['model_accuracy']:.1%}")
            print(f"\nLearned weights:")
            for name, weight in result["learned_weights"].items():
                current = config["feature_weights"].get(name, "N/A")
                print(f"  {name}: {current} → {weight}")

            if not dry_run:
                old_weights = config["feature_weights"].copy()
                config["feature_weights"] = result["learned_weights"]
                config["update_history"].append({
                    "stage": 2,
                    "change": {"feature_weights": {"old": old_weights, "new": result["learned_weights"]}},
                    "samples_used": result["samples_analyzed"],
                })
                save_ml_config(config)
                print(f"\n✓ Applied: feature_weights updated")
            elif dry_run:
                print(f"\nTo apply: python -m backend.ml.analyze --stage 2 --apply")
        else:
            print(f"Error: {result.get('error', 'Unknown error')}")

    elif stage == 3:
        result = analyze_calibration(all_feedback)

        print(f"\n=== Stage 3: Confidence Recalibration ===")
        print(f"Samples analyzed: {result['samples_analyzed']}")

        if result["calibration_map"]:
            print(f"\nSample calibrations:")
            for conf in ["0.60", "0.70", "0.80", "0.90"]:
                if conf in result["calibration_map"]:
                    print(f"  Raw {conf} → Calibrated {result['calibration_map'][conf]}")

            if not dry_run:
                config["calibration_model"] = result["calibration_map"]
                config["update_history"].append({
                    "stage": 3,
                    "change": {"calibration_model": "updated"},
                    "samples_used": result["samples_analyzed"],
                })
                save_ml_config(config)
                print(f"\n✓ Applied: calibration_model updated")
            elif dry_run:
                print(f"\nTo apply: python -m backend.ml.analyze --stage 3 --apply")
        else:
            print(f"Error: {result.get('error', 'Unknown error')}")

    return result


async def rollback(backup_file: Optional[str] = None) -> None:
    """Rollback to previous configuration.

    Args:
        backup_file: Specific backup file to restore, or None for latest.
    """
    from backend.ml.config import get_backup_files, restore_backup

    backups = get_backup_files()

    if not backups:
        print("No backups found")
        return

    if backup_file:
        from pathlib import Path
        backup_path = Path(backup_file)
        if not backup_path.exists():
            print(f"Backup file not found: {backup_file}")
            return
    else:
        backup_path = backups[0]
        print(f"Restoring latest backup: {backup_path}")

    restore_backup(backup_path)
    print(f"✓ Restored configuration from {backup_path}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="ML analysis and optimization")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Run analysis")
    analyze_parser.add_argument("--stage", type=int, choices=[1, 2, 3], required=True, help="Stage to run")
    analyze_parser.add_argument("--env", choices=["prod", "dev", "all"], default="prod", help="Environment filter")
    analyze_parser.add_argument("--apply", action="store_true", help="Apply changes (default: dry run)")

    # Rollback command
    rollback_parser = subparsers.add_parser("rollback", help="Rollback to previous config")
    rollback_parser.add_argument("--file", type=str, help="Specific backup file to restore")

    args = parser.parse_args()

    if args.command == "analyze":
        asyncio.run(run_analysis(stage=args.stage, env_filter=args.env, dry_run=not args.apply))
    elif args.command == "rollback":
        asyncio.run(rollback(backup_file=args.file))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
```

**Step 2: Test manually**

```bash
# View stats
python -m backend.ml.feedback_stats

# Run stage 1 analysis (dry run)
python -m backend.ml.analyze analyze --stage 1

# Apply stage 1
python -m backend.ml.analyze analyze --stage 1 --apply

# Rollback
python -m backend.ml.analyze rollback
```

**Step 3: Commit**

```bash
git add src/backend/ml/analyze.py
git commit -m "feat(ml): add analysis and apply CLI with rollback support"
```

---

## Task 10: Final Integration and Documentation

**Files:**
- Modify: `CLAUDE.md` (add ML section)

**Step 1: Update CLAUDE.md**

Add section to CLAUDE.md after the Feedback Collection System section:

```markdown
## ML Improvement Pipeline

The feedback collected during review trains ML models to reduce false positives.

### CLI Commands

```bash
# View feedback stats and available stages
python -m backend.ml.feedback_stats
python -m backend.ml.feedback_stats --trend  # Show weekly FP rate trend

# Run analysis (dry run by default)
python -m backend.ml.analyze analyze --stage 1  # Threshold tuning
python -m backend.ml.analyze analyze --stage 2  # Weight optimization
python -m backend.ml.analyze analyze --stage 3  # Confidence recalibration

# Apply changes
python -m backend.ml.analyze analyze --stage 1 --apply

# Rollback to previous config
python -m backend.ml.analyze rollback
```

### Stage Requirements

| Stage | Min Samples | What It Does |
|-------|-------------|--------------|
| 1 | 10 | Finds optimal confidence threshold |
| 2 | 50 | Learns feature weights via logistic regression |
| 3 | 200 | Calibrates confidence scores via isotonic regression |

### Config File

ML parameters are stored in `~/.golfclip/ml_config.json`:

```json
{
  "version": 1,
  "confidence_threshold": 0.76,
  "feature_weights": {"height": 0.20, "decay": 0.25, ...},
  "calibration_model": {"0.70": 0.65, ...},
  "update_history": [...]
}
```
```

**Step 2: Run all tests**

```bash
cd src/backend && pytest tests/test_feedback.py tests/test_ml_config.py tests/test_ml_feedback_stats.py tests/test_ml_stages.py -v
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add ML improvement pipeline documentation to CLAUDE.md"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add environment column to database | database.py, job.py |
| 2 | Add environment helper and update API | environment.py, schemas.py, routes.py |
| 3 | Add implicit feedback in frontend | ClipReview.tsx |
| 4 | Create ML module structure | ml/__init__.py, ml/config.py |
| 5 | Create feedback stats CLI | ml/feedback_stats.py |
| 6 | Implement Stage 1 threshold tuning | ml/stages.py |
| 7 | Implement Stage 2 weight optimization | ml/stages.py |
| 8 | Implement Stage 3 calibration | ml/stages.py |
| 9 | Create analysis CLI | ml/analyze.py |
| 10 | Final integration and docs | CLAUDE.md |
