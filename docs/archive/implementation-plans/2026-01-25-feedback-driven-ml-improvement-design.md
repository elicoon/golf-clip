# Feedback-Driven ML Improvement Design

**Date:** 2026-01-25
**Status:** Approved
**Goal:** Reduce false positives without reducing true positives, measured by decreasing "Skip Shot" responses.

## Overview

Leverage user feedback during shot review to improve detection accuracy through a staged ML pipeline. Users implicitly label shots as true positives (mark landing point + proceed) or false positives (click "Skip Shot"). This feedback trains progressively sophisticated models.

## Feedback Capture

### Implicit Signal During Review

No new UI required. Extract signal from existing user actions in `ClipReview.tsx`:

| User Action | Feedback Type | Meaning |
|-------------|---------------|---------|
| Click "Skip Shot" | `false_positive` | Detection was wrong - not a golf shot |
| Mark landing point + proceed | `true_positive` | Detection was correct - valid golf shot |

### Data Captured Per Feedback

Submitted to `POST /api/feedback/{job_id}`:

```json
{
  "shot_id": 1,
  "feedback_type": "true_positive",
  "confidence_snapshot": 0.72,
  "audio_confidence_snapshot": 0.68,
  "visual_confidence_snapshot": 0.45,
  "detection_features": {
    "peak_height": 0.84,
    "spectral_flatness": 0.31,
    "frequency_centroid": 3420.5,
    "decay_ratio": 0.67,
    "zero_crossing_rate": 0.28,
    "onset_strength": 4.2,
    "prominence": 0.52
  },
  "environment": "prod"
}
```

### Environment Tagging

Feedback records include `environment` field to separate dev testing from production data:

- `prod` - Real user feedback (default)
- `dev` - Development/testing builds

Environment determined at submission time:
1. `GOLFCLIP_ENV=dev` explicitly set → dev
2. `GOLFCLIP_DEBUG=true` → dev
3. Otherwise → prod

## Staged Improvement Pipeline

### Stage 1: Threshold Tuning (10+ samples)

**What it does:** Finds optimal confidence threshold that minimizes FP while preserving TP.

**How it works:**
1. Group feedback by confidence buckets (0.5-0.6, 0.6-0.7, etc.)
2. Calculate FP rate and TP rate per bucket
3. Find threshold where TP retention > 95% and FP is minimized

**Output:**
```
Current threshold: 0.70
Recommended threshold: 0.76

Projected impact:
  FP reduction: 31% → 14% (-55%)
  TP retention: 100% → 98% (-2%)
```

**Applied to:** `GOLFCLIP_CONFIDENCE_THRESHOLD` in config

### Stage 2: Feature Weight Optimization (50+ samples)

**What it does:** Learns optimal weights for the 7 audio detection features.

**How it works:**
1. Extract feature vectors from all feedback samples
2. Train logistic regression: `P(TP) = sigmoid(w · features)`
3. Convert learned coefficients to normalized weights

**Current weights (hand-tuned):**
```python
height_score * 0.20
flatness_score * 0.10
centroid_score * 0.15
prominence_score * 0.15
rise_score * 0.10
decay_score * 0.20
zcr_score * 0.10
```

**Output:** New weight vector based on empirical TP/FP discrimination.

**Applied to:** `~/.golfclip/ml_config.json` (loaded by `audio.py`)

### Stage 3: Confidence Recalibration (200+ samples)

**What it does:** Maps raw confidence scores to calibrated probabilities.

**How it works:**
1. Build isotonic regression: raw_confidence → actual_TP_rate
2. Addresses systematic over/under-confidence at specific score ranges

**Example mapping:**
```
Raw 0.65 → Calibrated 0.52 (often FP in practice)
Raw 0.72 → Calibrated 0.81 (reliably TP in practice)
```

**Applied to:** Post-processing step after confidence calculation

## Manual Trigger Interface

All updates are manually triggered - no automatic model changes.

### View Stats

```bash
python -m backend.ml.feedback_stats

Output:
  Total feedback: 73 samples
    prod: 58 (41 TP, 17 FP)
    dev:  15 (11 TP, 4 FP)

  Current precision: 71.2%

  Available stages:
    ✓ Stage 1: Threshold tuning (10+ samples) - READY
    ✓ Stage 2: Weight optimization (50+ samples) - READY
    ✗ Stage 3: Recalibration (200+ samples) - need 127 more
```

### View Trends

```bash
python -m backend.ml.feedback_stats --trend

Output:
  Weekly FP Rate Trend (prod only):

  Week of 2026-01-06:  34% FP (12/35 shots skipped)
  Week of 2026-01-13:  29% FP (14/48 shots skipped)
  Week of 2026-01-20:  18% FP (9/50 shots skipped)  ← threshold update applied
```

### Analyze (Dry Run)

```bash
python -m backend.ml.analyze --stage 1 --dry-run

# Include dev data
python -m backend.ml.analyze --stage 1 --dry-run --env all
```

### Apply Changes

```bash
python -m backend.ml.analyze --stage 1 --apply

Output:
  Updated GOLFCLIP_CONFIDENCE_THRESHOLD: 0.70 → 0.76
  Saved to: ~/.golfclip/ml_config.json
  Backup: ~/.golfclip/ml_config.backup.2026-01-25T14:30:00.json
```

### Rollback

```bash
python -m backend.ml.rollback

# Or restore specific backup
python -m backend.ml.rollback --file ml_config.backup.2026-01-25T14:30:00.json
```

## Success Metrics

**Primary metric:** FP rate (Skip Shot clicks / total shots reviewed) decreases over time.

**Secondary metrics:**
- TP retention rate (should stay > 95%)
- Precision: TP / (TP + FP)
- Samples collected per week

**Parameter change logging:**

```json
{
  "timestamp": "2026-01-18T14:30:00Z",
  "stage": 1,
  "change": {"confidence_threshold": {"old": 0.70, "new": 0.76}},
  "samples_used": 58,
  "projected_fp_reduction": 0.55,
  "projected_tp_retention": 0.98
}
```

## Implementation Files

### New Files

| File | Purpose |
|------|---------|
| `src/backend/ml/__init__.py` | ML module initialization |
| `src/backend/ml/feedback_stats.py` | Stats and trend CLI command |
| `src/backend/ml/analyze.py` | Analysis and apply CLI command |
| `src/backend/ml/stages.py` | Stage 1/2/3 algorithm implementations |
| `src/backend/ml/config.py` | ML config loading/saving |

### Modified Files

| File | Change |
|------|--------|
| `src/backend/core/database.py` | Add `environment` column to `shot_feedback` (migration v5) |
| `src/backend/models/job.py` | Update `create_feedback()` to accept and store `environment` |
| `src/backend/detection/audio.py` | Load learned weights from ML config if available |
| `src/frontend/src/components/ClipReview.tsx` | Submit feedback on Skip Shot / Next actions |

## Database Schema Change

```sql
-- Migration v5
ALTER TABLE shot_feedback ADD COLUMN environment TEXT DEFAULT 'prod';
CREATE INDEX idx_shot_feedback_environment ON shot_feedback(environment);
```

## Config File Format

`~/.golfclip/ml_config.json`:

```json
{
  "version": 1,
  "confidence_threshold": 0.76,
  "feature_weights": {
    "height": 0.20,
    "flatness": 0.10,
    "centroid": 0.15,
    "prominence": 0.15,
    "rise": 0.10,
    "decay": 0.20,
    "zcr": 0.10
  },
  "calibration_model": null,
  "updated_at": "2026-01-18T14:30:00Z",
  "update_history": [
    {
      "timestamp": "2026-01-18T14:30:00Z",
      "stage": 1,
      "samples_used": 58
    }
  ]
}
```

## Non-Goals

- Real-time parameter updates (too risky)
- Per-user personalization (adds complexity)
- Automatic threshold adjustment (want manual control)
- A/B testing infrastructure (out of scope)
