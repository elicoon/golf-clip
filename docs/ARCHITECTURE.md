# GolfClip Architecture Documentation

Technical architecture reference for the GolfClip project - an AI-powered golf shot detection and clip export tool.

> **Implementation Status:**
> - **Active — Browser App** (`apps/browser/`): Production web app deployed on Vercel. Fully client-side — no backend required. All audio/video processing runs in the browser via FFmpeg.js, Essentia.js, and WebCodecs API.
> - **Paused — Desktop Backend** (`apps/desktop/`): Python FastAPI server with YOLO, OpenCV, and librosa for server-side shot detection. Included as a reference implementation of the detection algorithms. Sections covering this backend are labeled **[Desktop Backend]**.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Detection Pipeline](#2-detection-pipeline)
3. [Ball Origin Detection Architecture](#3-ball-origin-detection-architecture)
4. [Trajectory Generation Pipeline](#4-trajectory-generation-pipeline)
5. [Frontend Component Architecture](#5-frontend-component-architecture)
6. [Database Schema](#6-database-schema)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Technology Stack](#8-technology-stack)

---

## 1. System Overview

### High-Level Architecture

```mermaid
graph TB
    subgraph "Frontend (React)"
        UI[User Interface]
        Store[Zustand Store]
        Components[React Components]
    end

    subgraph "Backend (FastAPI)"
        API[API Routes]
        Pipeline[Detection Pipeline]
        Models[Database Models]
        Processing[Video Processing]
    end

    subgraph "Detection Engine"
        Audio[Audio Analysis]
        Visual[Visual Detection]
        Origin[Origin Detection]
        Tracker[Ball Tracker]
    end

    subgraph "Storage"
        SQLite[(SQLite DB)]
        FileSystem[File System]
    end

    UI --> API
    API --> Pipeline
    Pipeline --> Audio
    Pipeline --> Visual
    Pipeline --> Origin
    Pipeline --> Tracker
    API --> Models
    Models --> SQLite
    Processing --> FileSystem
```

### Monorepo Structure

```
golf-clip/
├── apps/
│   ├── browser/               # Production web app (Vercel)
│   │   └── src/
│   │       ├── App.tsx        # View routing (upload/review/export)
│   │       ├── components/    # UI components
│   │       ├── stores/        # Zustand state management
│   │       └── lib/           # Processing pipeline, trajectory gen
│   └── desktop/               # PAUSED: Desktop backend (Python FastAPI)
│       └── backend/
│           ├── api/           # FastAPI routes
│           ├── core/          # Database, config
│           ├── detection/     # Shot detection algorithms (YOLO, OpenCV, librosa)
│           ├── models/        # SQLite CRUD operations
│           └── processing/    # Video/tracer rendering
├── scripts/                   # Development and ML analysis scripts
├── src/                       # Legacy ML experiments and performance benchmarks
└── docs/                      # Documentation
```

**Note:** Only `apps/browser/` is actively deployed. `apps/desktop/` is a paused reference implementation of the server-side detection pipeline. The browser app does all processing client-side (FFmpeg.js + Essentia.js + WebCodecs) and does not require the desktop backend.

---

## 2. Detection Pipeline [Desktop Backend]

### Full Pipeline Flow

```mermaid
flowchart LR
    A[Video Upload] --> B[Audio Extraction]
    B --> C[Transient Detection]
    C --> D[Deduplication]
    D --> E[Visual Detection]
    E --> F[Origin Detection]
    F --> G[Trajectory Capture]
    G --> H[Confidence Scoring]
    H --> I[User Review]
    I --> J[Export]

    style A fill:#e1f5fe
    style J fill:#c8e6c9
```

### Detailed Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHOT DETECTION PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐       │
│  │    VIDEO     │───▶│ AUDIO EXTRACTION │───▶│ TRANSIENT DETECTION  │       │
│  │    INPUT     │    │  (ffmpeg-python) │    │     (librosa)        │       │
│  └──────────────┘    └──────────────────┘    └──────────────────────┘       │
│                                                        │                     │
│                                                        ▼                     │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                     AUDIO FEATURE EXTRACTION                      │       │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────┐ │       │
│  │  │ Peak Height │ │ Spectral     │ │ Spectral    │ │ Peak      │ │       │
│  │  │    (20%)    │ │ Flatness(10%)│ │ Centroid(15%)│ │Prominence │ │       │
│  │  └─────────────┘ └──────────────┘ └─────────────┘ │   (15%)   │ │       │
│  │  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ └───────────┘ │       │
│  │  │ Rise Time   │ │ Decay Ratio  │ │Zero-Crossing│                │       │
│  │  │    (10%)    │ │    (20%)     │ │ Rate (10%)  │                │       │
│  │  └─────────────┘ └──────────────┘ └─────────────┘                │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                    │                                         │
│                                    ▼                                         │
│                       ┌──────────────────────┐                               │
│                       │    DEDUPLICATION     │                               │
│                       │  (25s time window)   │                               │
│                       └──────────────────────┘                               │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                      VISUAL DETECTION                             │       │
│  │  ┌────────────┐   ┌────────────┐   ┌────────────┐                │       │
│  │  │YOLO Person │   │YOLO Ball   │   │ Motion     │                │       │
│  │  │ Detection  │   │ Detection  │   │ Detection  │                │       │
│  │  └────────────┘   └────────────┘   └────────────┘                │       │
│  └──────────────────────────────────────────────────────────────────┘       │
│                                    │                                         │
│                                    ▼                                         │
│                       ┌──────────────────────┐                               │
│                       │   CONFIDENCE SCORING │                               │
│                       │ Audio(40%)+Visual(60%)│                               │
│                       └──────────────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Audio Detection Feature Weights

| Feature | Weight | Description |
|---------|--------|-------------|
| Peak height | 20% | Transient amplitude relative to local mean |
| Spectral flatness | 10% | Noise-like vs tonal (strikes ~0.3) |
| Spectral centroid | 15% | Frequency "brightness" (strikes ~2500-4500 Hz) |
| Peak prominence | 15% | How much peak stands out from background |
| Rise time | 10% | Attack speed (strikes have fast attack <10ms) |
| Decay ratio | 20% | How quickly sound decays (strikes decay fast) |
| Zero-crossing rate | 10% | Helps filter swoosh sounds (practice swings) |

---

## 3. Ball Origin Detection Architecture [Desktop Backend]

### Two-Step Detection Process

```mermaid
flowchart TB
    subgraph "Step 1: Shaft Line Detection"
        A[YOLO Person Detection] --> B[Find Club Shaft]
        B --> C1[LSD Line Detection]
        B --> C2[Hough Transform]
        C1 --> D[Geometric Constraints]
        C2 --> D
        D --> E[Color Analysis]
        E --> F{Shaft Score >= 0.75?}
    end

    subgraph "Step 2: Clubhead Detection"
        F -->|Yes| G[Search Region around Hosel]
        F -->|No| H[Fallback: Clubhead-Only]
        G --> I[Color Masks]
        H --> I
        I --> J[Bright + Low Saturation]
        I --> K[Very Dark Regions]
        J --> L[Contour Analysis]
        K --> L
        L --> M[Clubhead Center]
    end

    M --> N[Ball Position = Clubhead Center]

    style A fill:#e3f2fd
    style N fill:#c8e6c9
```

### Shaft Detection Geometric Constraints

```
                    ┌─────────────────────────────────────┐
                    │           GOLFER BBOX               │
                    │  ┌─────────────────────────────┐   │
                    │  │     y_min (hands area)      │   │
                    │  │            ╲                 │   │
                    │  │             ╲ SHAFT         │   │
                    │  │              ╲              │   │
                    │  │               ╲             │   │
                    │  │                ╲  15-60°    │   │
                    │  │                 ╲ angle     │   │
                    │  │                  ╲          │   │
                    │  │     y_max (feet)  ●─────────│───│── Hosel/Clubhead
                    │  └─────────────────────────────┘   │
                    └─────────────────────────────────────┘

    CONSTRAINTS:
    1. Grip end: between y_min and y_max (hands area)
    2. Hosel end: within ~50px of y_max (feet level)
    3. Line angle: 15-60° from horizontal
    4. Shaft direction: upper-left to lower-right
    5. Clubhead: at maximum x-value of the line
```

### Ball Origin Detection Code Flow

```
BallOriginDetector.detect_origin()
    │
    ├── _get_frame_at_time() ──────── Extract frame 2.5s before strike
    │
    ├── _detect_golfer_zone() ─────── YOLO person detection
    │       │                          Returns: bbox, feet_position, ball_zone
    │       └── BallDetector.detect_golfer_in_frame()
    │
    ├── _detect_shaft_endpoint() ──── Shaft + Clubhead detection
    │       │
    │       ├── _detect_lines_multi_method()
    │       │       ├── LSD (Line Segment Detector)
    │       │       └── Hough with multiple params
    │       │
    │       ├── Apply geometric constraints (angle, position, length)
    │       │
    │       ├── _analyze_line_color() ── Distinguish shaft from grass
    │       │
    │       ├── Score and select best candidate
    │       │
    │       └── _detect_clubhead_center()
    │               ├── HSV color masks (bright metallic, matte black)
    │               ├── Morphological cleanup
    │               └── Contour centroid extraction
    │
    └── _combine_detections() ─────── Priority: YOLO ball > Shaft > None
```

---

## 4. Trajectory Generation Pipeline [Desktop Backend]

### SSE-Based Generation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as API
    participant O as Origin Detector
    participant T as Tracker

    U->>F: Mark Landing Point
    F->>A: GET /trajectory/{job_id}/{shot_id}/generate?landing_x=&landing_y=
    A->>O: detect_origin()
    O-->>A: OriginDetection
    A-->>F: SSE: progress (origin detected)
    A->>T: generate_configured_trajectory()
    T-->>A: Trajectory points
    A-->>F: SSE: complete (trajectory data)
    F->>F: Render tracer on canvas
```

### Trajectory Generation Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRAJECTORY GENERATION PIPELINE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   USER INPUT                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│   │ Landing Point│     │ Origin Point │     │ Configuration│               │
│   │  (required)  │     │(auto/manual) │     │  (optional)  │               │
│   └──────┬───────┘     └──────┬───────┘     └──────┬───────┘               │
│          │                    │                    │                        │
│          └────────────────────┼────────────────────┘                        │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                    EARLY BALL DETECTION                           │     │
│   │  • First 200ms after strike                                       │     │
│   │  • Motion detection + frame differencing                          │     │
│   │  • Extract launch angle and lateral direction                     │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                               │                                              │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                    PHYSICS MODEL                                  │     │
│   │  • Parabolic trajectory calculation                               │     │
│   │  • Apex height based on shot_height config                        │     │
│   │  • Flight duration from user input or derived                     │     │
│   │  • Gravity: g = 2 * apex_height / apex_time²                     │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                               │                                              │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                    BEZIER SMOOTHING                               │     │
│   │  • Quadratic Bezier: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂         │     │
│   │  • Control point derived from apex requirements                   │     │
│   │  • Shot shape (draw/fade) adjusts control point X                 │     │
│   │  • Sine easing for natural ball physics feel                      │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                               │                                              │
│                               ▼                                              │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                    OUTPUT                                         │     │
│   │  • 60 points/second (60fps animation)                             │     │
│   │  • Normalized coordinates (0-1)                                   │     │
│   │  • Apex point marked                                              │     │
│   │  • Stored in shot_trajectories table                              │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Trajectory Configuration Parameters

```
┌──────────────────────────────────────────────────────────────────┐
│                    TRAJECTORY CONFIG                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Starting Line:  ← LEFT ─── CENTER ─── RIGHT →                   │
│                                                                   │
│  Shot Shape:     ← HOOK ── DRAW ── STRAIGHT ── FADE ── SLICE →  │
│                                                                   │
│  Shot Height:    LOW ─────── MEDIUM ─────── HIGH                 │
│                  (apex 55%)   (apex 25%)    (apex 5%)            │
│                                                                   │
│  Flight Time:    [1.0s ═══════════════════════════════ 10.0s]   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4b. Browser Export Pipeline [Browser App]

The browser app exports clips client-side using WebCodecs API with a two-pass real-time capture approach.

### Export Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TWO-PASS EXPORT PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PASS 1: REAL-TIME CAPTURE                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  video.play()                                                       │    │
│  │       │                                                             │    │
│  │       ▼                                                             │    │
│  │  requestVideoFrameCallback() ─────────────────────┐                │    │
│  │       │                                           │                │    │
│  │       ▼                                           │                │    │
│  │  captureCtx.drawImage(video, 0, 0, width, height) │  ◀── Loop     │    │
│  │       │                                           │      until     │    │
│  │       ▼                                           │      endTime   │    │
│  │  createImageBitmap(captureCanvas)                 │                │    │
│  │       │                                           │                │    │
│  │       ▼                                           │                │    │
│  │  capturedBitmaps.push({ bitmap, timeUs }) ────────┘                │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  PASS 2: ENCODING                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  for (bitmap of capturedBitmaps):                                   │    │
│  │       │                                                             │    │
│  │       ▼                                                             │    │
│  │  ctx.drawImage(bitmap, 0, 0)  ───▶  Draw video frame               │    │
│  │       │                                                             │    │
│  │       ▼                                                             │    │
│  │  drawTracerLine(ctx, trajectory, time) ─▶  Composite tracer         │    │
│  │       │                                                             │    │
│  │       ▼                                                             │    │
│  │  new VideoFrame(canvas, { timestamp })                              │    │
│  │       │                                                             │    │
│  │       ▼                                                             │    │
│  │  encoder.encode(frame, { keyFrame: i % 30 === 0 })                  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                              │                                              │
│                              ▼                                              │
│  FINALIZATION                                                               │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  encoder.flush() → muxer.finalize() → new Blob([buffer])           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Implementation Details

| Aspect | Implementation | Why |
|--------|---------------|-----|
| Capture resolution | Output (e.g., 1080p) | Capturing at 4K is too slow, causes frame drops |
| Frame source | Canvas, not video | `createImageBitmap(video)` returns black in some browsers |
| Two-pass design | Capture first, encode after | Encoding is slow; would miss frames if done in callback |
| Timestamp handling | `firstTimestampBehavior: 'offset'` | Clips don't start at t=0; muxer auto-offsets |
| Keyframes | Every 30 frames | Balance between file size and seek performance |
| Return value | `{ blob, actualStartTime }` | `actualStartTime` aligns audio extraction with captured frames |
| Timeout / abort | `AbortSignal`, `timeoutMs`, `stallTimeoutMs` | Prevents hung exports; throws `ExportTimeoutError` on stall or overall timeout |

### Audio Muxing

After the video-only MP4 is produced, the export pipeline muxes audio from the original segment using FFmpeg WASM:

1. Extract audio from original segment blob for the clip time range
2. Mux extracted audio into the video-only export
3. Use precise seeking (`-ss` after `-i`) to avoid keyframe-based drift

The pipeline returns `actualStartTime` (the real first frame time after keyframe seek snap) so audio extraction aligns precisely with the captured video frames.

### Key Files

| File | Purpose |
|------|---------|
| `video-frame-pipeline-v4.ts` | Real-time capture + WebCodecs encoding |
| `tracer-renderer.ts` | Shared renderer used by both TrajectoryEditor and export pipeline (3-layer bezier glow, physics easing) |
| `ffmpeg-client.ts` | FFmpeg WASM operations including audio muxing |
| `ClipReview.tsx` | Export UI with resolution dropdown |

---

## 5. Frontend Component Architecture [Browser App]

### Component Hierarchy

```mermaid
graph TB
    App[App.tsx]

    subgraph "Views (state-based routing)"
        VD[VideoDropzone]
        CR[ClipReview]
    end

    subgraph "Upload Components"
        WS[WalkthroughSteps]
        VQ[VideoQueue]
    end

    subgraph "Clip Review Components"
        TE[TrajectoryEditor]
        SC[Scrubber]
        TCP[TracerConfigPanel]
        EOP[ExportOptionsPanel]
    end

    subgraph "Shared Components"
        CD[ConfirmDialog]
        HTM[HevcTranscodeModal]
    end

    App --> VD
    App --> CR
    App --> WS
    App --> VQ

    CR --> TE
    CR --> SC
    CR --> TCP
    CR --> EOP

    VD --> HTM

    style App fill:#e3f2fd
    style CR fill:#fff3e0
```

### Component Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND COMPONENTS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  App.tsx                                                                     │
│  ├── State-based view routing: 'upload' | 'review' | 'export'               │
│  ├── About box on landing page                                               │
│  └── Inline export-complete view (not a separate component)                  │
│                                                                              │
│  VideoDropzone.tsx                                                           │
│  ├── File upload via drag-and-drop or click                                  │
│  ├── Multi-video queue support (multiple files at once)                      │
│  └── HEVC codec detection with transcode modal                               │
│                                                                              │
│  ClipReview.tsx                                                              │
│  ├── Video player with zoom/pan controls and FPS-aware frame stepping        │
│  ├── Transport controls below video (play/pause, frame step, playback speed) │
│  ├── Instruction banners guiding the review workflow                         │
│  ├── Landing point marking (direct click on video)                           │
│  ├── Tracer config panel with 3-column layout                                │
│  ├── Client-side export via WebCodecs (two-pass pipeline)                    │
│  ├── Approve/reject buttons below scrubber                                   │
│  └── Shot-by-shot navigation                                                 │
│                                                                              │
│  WalkthroughSteps.tsx                                                        │
│  └── Step-by-step walkthrough shown on the upload screen                     │
│                                                                              │
│  VideoQueue.tsx                                                              │
│  ├── Header-mounted video queue display                                      │
│  └── Shows processing status per queued video                                │
│                                                                              │
│  TrajectoryEditor.tsx                                                        │
│  ├── Canvas overlay on video                                                 │
│  ├── Progressive line animation (grows with playback)                        │
│  ├── Custom SVG cursors (crosshair, arrow, diamond)                          │
│  ├── Marker rendering: landing (↓), apex (◆)                                 │
│  └── Safari fallback for canvas blur filter                                  │
│                                                                              │
│  Scrubber.tsx                                                                │
│  ├── Timeline with clip boundaries                                           │
│  ├── Draggable start/end handles                                             │
│  └── Strike/landing time markers                                             │
│                                                                              │
│  TracerConfigPanel.tsx                                                       │
│  ├── Starting line selector                                                  │
│  ├── Shot shape dropdown                                                     │
│  ├── Shot height buttons                                                     │
│  └── Flight time slider                                                      │
│                                                                              │
│  ExportOptionsPanel.tsx                                                      │
│  ├── Resolution dropdown (Original / 1080p / 720p)                           │
│  └── Tracer style options                                                    │
│                                                                              │
│  ConfirmDialog.tsx                                                           │
│  └── Generic confirmation modal                                              │
│                                                                              │
│  HevcTranscodeModal.tsx                                                      │
│  ├── HEVC/H.265 codec detection warning                                     │
│  └── Transcode progress UI                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### State Management (Zustand)

**processingStore.ts** — Central state for video processing and review:
```typescript
interface ProcessingState {
  // Multi-video support
  videos: Map<VideoId, VideoState>  // Per-video state (segments, status, trajectories)
  activeVideoId: VideoId | null     // Currently active video

  // Legacy single-video support
  status: ProcessingStatus
  segments: Segment[]               // Detected shots with approval state

  // Actions
  addVideo: (id, file, url) => void
  updateVideoSegment: (videoId, segmentIndex, updates) => void
  setSegmentTrajectory: (videoId, segmentIndex, trajectory) => void
  // ... reset, queue management
}
```

---

## 6. Database Schema [Desktop Backend]

### Entity Relationship Diagram

```mermaid
erDiagram
    jobs ||--o{ shots : contains
    jobs ||--o{ shot_feedback : has
    jobs ||--o{ shot_trajectories : has
    jobs ||--o{ tracer_feedback : has
    jobs ||--o{ origin_feedback : has

    jobs {
        TEXT id PK
        TEXT video_path
        TEXT output_dir
        TEXT status
        REAL progress
        TEXT current_step
        INTEGER auto_approve
        TEXT video_info_json
        TEXT created_at
        TEXT started_at
        TEXT completed_at
        TEXT error_json
        INTEGER cancelled
        INTEGER total_shots_detected
        INTEGER shots_needing_review
    }

    shots {
        INTEGER id PK
        TEXT job_id FK
        INTEGER shot_number
        REAL strike_time
        REAL landing_time
        REAL clip_start
        REAL clip_end
        REAL confidence
        TEXT shot_type
        REAL audio_confidence
        REAL visual_confidence
        TEXT confidence_reasons_json
        REAL landing_x
        REAL landing_y
    }

    shot_feedback {
        INTEGER id PK
        TEXT job_id FK
        INTEGER shot_id
        TEXT feedback_type
        TEXT notes
        REAL confidence_snapshot
        REAL audio_confidence_snapshot
        REAL visual_confidence_snapshot
        TEXT detection_features_json
        TEXT created_at
        TEXT environment
    }

    shot_trajectories {
        INTEGER id PK
        TEXT job_id FK
        INTEGER shot_id UK
        TEXT trajectory_json
        REAL confidence
        REAL smoothness_score
        REAL physics_plausibility
        REAL apex_x
        REAL apex_y
        REAL apex_timestamp
        REAL launch_angle
        REAL flight_duration
        INTEGER has_gaps
        INTEGER gap_count
        INTEGER is_manual_override
        INTEGER frame_width
        INTEGER frame_height
        TEXT created_at
        TEXT updated_at
    }

    tracer_feedback {
        INTEGER id PK
        TEXT job_id FK
        INTEGER shot_id
        TEXT feedback_type
        TEXT auto_params_json
        TEXT final_params_json
        TEXT origin_point_json
        TEXT landing_point_json
        TEXT apex_point_json
        TEXT created_at
        TEXT environment
    }

    origin_feedback {
        INTEGER id PK
        TEXT job_id FK
        INTEGER shot_id
        TEXT video_path
        REAL strike_time
        INTEGER frame_width
        INTEGER frame_height
        REAL auto_origin_x
        REAL auto_origin_y
        REAL auto_confidence
        TEXT auto_method
        REAL shaft_score
        INTEGER clubhead_detected
        REAL manual_origin_x
        REAL manual_origin_y
        REAL error_dx
        REAL error_dy
        REAL error_distance
        TEXT created_at
        TEXT environment
    }
```

### Schema Version History

| Version | Description |
|---------|-------------|
| 1 | Initial schema: jobs, shots tables |
| 2 | Shot feedback table for TP/FP labeling |
| 3 | Shot trajectories table for ball flight paths |
| 4 | Landing point columns (landing_x, landing_y) |
| 5 | Environment column for dev/prod tagging |
| 6 | Tracer feedback table for trajectory corrections |
| 7 | Origin feedback table for ball origin corrections |

---

## 7. Data Flow Diagrams [Desktop Backend]

### Video Upload to Export Flow

```mermaid
flowchart TB
    subgraph "Upload"
        A[User selects video] --> B[POST /api/upload]
        B --> C[Save to temp directory]
        C --> D[Return server path]
    end

    subgraph "Processing"
        D --> E[POST /api/process]
        E --> F[Create job in DB]
        F --> G[Background: run_detection_pipeline]
        G --> H[SSE: GET /api/progress/{job_id}]
    end

    subgraph "Review"
        H --> I[GET /api/shots/{job_id}]
        I --> J[User marks landing points]
        J --> K[GET /api/trajectory/.../generate]
        K --> L[Store trajectory in DB]
        L --> M[User reviews tracer]
    end

    subgraph "Export"
        M --> N[POST /api/export]
        N --> O[Background: run_export_job]
        O --> P[Extract clips with tracer overlay]
        P --> Q[GET /api/export/{id}/status]
    end

    style A fill:#e1f5fe
    style Q fill:#c8e6c9
```

### Feedback Collection Flow

```mermaid
flowchart LR
    subgraph "Shot Feedback"
        A1[User exports clips] --> B1[ExportComplete UI]
        B1 --> C1[Mark Good/Bad per clip]
        C1 --> D1[POST /api/feedback/{job_id}]
        D1 --> E1[Store in shot_feedback]
    end

    subgraph "Tracer Feedback"
        A2[User reviews tracer] --> B2{Accept or Configure?}
        B2 -->|Accept| C2[tracer_auto_accepted]
        B2 -->|Configure| D2[tracer_configured]
        C2 --> E2[POST /api/tracer-feedback/{job_id}]
        D2 --> E2
        E2 --> F2[Store with delta params]
    end

    subgraph "Origin Feedback"
        A3[User marks origin manually] --> B3[Compare with auto-detected]
        B3 --> C3[Calculate error metrics]
        C3 --> D3[Store in origin_feedback]
    end

    subgraph "ML Training"
        E1 --> G[GET /api/feedback/export]
        F2 --> H[GET /api/tracer-feedback/export]
        D3 --> I[GET /api/origin-feedback/export]
    end
```

### ML Training Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       ML TRAINING DATA PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   DATA COLLECTION                    ANALYSIS                                │
│   ┌──────────────┐                  ┌────────────────────────────────┐      │
│   │shot_feedback │ ─────────────────▶│ Stage 1: Threshold Tuning     │      │
│   │ (TP/FP)      │                  │   Min samples: 10               │      │
│   └──────────────┘                  │   Output: optimal threshold     │      │
│                                     └────────────────────────────────┘      │
│                                                     │                        │
│   ┌──────────────┐                  ┌────────────────────────────────┐      │
│   │tracer_       │ ─────────────────▶│ Stage 2: Weight Optimization  │      │
│   │feedback      │                  │   Min samples: 50               │      │
│   │(auto vs user)│                  │   Output: feature weights       │      │
│   └──────────────┘                  └────────────────────────────────┘      │
│                                                     │                        │
│   ┌──────────────┐                  ┌────────────────────────────────┐      │
│   │origin_       │ ─────────────────▶│ Stage 3: Calibration          │      │
│   │feedback      │                  │   Min samples: 200              │      │
│   │(auto vs user)│                  │   Output: isotonic regression   │      │
│   └──────────────┘                  └────────────────────────────────┘      │
│                                                     │                        │
│                                                     ▼                        │
│                                     ┌────────────────────────────────┐      │
│                                     │ ~/.golfclip/ml_config.json     │      │
│                                     │   - confidence_threshold       │      │
│                                     │   - feature_weights            │      │
│                                     │   - calibration_model          │      │
│                                     └────────────────────────────────┘      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Technology Stack

### Browser App (Active — apps/browser/)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 18 | UI library |
| Language | TypeScript | Type safety |
| Build Tool | Vite | Fast dev server, bundling |
| State Management | Zustand | Simple, performant state |
| Audio Extraction | @ffmpeg/ffmpeg (FFmpeg.js) | Client-side audio extraction from video |
| Audio Analysis | essentia.js | Client-side audio transient detection |
| Canvas Rendering | HTML5 Canvas | Trajectory animation |
| Video Playback | HTML5 Video | Native video controls |
| Video Export | WebCodecs API | Hardware-accelerated encoding |
| Frame Capture | requestVideoFrameCallback | Real-time frame capture + FPS detection |
| MP4 Muxing | mp4-muxer | Browser-side MP4 container creation |
| Hosting | Vercel | Production deployment |

### Desktop Backend (Paused — apps/desktop/)

| Component | Technology | Purpose |
|-----------|------------|---------|
| API Framework | FastAPI | REST API with async support |
| Runtime | Python 3.11+ | Core language |
| Video Processing | OpenCV | Frame extraction, tracer rendering |
| Audio Processing | librosa | Transient detection, spectral analysis |
| Video Codec | ffmpeg-python | Audio extraction, clip export |
| ML Detection | YOLO (ultralytics) | Person/ball detection |
| Database | SQLite + aiosqlite | Local persistence (async) |
| Line Detection | LSD, Hough (OpenCV) | Shaft detection |

### Development

| Tool | Purpose |
|------|---------|
| pytest | Backend testing |
| Vite | Frontend dev server |
| uvicorn | ASGI server |
| loguru | Structured logging |

---

## Appendix: API Endpoints Reference

### Processing & Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload video file |
| POST | `/api/upload-batch` | Upload multiple videos |
| POST | `/api/process` | Start detection job |
| GET | `/api/progress/{job_id}` | SSE progress stream |
| GET | `/api/status/{job_id}` | Get job status |
| GET | `/api/shots/{job_id}` | Get detected shots |
| POST | `/api/shots/{job_id}/update` | Update shot boundaries |
| POST | `/api/export` | Export clips |
| GET | `/api/export/{id}/status` | Export job status |
| GET | `/api/jobs` | List all jobs |
| DELETE | `/api/jobs/{job_id}` | Delete a job |
| POST | `/api/cancel/{job_id}` | Cancel processing job |
| GET | `/api/video` | Stream video (Range request support) |
| GET | `/api/video-info` | Get video metadata |

### Trajectory

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trajectory/{job_id}/{shot_id}` | Get trajectory data |
| PUT | `/api/trajectory/{job_id}/{shot_id}` | Update trajectory |
| GET | `/api/trajectories/{job_id}` | Get all trajectories |
| GET | `/api/trajectory/{job_id}/{shot_id}/generate` | SSE trajectory generation |

### Feedback (ML Training)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/feedback/{job_id}` | Submit shot feedback |
| GET | `/api/feedback/{job_id}` | Get feedback for a job |
| GET | `/api/feedback/export` | Export all feedback |
| GET | `/api/feedback/stats` | Precision statistics |
| POST | `/api/tracer-feedback/{job_id}` | Submit tracer feedback |
| GET | `/api/tracer-feedback/export` | Export tracer feedback |
| GET | `/api/tracer-feedback/stats` | Tracer feedback statistics |
| GET | `/api/origin-feedback/stats` | Origin detection accuracy stats |
| GET | `/api/origin-feedback/export` | Export origin feedback |

### Database Maintenance

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/db/stats` | Database statistics |
| POST | `/api/db/purge` | Purge old data |
| GET | `/api/db/export` | Export database |
