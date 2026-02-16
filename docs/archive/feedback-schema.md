# Feedback Service Schema

This document describes the Supabase tables used to collect anonymous feedback for improving shot detection and tracer generation accuracy.

## Purpose

The feedback service collects data to:

1. **Improve shot detection** - Track true/false positive rates to tune audio detection thresholds
2. **Improve tracer generation** - Learn from user corrections to auto-generate better trajectories
3. **Measure quality** - Calculate accuracy metrics for confidence thresholds

## Tables

### shot_feedback

Tracks user feedback on detected golf shots (approve/reject decisions).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key (auto-generated) |
| `created_at` | timestamptz | When feedback was submitted |
| `session_id` | uuid | Anonymous session identifier |
| `video_hash` | text | One-way hash of video file (optional) |
| `shot_index` | int | Which shot in the video (0-indexed) |
| `feedback_type` | text | `TRUE_POSITIVE` or `FALSE_POSITIVE` |
| `confidence` | float | Detection confidence score (0-1) |
| `audio_confidence` | float | Audio-based confidence (0-1) |
| `clip_start` | float | Auto-detected clip start time (seconds) |
| `clip_end` | float | Auto-detected clip end time (seconds) |
| `user_adjusted_start` | float | User's adjusted start time (if changed) |
| `user_adjusted_end` | float | User's adjusted end time (if changed) |

### tracer_feedback

Tracks user modifications to auto-generated ball trajectories.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key (auto-generated) |
| `created_at` | timestamptz | When feedback was submitted |
| `session_id` | uuid | Anonymous session identifier |
| `shot_index` | int | Which shot in the video (0-indexed) |
| `feedback_type` | text | See feedback types below |
| `auto_origin_x` | float | Auto-calculated origin X (0-1) |
| `auto_origin_y` | float | Auto-calculated origin Y (0-1) |
| `auto_landing_x` | float | Auto-calculated landing X (0-1) |
| `auto_landing_y` | float | Auto-calculated landing Y (0-1) |
| `auto_apex_x` | float | Auto-calculated apex X (0-1) |
| `auto_apex_y` | float | Auto-calculated apex Y (0-1) |
| `auto_shape` | text | Auto-detected shot shape |
| `auto_height` | text | Auto-detected shot height |
| `auto_flight_time` | float | Auto-calculated flight time |
| `auto_starting_line` | text | Auto-detected starting line |
| `final_origin_x` | float | Final origin X after user edits |
| `final_origin_y` | float | Final origin Y after user edits |
| `final_landing_x` | float | Final landing X after user edits |
| `final_landing_y` | float | Final landing Y after user edits |
| `final_apex_x` | float | Final apex X after user edits |
| `final_apex_y` | float | Final apex Y after user edits |
| `final_shape` | text | Final shot shape |
| `final_height` | text | Final shot height |
| `final_flight_time` | float | Final flight time |
| `final_starting_line` | text | Final starting line |
| `tracer_style` | jsonb | Tracer visual style settings |

#### Tracer Feedback Types

| Type | Description |
|------|-------------|
| `AUTO_ACCEPTED` | User accepted auto-generated trajectory without changes |
| `CONFIGURED` | User modified the trajectory (compare auto vs final values) |
| `RELUCTANT_ACCEPT` | User accepted but made minor adjustments |
| `SKIP` | User skipped this shot without approving |
| `REJECTED` | User rejected the trajectory entirely |

## SQL Table Definitions

```sql
-- Shot feedback table
CREATE TABLE shot_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  session_id UUID NOT NULL,
  video_hash TEXT,
  shot_index INT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('TRUE_POSITIVE', 'FALSE_POSITIVE')),
  confidence FLOAT,
  audio_confidence FLOAT,
  clip_start FLOAT,
  clip_end FLOAT,
  user_adjusted_start FLOAT,
  user_adjusted_end FLOAT
);

-- Indexes for analysis queries
CREATE INDEX idx_shot_feedback_session ON shot_feedback(session_id);
CREATE INDEX idx_shot_feedback_type ON shot_feedback(feedback_type);
CREATE INDEX idx_shot_feedback_confidence ON shot_feedback(confidence);

-- Tracer feedback table
CREATE TABLE tracer_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  session_id UUID NOT NULL,
  shot_index INT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('AUTO_ACCEPTED', 'CONFIGURED', 'RELUCTANT_ACCEPT', 'SKIP', 'REJECTED')),
  auto_origin_x FLOAT,
  auto_origin_y FLOAT,
  auto_landing_x FLOAT,
  auto_landing_y FLOAT,
  auto_apex_x FLOAT,
  auto_apex_y FLOAT,
  auto_shape TEXT,
  auto_height TEXT,
  auto_flight_time FLOAT,
  auto_starting_line TEXT,
  final_origin_x FLOAT,
  final_origin_y FLOAT,
  final_landing_x FLOAT,
  final_landing_y FLOAT,
  final_apex_x FLOAT,
  final_apex_y FLOAT,
  final_shape TEXT,
  final_height TEXT,
  final_flight_time FLOAT,
  final_starting_line TEXT,
  tracer_style JSONB
);

-- Indexes for analysis queries
CREATE INDEX idx_tracer_feedback_session ON tracer_feedback(session_id);
CREATE INDEX idx_tracer_feedback_type ON tracer_feedback(feedback_type);
```

## Row Level Security (RLS)

For production, enable RLS with these policies:

```sql
-- Enable RLS
ALTER TABLE shot_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracer_feedback ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts (client-side feedback)
CREATE POLICY "Allow anonymous insert" ON shot_feedback
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous insert" ON tracer_feedback
  FOR INSERT WITH CHECK (true);

-- Restrict reads to authenticated users (for analysis)
CREATE POLICY "Authenticated read" ON shot_feedback
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read" ON tracer_feedback
  FOR SELECT USING (auth.role() = 'authenticated');
```

## Privacy Considerations

### Data Collected

- **Session IDs**: Random UUIDs generated per browser session (not persistent)
- **Video hashes**: One-way SHA-256 hash of video content (cannot reconstruct video)
- **Coordinates**: Normalized 0-1 values (no absolute pixel positions)
- **Timing**: Relative timestamps within clips (not wall-clock times)
- **Style settings**: Color, line width, glow settings

### Data NOT Collected

- IP addresses (not stored by application)
- User accounts or identifiers
- Video content or frames
- Audio content
- Device fingerprints
- Geographic location

### GDPR Compliance

- All data is anonymous and cannot be linked to individuals
- No personal data is collected
- Data is used solely for improving the application
- Users can disable feedback by not configuring Supabase env vars

## Usage Examples

### Submitting Shot Feedback

```typescript
import { submitShotFeedback } from './lib/feedback-service'

// User approved a detected shot
await submitShotFeedback({
  shotIndex: 0,
  feedbackType: 'TRUE_POSITIVE',
  confidence: 0.85,
  audioConfidence: 0.78,
  clipStart: 10.5,
  clipEnd: 15.2,
  userAdjustedStart: 10.8, // User trimmed start
  userAdjustedEnd: 15.2,   // End unchanged
})
```

### Submitting Tracer Feedback

```typescript
import { submitTracerFeedback } from './lib/feedback-service'

// User modified the trajectory
await submitTracerFeedback({
  shotIndex: 0,
  feedbackType: 'CONFIGURED',
  autoParams: {
    originX: 0.5,
    originY: 0.85,
    landingX: 0.7,
    landingY: 0.3,
    shape: 'straight',
    height: 'medium',
    flightTime: 3.0,
  },
  finalParams: {
    originX: 0.48,
    originY: 0.88,
    landingX: 0.72,
    landingY: 0.28,
    shape: 'fade',      // User changed shape
    height: 'high',     // User changed height
    flightTime: 3.5,    // User adjusted timing
  },
  tracerStyle: {
    color: '#ff0000',
    lineWidth: 3,
    glowEnabled: true,
    glowColor: '#ff6666',
    glowRadius: 8,
  },
})
```

## Analysis Queries

### Shot Detection Accuracy

```sql
-- Overall true positive rate
SELECT
  COUNT(*) FILTER (WHERE feedback_type = 'TRUE_POSITIVE') AS true_positives,
  COUNT(*) FILTER (WHERE feedback_type = 'FALSE_POSITIVE') AS false_positives,
  COUNT(*) FILTER (WHERE feedback_type = 'TRUE_POSITIVE')::float / COUNT(*) AS accuracy
FROM shot_feedback;

-- Accuracy by confidence threshold
SELECT
  CASE
    WHEN confidence >= 0.8 THEN 'High (0.8+)'
    WHEN confidence >= 0.5 THEN 'Medium (0.5-0.8)'
    ELSE 'Low (<0.5)'
  END AS confidence_band,
  COUNT(*) FILTER (WHERE feedback_type = 'TRUE_POSITIVE')::float / COUNT(*) AS accuracy,
  COUNT(*) AS sample_size
FROM shot_feedback
WHERE confidence IS NOT NULL
GROUP BY 1
ORDER BY 1;
```

### Tracer Acceptance Rate

```sql
-- How often users accept auto-generated trajectories
SELECT
  feedback_type,
  COUNT(*) AS count,
  COUNT(*)::float / SUM(COUNT(*)) OVER () AS percentage
FROM tracer_feedback
GROUP BY feedback_type
ORDER BY count DESC;
```

### Average Correction Magnitude

```sql
-- How much users typically adjust trajectories
SELECT
  AVG(ABS(final_landing_x - auto_landing_x)) AS avg_landing_x_correction,
  AVG(ABS(final_landing_y - auto_landing_y)) AS avg_landing_y_correction,
  AVG(ABS(final_flight_time - auto_flight_time)) AS avg_flight_time_correction
FROM tracer_feedback
WHERE feedback_type = 'CONFIGURED'
  AND auto_landing_x IS NOT NULL
  AND final_landing_x IS NOT NULL;
```
