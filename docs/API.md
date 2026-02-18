# GolfClip API Reference

> **Scope:** This document covers the **Desktop Backend** (`apps/desktop/`) — a Python FastAPI server that runs locally alongside a desktop client. The **browser app** (`apps/browser/`) performs all processing client-side (FFmpeg.js, Essentia.js, WebCodecs) and does not require this backend. These endpoints are preserved as a reference for the server-side detection and ML feedback pipeline.

**Base URL:** `http://localhost:8420/api`

---

## Table of Contents

1. [Processing & Export](#processing--export)
2. [Feedback Collection](#feedback-collection)
3. [Trajectory / Shot Tracer](#trajectory--shot-tracer)
4. [Tracer Feedback](#tracer-feedback)
5. [Origin Feedback](#origin-feedback)

---

## Processing & Export

### Upload Video

Upload a video file for processing.

```
POST /api/upload
```

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` - The video file to upload

**Response:**
```json
{
  "path": "/tmp/golfclip/uploads/video.mp4",
  "filename": "video.mp4",
  "size": 104857600
}
```

---

### Start Processing

Start video processing/detection job.

```
POST /api/process
```

**Request:**
```json
{
  "video_path": "/path/to/video.mp4",
  "output_dir": "/path/to/output"
}
```

**Response:**
```json
{
  "job_id": "abc123",
  "status": "processing",
  "message": "Processing started"
}
```

---

### Get Job Status

Get the current status of a processing job.

```
GET /api/status/{job_id}
```

**Response:**
```json
{
  "job_id": "abc123",
  "status": "completed",
  "progress": 100,
  "shots_detected": 3,
  "created_at": "2026-01-31T10:00:00Z",
  "updated_at": "2026-01-31T10:01:30Z"
}
```

**Status values:**
- `pending` - Job created, not yet started
- `processing` - Currently analyzing video
- `completed` - Detection complete, ready for review
- `failed` - Processing failed (check error message)
- `exporting` - Exporting clips
- `exported` - Export complete

---

### Progress Stream (SSE)

Stream real-time progress updates.

```
GET /api/progress/{job_id}
```

**Response:** Server-Sent Events stream

```
event: progress
data: {"progress": 25, "stage": "audio_detection", "message": "Analyzing audio..."}

event: progress
data: {"progress": 50, "stage": "visual_detection", "message": "Detecting ball origin..."}

event: complete
data: {"shots_detected": 3}
```

---

### Get Detected Shots

Get all detected shots for a job.

```
GET /api/shots/{job_id}
```

**Response:**
```json
{
  "shots": [
    {
      "id": 1,
      "shot_number": 1,
      "strike_time": 18.25,
      "confidence": 0.92,
      "clip_start": 16.25,
      "clip_end": 22.25,
      "landing_x": null,
      "landing_y": null,
      "origin_x": 0.45,
      "origin_y": 0.85
    }
  ]
}
```

---

### Update Shot Boundaries

Update shot boundaries after review.

```
POST /api/shots/{job_id}/update
```

**Request:**
```json
{
  "shots": [
    {
      "shot_id": 1,
      "clip_start": 16.0,
      "clip_end": 23.0,
      "landing_x": 0.72,
      "landing_y": 0.65,
      "approved": true
    }
  ]
}
```

**Response:**
```json
{
  "updated": 1,
  "message": "Shots updated successfully"
}
```

---

### Export Clips

Export approved clips to video files.

```
POST /api/export
```

**Request:**
```json
{
  "job_id": "abc123",
  "shots": [1, 2, 3],
  "render_tracer": true,
  "tracer_style": {
    "color": "#FF0000",
    "glow_enabled": true,
    "line_width": 3,
    "show_apex_marker": true,
    "show_landing_marker": true
  }
}
```

**Response:**
```json
{
  "export_job_id": "exp456",
  "status": "started",
  "total_clips": 3
}
```

---

### Get Export Status

Get the status of an export job.

```
GET /api/export/{export_job_id}/status
```

**Response:**
```json
{
  "export_job_id": "exp456",
  "status": "completed",
  "progress": 100,
  "clips_exported": 3,
  "output_dir": "/path/to/video_clips/",
  "files": [
    "shot_1.mp4",
    "shot_2.mp4",
    "shot_3.mp4"
  ]
}
```

---

### List All Jobs

Get all processing jobs.

```
GET /api/jobs
```

**Response:**
```json
{
  "jobs": [
    {
      "job_id": "abc123",
      "video_path": "/path/to/video.mp4",
      "status": "completed",
      "shots_detected": 3,
      "created_at": "2026-01-31T10:00:00Z"
    }
  ]
}
```

---

### Delete Job

Delete a job and its associated data.

```
DELETE /api/jobs/{job_id}
```

**Response:**
```json
{
  "deleted": true,
  "message": "Job deleted successfully"
}
```

---

### Get Video Info

Get metadata about a video file.

```
GET /api/video-info?path=/path/to/video.mp4
```

**Response:**
```json
{
  "path": "/path/to/video.mp4",
  "duration": 125.5,
  "width": 1920,
  "height": 1080,
  "fps": 30.0,
  "codec": "h264",
  "size": 104857600
}
```

---

### Stream Video

Stream a video file with Range request support.

```
GET /api/video?path=/path/to/video.mp4
```

**Query Parameters:**
- `path` (required) - Path to the video file
- `download` (optional) - Set to `true` to trigger browser download

**Headers Supported:**
- `Range: bytes=0-1000` - Request specific byte range for seeking

**Response:**
- Content-Type: `video/mp4` (or appropriate mime type)
- Supports partial content (206) for seeking

---

## Feedback Collection

Feedback collection for ML improvement of shot detection.

### Submit Shot Feedback

Submit true positive/false positive feedback on detected shots.

```
POST /api/feedback/{job_id}
```

**Request:**
```json
{
  "feedback": [
    {
      "shot_id": 1,
      "feedback_type": "true_positive",
      "notes": "Perfect detection"
    },
    {
      "shot_id": 2,
      "feedback_type": "false_positive",
      "notes": "Cart noise, not a golf shot"
    }
  ]
}
```

**Feedback Types:**
- `true_positive` - Correctly detected golf shot
- `false_positive` - Not a golf shot (incorrectly detected)
- `true_negative` - Correctly skipped
- `false_negative` - Missed a golf shot

**Response:**
```json
{
  "submitted": 2,
  "message": "Feedback recorded successfully"
}
```

---

### Get Job Feedback

Get all feedback for a specific job.

```
GET /api/feedback/{job_id}
```

**Response:**
```json
{
  "job_id": "abc123",
  "feedback": [
    {
      "shot_id": 1,
      "feedback_type": "true_positive",
      "notes": "Perfect detection",
      "confidence_snapshot": 0.92,
      "created_at": "2026-01-31T10:05:00Z"
    }
  ]
}
```

---

### Export All Feedback

Export all feedback data for ML analysis.

```
GET /api/feedback/export
```

**Response:**
```json
{
  "total_records": 150,
  "feedback": [
    {
      "job_id": "abc123",
      "shot_id": 1,
      "feedback_type": "true_positive",
      "confidence": 0.92,
      "features": {
        "peak_height": 0.85,
        "spectral_flatness": 0.32,
        "spectral_centroid": 3500,
        "peak_prominence": 0.78,
        "rise_time": 0.008,
        "decay_ratio": 0.65,
        "zero_crossing_rate": 0.12
      },
      "created_at": "2026-01-31T10:05:00Z"
    }
  ]
}
```

---

### Get Feedback Stats

Get aggregate precision statistics.

```
GET /api/feedback/stats
```

**Response:**
```json
{
  "total_feedback": 150,
  "true_positives": 120,
  "false_positives": 25,
  "true_negatives": 5,
  "false_negatives": 0,
  "precision": 0.83,
  "recall": 1.0,
  "by_confidence_bucket": {
    "0.9-1.0": {"tp": 50, "fp": 2, "precision": 0.96},
    "0.8-0.9": {"tp": 45, "fp": 8, "precision": 0.85},
    "0.7-0.8": {"tp": 25, "fp": 15, "precision": 0.63}
  }
}
```

---

## Trajectory / Shot Tracer

Endpoints for managing shot trajectories.

### Get Trajectory

Get trajectory data for a specific shot.

```
GET /api/trajectory/{job_id}/{shot_id}
```

**Response:**
```json
{
  "shot_id": 1,
  "points": [
    {"timestamp": 0.0, "x": 0.45, "y": 0.85, "confidence": 0.95, "interpolated": false},
    {"timestamp": 0.1, "x": 0.48, "y": 0.75, "confidence": 0.90, "interpolated": false},
    {"timestamp": 0.2, "x": 0.52, "y": 0.60, "confidence": 0.85, "interpolated": true}
  ],
  "apex_point": {"timestamp": 1.5, "x": 0.60, "y": 0.20},
  "confidence": 0.85,
  "frame_width": 1920,
  "frame_height": 1080,
  "is_manual_override": false
}
```

**Note:** Coordinates are normalized (0-1) relative to frame dimensions.

---

### Update Trajectory

Update trajectory after manual edits.

```
PUT /api/trajectory/{job_id}/{shot_id}
```

**Request:**
```json
{
  "points": [
    {"timestamp": 0.0, "x": 0.45, "y": 0.85},
    {"timestamp": 0.1, "x": 0.48, "y": 0.75}
  ],
  "apex_point": {"timestamp": 1.5, "x": 0.60, "y": 0.20},
  "is_manual_override": true
}
```

**Response:**
```json
{
  "updated": true,
  "message": "Trajectory updated successfully"
}
```

---

### Get All Trajectories for Job

Get all trajectories for a job.

```
GET /api/trajectories/{job_id}
```

**Response:**
```json
{
  "trajectories": [
    {
      "shot_id": 1,
      "points": [...],
      "apex_point": {...},
      "confidence": 0.85
    },
    {
      "shot_id": 2,
      "points": [...],
      "apex_point": {...},
      "confidence": 0.78
    }
  ]
}
```

---

### Generate Trajectory (SSE)

Generate trajectory with user-marked landing point. Streams progress via SSE.

```
GET /api/trajectory/{job_id}/{shot_id}/generate?landing_x=0.72&landing_y=0.65
```

**Query Parameters:**
- `landing_x` (required) - Normalized X coordinate where ball landed (0-1)
- `landing_y` (required) - Normalized Y coordinate where ball landed (0-1)
- `height` (optional) - Shot height: `low`, `medium`, `high`
- `shape` (optional) - Shot shape: `hook`, `draw`, `straight`, `fade`, `slice`
- `starting_line` (optional) - Starting line: `left`, `center`, `right`
- `flight_time` (optional) - Flight time in seconds (1.0-10.0)

**Response:** Server-Sent Events stream

```
event: progress
data: {"progress": 10, "stage": "extracting_template", "message": "Extracting ball template..."}

event: progress
data: {"progress": 30, "stage": "detecting_early", "message": "Detecting early ball motion..."}

event: warning
data: {"message": "Shaft detection failed, using fallback method"}

event: progress
data: {"progress": 60, "stage": "generating_physics", "message": "Generating physics trajectory..."}

event: progress
data: {"progress": 90, "stage": "smoothing", "message": "Smoothing trajectory..."}

event: complete
data: {
  "trajectory": {
    "shot_id": 1,
    "points": [...],
    "apex_point": {...},
    "confidence": 0.85
  }
}
```

**Error Response:**
```
event: error
data: {"error": "Failed to detect ball origin", "code": "ORIGIN_DETECTION_FAILED"}
```

---

## Tracer Feedback

Feedback collection for ML improvement of trajectory generation.

### Submit Tracer Feedback

Submit feedback on auto-generated trajectories.

```
POST /api/tracer-feedback/{job_id}
```

**Request:**
```json
{
  "shot_id": 1,
  "feedback_type": "tracer_configured",
  "origin": {"x": 0.45, "y": 0.85},
  "landing": {"x": 0.72, "y": 0.65},
  "auto_params": {
    "height": "medium",
    "shape": "straight",
    "starting_line": "center",
    "flight_time": 3.0
  },
  "final_params": {
    "height": "high",
    "shape": "draw",
    "starting_line": "center",
    "flight_time": 4.5
  }
}
```

**Feedback Types:**
- `tracer_auto_accepted` - User accepted auto-generated tracer without changes
- `tracer_configured` - User adjusted configuration then accepted
- `tracer_reluctant_accept` - User accepted but tracer wasn't perfect
- `tracer_skip` - User skipped the shot entirely
- `tracer_rejected` - User accepted shot without tracer

**Response:**
```json
{
  "submitted": true,
  "feedback_id": 42,
  "delta_captured": true
}
```

---

### Get Tracer Feedback Stats

Get aggregate tracer feedback statistics.

```
GET /api/tracer-feedback/stats
```

**Response:**
```json
{
  "total_feedback": 100,
  "by_type": {
    "tracer_auto_accepted": 45,
    "tracer_configured": 35,
    "tracer_reluctant_accept": 10,
    "tracer_skip": 5,
    "tracer_rejected": 5
  },
  "auto_accept_rate": 0.45,
  "configuration_rate": 0.35,
  "common_adjustments": {
    "height": {"up": 25, "down": 10},
    "flight_time": {"avg_delta": 0.8, "direction": "increase"},
    "shape": {"draw_to_straight": 5, "straight_to_fade": 8}
  }
}
```

---

### Export Tracer Feedback

Export all tracer feedback data for ML training.

```
GET /api/tracer-feedback/export
```

**Response:**
```json
{
  "total_records": 100,
  "feedback": [
    {
      "job_id": "abc123",
      "shot_id": 1,
      "feedback_type": "tracer_configured",
      "origin": {"x": 0.45, "y": 0.85},
      "landing": {"x": 0.72, "y": 0.65},
      "auto_params": {
        "height": "medium",
        "shape": "straight",
        "flight_time": 3.0
      },
      "final_params": {
        "height": "high",
        "shape": "draw",
        "flight_time": 4.5
      },
      "delta": {
        "height": {"from": "medium", "to": "high", "change": "+1"},
        "shape": {"from": "straight", "to": "draw"},
        "flight_time": {"from": 3.0, "to": 4.5, "change": 1.5}
      },
      "created_at": "2026-01-31T10:10:00Z"
    }
  ]
}
```

---

## Origin Feedback

Feedback collection for ML improvement of ball origin detection.

### Get Origin Feedback Stats

Get aggregate origin detection accuracy statistics.

```
GET /api/origin-feedback/stats
```

**Response:**
```json
{
  "total_feedback": 42,
  "correction_rate": 0.38,
  "mean_error_distance": 0.045,
  "median_error_distance": 0.032,
  "by_method": {
    "shaft+clubhead": {
      "count": 35,
      "mean_error": 0.028,
      "correction_rate": 0.20
    },
    "clubhead_only": {
      "count": 5,
      "mean_error": 0.065,
      "correction_rate": 0.60
    },
    "fallback": {
      "count": 2,
      "mean_error": 0.120,
      "correction_rate": 1.0
    }
  },
  "error_distribution": {
    "0.00-0.02": 15,
    "0.02-0.05": 18,
    "0.05-0.10": 7,
    "0.10+": 2
  }
}
```

---

### Export Origin Feedback

Export origin feedback data for ML training.

```
GET /api/origin-feedback/export
```

**Response:**
```json
{
  "total_records": 42,
  "feedback": [
    {
      "job_id": "abc123",
      "shot_id": 1,
      "video_path": "/path/to/video.mp4",
      "strike_time": 18.25,
      "frame_width": 1920,
      "frame_height": 1080,
      "auto_detection": {
        "origin_x": 0.45,
        "origin_y": 0.85,
        "confidence": 0.92,
        "method": "shaft+clubhead",
        "shaft_score": 0.96,
        "clubhead_detected": true
      },
      "manual_correction": {
        "origin_x": 0.46,
        "origin_y": 0.84
      },
      "error_metrics": {
        "error_dx": 0.01,
        "error_dy": -0.01,
        "error_distance": 0.014
      },
      "created_at": "2026-01-31T10:08:00Z"
    }
  ]
}
```

---

## Error Responses

All endpoints may return error responses in this format:

```json
{
  "error": "Error message describing what went wrong",
  "code": "ERROR_CODE",
  "details": {}
}
```

**Common Error Codes:**
- `JOB_NOT_FOUND` - The specified job ID does not exist
- `SHOT_NOT_FOUND` - The specified shot ID does not exist
- `INVALID_VIDEO_PATH` - The video path is invalid or file doesn't exist
- `PROCESSING_FAILED` - Video processing failed
- `ORIGIN_DETECTION_FAILED` - Could not detect ball origin
- `TRAJECTORY_GENERATION_FAILED` - Could not generate trajectory
- `EXPORT_FAILED` - Export operation failed

**HTTP Status Codes:**
- `200` - Success
- `201` - Created
- `206` - Partial Content (for video streaming with Range requests)
- `400` - Bad Request (invalid parameters)
- `404` - Not Found
- `500` - Internal Server Error
