# GolfClip - Product Requirements Document

## Overview

GolfClip is a Mac desktop application that automatically transforms raw iPhone golf recordings into polished, YouTube-ready video clips. The app processes 15-20 minute videos of golf holes, identifies individual shots, and outputs professionally edited clips with shot tracers and hole information overlays—mimicking the style of popular YouTube golf channels like Good Good, Bryan Bros, Grant Horvat, and Bryson DeChambeau.

## Problem Statement

Creating YouTube-quality golf content currently requires:
1. Manually scrubbing through long recordings to find each shot
2. Precisely cutting clips to start before impact and end after the ball lands
3. Adding shot tracer graphics frame-by-frame
4. Creating and positioning hole information overlays
5. Rendering and exporting each clip

This process takes 2-4 hours per hole of footage. GolfClip automates this workflow, reducing editing time to minutes.

## Target User

**Primary (MVP):** Personal use - the developer plays golf frequently and wants to automate video creation for their own content.

**Future:** Golf content creators who want to produce YouTube-quality videos without professional editing skills or expensive software.

## User Personas

### Primary Persona: Weekend Golf Vlogger
- Plays 2-4 rounds per week
- Records footage on iPhone (4K 60fps)
- Wants to share rounds on YouTube/social media
- Has basic technical skills but limited video editing experience
- Values time savings over perfect customization

### Secondary Persona: Aspiring Golf Creator
- Building a YouTube channel
- Needs consistent, professional-looking output
- May process multiple rounds per week
- Willing to review and adjust clips for quality

---

## Core Features

### Phase 1: Auto Clip Detection + Manual Review (MVP)

#### 1.1 Video Input
- **Input:** One or more 4K 60fps video files from iPhone Camera Roll
- **Format Support:** MOV, MP4 (H.264, H.265/HEVC)
- **File Size:** Up to 100GB per file
- **Interface:** Drag-and-drop or folder selection

#### 1.2 Shot Detection Engine
The system identifies individual golf shots using combined audio and visual analysis:

**Audio Analysis:**
- Detect the distinctive "click" sound of club striking ball
- Use spectral analysis (MFCC features) to distinguish strikes from ambient noise
- Handle varying audio quality from iPhone built-in microphone
- Filter out false positives (cart noise, talking, other golfers)

**Visual Analysis:**
- Detect golf ball presence in frame using YOLO object detection
- Identify the moment ball disappears (impact) by tracking ball position
- Track ball flight trajectory when visible
- Handle all daylight lighting conditions (sunny, overcast, dawn/dusk)
- Camera angle: Behind golfer (down-the-line view)

**Combined Signal Processing:**
- Correlate audio strike detection with visual ball detection
- Use both signals to increase confidence in shot identification
- Timestamp each detected shot with frame-level precision

#### 1.3 Clip Boundary Calculation
For each detected shot:
- **Start point:** 2 seconds before club contacts ball
- **End point:** 2 seconds after ball lands

**Landing Detection (Combination Approach):**
1. Track ball visually until it leaves frame or lands
2. If ball lands in frame: use visual detection
3. If ball leaves frame: estimate landing time using trajectory physics
4. If uncertain: flag for user review
5. Fallback: user manually marks landing point

#### 1.4 Confidence Scoring
Each detected clip receives a confidence score (0-100%) based on:
- Audio strike clarity (was there a clear impact sound?)
- Visual ball detection (was the ball clearly visible?)
- Trajectory completeness (could we track the full flight?)
- Landing detection certainty (did we see/estimate the landing?)

**Thresholds:**
- **High confidence (70-100%):** Auto-accept clip boundaries
- **Low confidence (<70%):** Present to user for review

#### 1.5 Review UI
For low-confidence clips, present an iPhone slow-mo style interface:
- Video playback with touch/click-friendly scrubbing
- Draggable handles to adjust start and end points
- Frame-by-frame stepping (arrow keys or buttons)
- Visual waveform showing audio (helps identify strikes)
- "Accept" and "Reject" buttons for each clip
- Ability to split or merge detected clips

#### 1.6 Output Generation
- **Format:** MP4 (H.264) matching input resolution
- **Naming:** `hole{X}_shot{Y}.mp4` or user-defined pattern
- **Destination:** User-selected output folder
- **Metadata:** Preserve original recording date/time

---

### Phase 2: Shot Tracers

#### 2.1 Ball Flight Tracking
- Track ball position frame-by-frame through the video
- Handle partial visibility (ball in/out of frame)
- Interpolate path when ball is briefly occluded

#### 2.2 Tracer Rendering
- **Style:** Classic white line with subtle glow (TV broadcast style)
- **Animation:** Line draws progressively following ball flight
- **Timing:** Tracer matches actual ball speed and trajectory
- **Physics:** Respect actual apex height and acceleration

**Tracer Requirements:**
1. Starts exactly where ball starts
2. Ends exactly where ball lands
3. Follows general trajectory of actual ball flight
4. Matches apex height of actual shot
5. Duration matches actual ball flight time

#### 2.3 Manual Fallback
When auto-tracking fails:
- User can manually plot key points (start, apex, landing)
- System interpolates smooth curve between points
- Option to adjust timing/speed of tracer animation

---

### Phase 3: Hole Information Overlays

#### 3.1 Data Input
- Manual entry: Hole number, yardage, par (MVP)
- Future: Course database integration, GPS app sync

#### 3.2 Overlay Display
**Position:** Top-right corner (matching YouTube golf style)

**Information Displayed:**
- Hole number (e.g., "HOLE 7")
- Yardage (e.g., "385 YDS")
- Shot number (e.g., "SHOT 2")

**Auto-increment:** Shot number automatically increments per clip, with manual override available.

#### 3.3 Styling
- Clean, modern sans-serif typography
- Semi-transparent background
- Matches aesthetic of Good Good, Bryan Bros, etc.
- Consistent positioning across all clips

---

### Phase 4: GPS & Course Maps Integration

#### 4.1 Google Maps 3D Hole Flyover
Generate cinematic 3D flyover videos of each hole before the shot clips:
- **Course Detection:** Use GPS coordinates from video metadata or user selection
- **Google Maps/Earth Integration:** Pull 3D terrain and satellite imagery for the course
- **Flyover Animation:** Automatically generate a 5-10 second aerial flyover from tee to green
- **Styling:** Match the broadcast-style flyovers seen on PGA Tour coverage
- **Transition:** Smooth transition from flyover into the first shot clip

#### 4.2 GPS Shot Map Overlay
Display an overhead map showing where each shot landed:
- **Shot Plotting:** Mark each shot location on a 2D course map
- **Distance Indicators:** Show distance from tee and distance to pin
- **Shot Path Lines:** Draw lines connecting shot locations
- **Mini-map Overlay:** Small corner overlay showing current position on hole
- **End-of-hole Summary:** Full-screen shot map showing the complete hole playthrough

#### 4.3 Data Sources
- **GPS from Video:** Extract location metadata from iPhone recordings
- **Manual Course Selection:** User selects course from database
- **Golf GPS App Integration:** Import shot data from Arccos, Grint, 18Birdies, etc.
- **Manual Shot Marking:** User can manually place shots on map if GPS unavailable

---

### Phase 5: Additional Future Enhancements

- **In-app recording:** iPhone companion app for direct capture
- **Cloud processing:** For users without powerful Macs
- **Course database:** Auto-populate hole info by GPS
- **Multiple camera angles:** Support face-on and other views
- **Putting detection:** Track putts (different detection logic)
- **Scorecard overlay:** Running score display
- **Custom tracer styles:** User-selectable colors and effects
- **Batch processing:** Queue multiple rounds
- **YouTube direct upload:** Publish without leaving app

---

## Technical Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         GolfClip                                │
│                    Mac Desktop Application                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Frontend  │    │   Backend   │    │  ML Models  │         │
│  │   (React)   │◄──►│  (Python)   │◄──►│  (PyTorch)  │         │
│  │   via Tauri │    │   FastAPI   │    │             │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                  │                  │                 │
│         │                  ▼                  │                 │
│         │          ┌─────────────┐           │                 │
│         │          │   FFmpeg    │◄──────────┘                 │
│         │          │  (Video I/O)│                              │
│         │          └─────────────┘                              │
│         │                  │                                    │
│         ▼                  ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Local Filesystem                      │   │
│  │     Input Videos │ Temp Files │ Output Clips             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Desktop Framework** | Tauri | Lightweight, Rust-based, bundles web UI |
| **Frontend** | React + TypeScript | Familiar, fast development, good ecosystem |
| **Backend** | Python + FastAPI | ML ecosystem, FFmpeg bindings, rapid development |
| **ML Framework** | PyTorch + YOLO | State-of-the-art object detection |
| **Audio Analysis** | librosa | Python audio feature extraction |
| **Video Processing** | FFmpeg | Industry standard, handles all codecs |
| **ML Acceleration** | MPS (Metal) | Native Apple Silicon GPU acceleration |

### Data Flow

```
1. User drops video file(s) into app
                    │
                    ▼
2. FFmpeg extracts audio track + keyframes
                    │
                    ▼
3. Audio Analysis Pipeline
   ├── librosa extracts MFCC features
   ├── Detect audio peaks matching "strike" signature
   └── Output: List of candidate strike timestamps
                    │
                    ▼
4. Visual Analysis Pipeline
   ├── YOLO processes frames around candidate timestamps
   ├── Detect ball presence/absence
   ├── Track ball flight trajectory
   └── Output: Confirmed strikes + flight paths
                    │
                    ▼
5. Clip Boundary Calculator
   ├── Start = strike_time - 2 seconds
   ├── End = landing_time + 2 seconds
   ├── Calculate confidence score
   └── Output: Clip definitions with confidence
                    │
                    ▼
6. Review UI (if confidence < 70%)
   ├── User adjusts clip boundaries
   ├── User accepts/rejects clips
   └── Output: Confirmed clip definitions
                    │
                    ▼
7. FFmpeg cuts clips at confirmed timestamps
                    │
                    ▼
8. [Phase 2] Shot tracer overlay
                    │
                    ▼
9. [Phase 3] Hole info overlay
                    │
                    ▼
10. Output: Final MP4 clips in destination folder
```

### Directory Structure

```
golf-clip/
├── README.md
├── PRD.md
├── .gitignore
├── pyproject.toml              # Python dependencies
├── package.json                # Node dependencies (Tauri + React)
│
├── src/
│   ├── backend/                # Python backend
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI app entry
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── routes.py       # API endpoints
│   │   │   └── schemas.py      # Pydantic models
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py       # Settings
│   │   │   └── video.py        # FFmpeg operations
│   │   ├── detection/
│   │   │   ├── __init__.py
│   │   │   ├── audio.py        # Audio strike detection
│   │   │   ├── visual.py       # YOLO ball detection
│   │   │   └── pipeline.py     # Combined detection
│   │   ├── processing/
│   │   │   ├── __init__.py
│   │   │   ├── clips.py        # Clip extraction
│   │   │   ├── tracer.py       # Shot tracer rendering
│   │   │   └── overlay.py      # Hole info overlays
│   │   └── models/
│   │       └── yolo/           # YOLO weights and config
│   │
│   └── frontend/               # React frontend
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── VideoDropzone.tsx
│       │   │   ├── ClipReview.tsx
│       │   │   ├── Timeline.tsx
│       │   │   ├── Scrubber.tsx
│       │   │   └── ProgressTracker.tsx
│       │   ├── hooks/
│       │   ├── stores/
│       │   └── styles/
│       └── package.json
│
├── src-tauri/                  # Tauri (Rust) config
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       └── main.rs
│
├── tests/
│   ├── test_audio.py
│   ├── test_visual.py
│   └── test_clips.py
│
└── scripts/
    ├── setup.sh                # Development setup
    └── build.sh                # Production build
```

---

## User Interface Design

### Main Window

```
┌─────────────────────────────────────────────────────────────────┐
│  GolfClip                                           ─  □  ✕    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │         Drop video files here                           │   │
│  │              or click to browse                         │   │
│  │                                                         │   │
│  │              📁  Select Files                           │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Recent Projects:                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 📹 Round at Pebble Beach - Jan 20, 2026 - 18 clips      │   │
│  │ 📹 Practice Session - Jan 18, 2026 - 6 clips            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Processing View

```
┌─────────────────────────────────────────────────────────────────┐
│  GolfClip                                           ─  □  ✕    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Processing: round_hole7.mov                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ████████████████████░░░░░░░░░░░░░░░░░░░░░░░  45%        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Step 2 of 4: Analyzing audio for ball strikes...               │
│                                                                 │
│  Detected Shots:                                                │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  #  │ Timestamp │ Type      │ Confidence │ Status     │    │
│  ├────────────────────────────────────────────────────────┤    │
│  │  1  │ 0:42      │ Drive     │ 94%        │ ✓ Auto     │    │
│  │  2  │ 2:18      │ Iron      │ 87%        │ ✓ Auto     │    │
│  │  3  │ 4:55      │ Chip      │ 62%        │ ⚠ Review   │    │
│  │  4  │ 6:30      │ Putt      │ 45%        │ ⚠ Review   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│                                    [ Pause ]  [ Cancel ]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Clip Review View (iPhone Slow-Mo Style)

```
┌─────────────────────────────────────────────────────────────────┐
│  GolfClip - Review Shot #3                          ─  □  ✕    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │                   [Video Preview]                       │   │
│  │                                                         │   │
│  │                  Current Frame: 4:53.24                 │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Audio Waveform                                          │   │
│  │ ▁▂▃▅▇█▇▅▃▂▁▁▂▂▁▁▂▃▅▇█▇▅▃▂▁▁▁▂▂▃▃▂▂▁▁▂▃▅▇█▇▅▃▂▁        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  |◄──────────[█████████████]──────────►|               │   │
│  │  4:51                                   5:12            │   │
│  │                                                         │   │
│  │  Start: [4:53.00]  End: [5:08.50]  Duration: 15.5s     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ◄◄  ◄  [ ▶ Play ]  ►  ►►     [ ✗ Reject ]  [ ✓ Accept ]      │
│                                                                 │
│  Confidence: 62% - Audio detected, ball landing uncertain       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Requirements

| Metric | Target | Notes |
|--------|--------|-------|
| **Processing Speed** | 2-3x realtime | 20 min video → 7-10 min processing |
| **Memory Usage** | < 8GB RAM | Should work on base M1 MacBook |
| **GPU Utilization** | Maximize MPS | Use Apple Silicon GPU for ML inference |
| **Disk I/O** | Minimize temp files | Stream where possible |
| **Detection Accuracy** | > 90% | For clear daylight shots |

---

## Success Metrics

### Phase 1 MVP

- [ ] Successfully processes 4K 60fps video files up to 100GB
- [ ] Detects > 90% of shots in good conditions
- [ ] Confidence scoring correctly flags uncertain clips
- [ ] Review UI allows precise frame-level adjustments
- [ ] Outputs clips that match specified start/end requirements
- [ ] Processing completes in < 3x video duration
- [ ] Works reliably on M1/M2/M3 Macs

### Phase 2

- [ ] Shot tracers accurately follow ball flight
- [ ] Tracer timing matches actual ball speed
- [ ] Manual tracer adjustment available as fallback

### Phase 3

- [ ] Hole overlays render cleanly at all resolutions
- [ ] Shot numbers auto-increment correctly
- [ ] Visual style matches YouTube golf aesthetic

---

## Timeline

### Phase 1: MVP (2-4 weeks)

**Week 1:**
- Project setup (Python, React, Tauri)
- FFmpeg integration for video/audio extraction
- Basic audio analysis pipeline

**Week 2:**
- YOLO model integration for ball detection
- Combined audio+visual shot detection
- Confidence scoring algorithm

**Week 3:**
- Review UI with scrubber component
- Clip extraction with FFmpeg
- End-to-end workflow testing

**Week 4:**
- Bug fixes and edge cases
- Performance optimization
- Documentation and cleanup

### Phase 2: Shot Tracers (2-3 weeks)
- Ball tracking algorithm
- Tracer rendering pipeline
- Manual fallback UI

### Phase 3: Overlays (1-2 weeks)
- Hole info data input
- Overlay rendering
- Styling refinement

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Ball detection fails in poor lighting | High | Medium | Robust fallback to manual review |
| Audio analysis picks up false positives | Medium | High | Combine with visual confirmation |
| Processing too slow on base M1 | Medium | Low | Optimize pipeline, offer quality/speed tradeoff |
| 100GB files cause memory issues | High | Medium | Stream processing, avoid loading full file |
| YOLO model not trained on golf balls | High | Medium | Fine-tune on golf-specific dataset |

---

## Open Questions

1. **YOLO Training Data:** Do we need to fine-tune YOLO on golf-specific footage, or does the base model detect golf balls adequately?

2. **Landing Detection:** What's the best algorithm for estimating landing time when the ball leaves frame? Physics simulation? ML prediction?

3. **Putt Detection:** Putts have very different characteristics (no airtime, different sound). Should Phase 1 handle putts, or defer to Phase 2?

4. **Multiple Golfers:** If multiple people are in frame, how do we identify whose shot to track?

5. **Slow Motion:** iPhone can record slow-mo. Should we support this, and how does it affect detection?

---

## Appendix

### Research References

- [YOLO Golf Ball Detection Research](https://arxiv.org/pdf/2012.09393) - Academic paper on efficient golf ball detection
- [Shot Tracer Pro](https://www.shottracerapp.com/) - Industry-standard ball flight tracking app
- [Golf Impact Sound Analysis Patent](https://patents.google.com/patent/US9217753) - Using MFCC for strike detection
- [Ball Tracking with Computer Vision](https://blog.roboflow.com/tracking-ball-sports-computer-vision/) - General sports ball tracking techniques

### YouTube Golf Style References

- [Good Good Golf](https://www.youtube.com/@GoodGoodGolf) - High-energy, fast-paced editing
- [Bryan Bros Golf](https://www.youtube.com/@BryanBrosGolf) - Professional quality production
- [Grant Horvat Golf](https://www.youtube.com/@GrantHorvatGolf) - Cinematic, long-form storytelling
- [Bryson DeChambeau](https://www.youtube.com/@BrysonDeChambeau) - High-fidelity, multi-camera production
