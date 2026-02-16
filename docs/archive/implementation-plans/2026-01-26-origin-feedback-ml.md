# Origin Point Feedback ML Plan

## Problem Statement

The auto-detection of ball origin (starting position) uses shaft + clubhead detection, which can fail due to:
- Camera angle variations
- Lighting conditions
- Golfer positioning/stance
- Club type (driver vs iron vs wedge)
- Background complexity

When auto-detection fails, users manually mark the correct origin point. This manual feedback is valuable training data.

## Data Collection Strategy

### What to Capture

When a user marks a manual origin point, save:

```json
{
  "job_id": "...",
  "shot_id": 1,
  "video_path": "...",
  "strike_time": 18.25,
  "frame_width": 1920,
  "frame_height": 1080,

  "auto_origin": {
    "x": 0.52,
    "y": 0.85,
    "confidence": 0.75,
    "method": "shaft+clubhead"
  },

  "manual_origin": {
    "x": 0.48,
    "y": 0.82
  },

  "error": {
    "dx": -0.04,
    "dy": -0.03,
    "distance": 0.05
  },

  "metadata": {
    "detection_warnings": ["low_origin_confidence"],
    "shaft_score": 0.65,
    "clubhead_detected": true
  }
}
```

### Database Schema Addition

```sql
CREATE TABLE origin_feedback (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  shot_id INTEGER NOT NULL,
  video_path TEXT NOT NULL,
  strike_time REAL NOT NULL,
  frame_width INTEGER NOT NULL,
  frame_height INTEGER NOT NULL,

  -- Auto-detection results
  auto_origin_x REAL,
  auto_origin_y REAL,
  auto_confidence REAL,
  auto_method TEXT,
  shaft_score REAL,
  clubhead_detected BOOLEAN,

  -- User correction
  manual_origin_x REAL NOT NULL,
  manual_origin_y REAL NOT NULL,

  -- Computed error
  error_dx REAL,
  error_dy REAL,
  error_distance REAL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

## Analysis Opportunities

### 1. Error Distribution Analysis

Track patterns in detection errors:
- Are errors biased in a particular direction?
- Do errors correlate with confidence scores?
- What's the typical error magnitude when detection "succeeds" vs "fails"?

```python
# Example analysis
SELECT
  AVG(error_dx) as mean_dx,
  AVG(error_dy) as mean_dy,
  AVG(error_distance) as mean_error,
  COUNT(*) as samples
FROM origin_feedback
WHERE auto_confidence > 0.6;  -- "successful" detections
```

### 2. Failure Mode Classification

Categorize why detection fails:
- **Shaft not found**: shaft_score < 0.5
- **Clubhead not found**: clubhead_detected = false
- **Low confidence**: auto_confidence < 0.6
- **Large error**: error_distance > 0.1 despite "success"

### 3. Frame Extraction for Training

Extract impact frames from videos with manual corrections:
```python
def extract_training_frame(video_path, strike_time, manual_origin):
    """Extract frame at strike time with ground-truth origin annotation."""
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, (strike_time - 0.1) * 1000)  # 100ms before
    ret, frame = cap.read()
    return frame, manual_origin
```

## ML Improvement Strategies

### Strategy 1: Error Correction Model

Train a lightweight model to predict corrections to auto-detection:

```
Input: auto_origin, confidence, shaft_score, clubhead_detected
Output: (dx, dy) correction to apply

corrected_origin = auto_origin + model.predict(features)
```

**Pros**: Simple, fast, doesn't require retraining detection
**Cons**: Only works if auto-detection gives reasonable starting point

### Strategy 2: Direct Origin Regression

Train an end-to-end model on impact frames:

```
Input: Impact frame (cropped around golfer)
Output: (x, y) ball position

Model: MobileNetV3 + regression head
Training data: Frames + manual origin annotations
```

**Pros**: Could be more accurate than rule-based detection
**Cons**: Requires significant training data (100+ annotated shots)

### Strategy 3: Confidence Calibration

Use feedback to improve confidence estimation:

```python
# If users frequently correct "high confidence" detections,
# the confidence model is overconfident
def calibrate_confidence(raw_confidence, shaft_score, clubhead_detected):
    # Learn from feedback data
    return adjusted_confidence
```

### Strategy 4: Failure Detection

Train a classifier to predict when auto-detection will fail:

```
Input: Detection features (confidence, scores, warnings)
Output: P(user_will_correct)

If P > 0.5: Show "Mark origin" prompt immediately
```

## Implementation Phases

### Phase 1: Data Collection (Current PR)
- [x] Add manual origin marking UI
- [x] Pass origin to backend
- [ ] Save origin feedback to database
- [ ] Add API endpoint for feedback export

### Phase 2: Analysis Dashboard
- [ ] Export feedback data for analysis
- [ ] Calculate error statistics
- [ ] Identify failure modes
- [ ] Document patterns

### Phase 3: Quick Wins
- [ ] Apply systematic bias correction if found
- [ ] Adjust confidence thresholds based on data
- [ ] Add detection method fallbacks for common failures

### Phase 4: ML Training (if sufficient data)
- [ ] Extract training dataset
- [ ] Train error correction model
- [ ] A/B test against baseline
- [ ] Deploy if improved

## Success Metrics

1. **Correction Rate**: % of shots where user marks manual origin
   - Target: < 10% of shots need manual correction

2. **Auto-Detection Error**: Mean distance between auto and manual origins
   - Target: < 0.05 (5% of frame width)

3. **User Satisfaction**: Qualitative feedback on tracer accuracy

## API Changes Needed

### 1. Save Origin Feedback

When trajectory is generated with manual origin, save feedback:

```python
@router.post("/origin-feedback/{job_id}")
async def save_origin_feedback(
    job_id: str,
    shot_id: int,
    auto_origin: Optional[dict],  # From detection
    manual_origin: dict,          # From user
    detection_metadata: dict      # Scores, warnings, etc.
):
    ...
```

### 2. Export Feedback Data

```python
@router.get("/origin-feedback/export")
async def export_origin_feedback():
    """Export all origin feedback for analysis."""
    return await get_all_origin_feedback()
```

### 3. Statistics Endpoint

```python
@router.get("/origin-feedback/stats")
async def get_origin_stats():
    """Get aggregate statistics on origin detection accuracy."""
    return {
        "total_shots": 150,
        "manual_corrections": 23,
        "correction_rate": 0.153,
        "mean_error_distance": 0.067,
        "confidence_correlation": -0.45  # Higher confidence = lower error
    }
```

## Next Steps

1. Implement Phase 1 data collection in current PR
2. Collect feedback from real usage
3. Analyze patterns after ~50 manual corrections
4. Decide on ML strategy based on data patterns
