# Browser vs Desktop Feature Gap Analysis

**Date:** 2026-01-30
**Purpose:** Comprehensive comparison to guide browser app development roadmap

---

## Executive Summary

The desktop application (Python/FastAPI backend with Tauri frontend) is significantly more capable than the browser application (fully client-side WebAssembly). The primary gaps are in:

1. **Visual detection** - Desktop uses YOLO for ball/golfer detection; browser has audio-only
2. **Ball tracking** - Desktop has 4+ tracking methods; browser has none
3. **Trajectory generation** - Desktop supports physics, Bezier, constrained methods; browser has basic display only
4. **Tracer export** - Desktop renders professional tracer overlays; browser cannot export with tracers
5. **Job management** - Desktop supports batch upload, queue, persistence; browser is single-video

The browser app's advantages (no server, full privacy, instant access) make it valuable for a "lite" experience, but significant work is needed for feature parity.

---

## Feature Comparison Table

| Feature | Desktop | Browser | Gap Severity |
|---------|---------|---------|--------------|
| **Video Input** |
| Drag-drop upload | Yes | Yes | None |
| File picker | Yes | Yes | None |
| Batch upload | Yes | No | Medium |
| Max file size | Unlimited | 2GB | Medium |
| Format support | MP4, MOV, M4V | MP4, MOV, M4V | None |
| **Shot Detection** |
| Audio detection | Librosa (7 features) | Essentia.js (3 features) | Low |
| Visual detection | YOLO v8 | None | **Critical** |
| Combined audio+visual | Yes | No | **Critical** |
| Confidence scoring | Advanced (7 factors) | Basic (3 factors) | Medium |
| **Ball Tracking** |
| Template matching | Yes | No | High |
| Optical flow | Yes | No | High |
| Kalman filter | Yes | No | High |
| Motion detection | Yes | No | High |
| **Origin Detection** |
| Golfer detection | YOLO person class | No | High |
| Shaft detection | LSD + Hough lines | No | High |
| YOLO ball origin | Yes | No | High |
| Clubhead region | Yes | No | High |
| **Trajectory** |
| Basic display | Canvas animation | 60fps animation | Browser better |
| Physics-based | Parabolic arcs | No | High |
| Bezier curves | Configurable | No | High |
| Hybrid generation | Early + physics | No | High |
| Landing-constrained | Yes | No | High |
| Apex-constrained | Yes | No | High |
| User editing | Yes | Partial (markers) | Medium |
| **Tracer Export** |
| Solid tracer | Yes | No | **Critical** |
| Comet tail | Yes | No | High |
| Glow effect | Yes | No | High |
| Perspective width | Yes | No | Medium |
| Apex/landing markers | Yes | No | Medium |
| Two-pass encoding | Yes | No | Medium |
| **Job Management** |
| Single video | Yes | Yes | None |
| Job queue | Yes | No | Medium |
| Database persistence | SQLite | None (memory only) | Medium |
| SSE progress | Yes | No (polling) | Low |
| Cancel job | Yes | No | Low |
| **Export** |
| Raw segment export | Yes | Yes | None |
| Tracer overlay export | Yes | No | **Critical** |
| Quality options | Multiple | Single | Low |
| **ML/Feedback** |
| Shot feedback | Yes | No | Medium |
| Tracer feedback | Yes | No | Medium |
| Origin feedback | Yes | No | Medium |
| Data export | Yes | No | Low |
| **Performance** |
| GPU acceleration | CUDA/MPS | None | High |
| Memory efficiency | Disk streaming | RAM bounded | Medium |
| Processing speed | Fast (native) | Slow (WASM) | Medium |

---

## Desktop-Only Features (Not in Browser)

### 1. YOLO-Based Visual Detection
**Location:** `apps/desktop/backend/detection/visual.py`

The desktop uses YOLO v8 to detect:
- Golf balls (class 32: sports_ball)
- Golfers (class 0: person)

Key capabilities:
- Size and aspect ratio filtering for golf balls
- Trajectory validation using parabolic physics
- Stationary ball filtering
- Golfer bounding box for origin zone estimation
- Flight analysis with trajectory clustering

**Technical barrier for browser:** YOLO models are large (~25MB for nano) and require significant compute. WebAssembly YOLO implementations exist but are 10-50x slower than native.

### 2. Multi-Method Ball Tracking
**Location:** `apps/desktop/backend/detection/tracker.py` (1956 lines)

Four tracking methods:
1. **Template matching** - Finds ball using appearance template
2. **Optical flow** - Tracks motion between frames
3. **Kalman filter** - Predicts position using physics model
4. **Motion detection** - Frame differencing for fast-moving objects

The `ConstrainedBallTracker` class combines these methods and supports:
- `track_hybrid_trajectory()` - Early detection + physics completion
- `track_precise_trajectory()` - Full multi-method tracking
- `track_with_landing_point()` - Constrained to user-marked landing
- `generate_configured_trajectory()` - Bezier with shot shape parameters

**Technical barrier for browser:** OpenCV operations (optical flow, template matching) are computationally intensive. opencv.js exists but is slow.

### 3. Ball Origin Detection
**Location:** `apps/desktop/backend/detection/origin.py`

Multi-method origin detection:
1. **Golfer zone** - Use YOLO person detection to estimate ball position
2. **Shaft detection** - LSD line detection + Hough transform to find club shaft endpoint
3. **YOLO ball** - Detect ball in first frames of swing
4. **Clubhead region** - Fallback based on golfer position

**Technical barrier for browser:** Depends on YOLO and OpenCV line detection.

### 4. Professional Tracer Rendering
**Location:** `apps/desktop/backend/processing/tracer.py`

Tracer styles include:
- **Solid** - Single color line
- **Comet** - Fading tail with taper
- **Hybrid** - Comet + ball marker at head

Features:
- Glow effect with configurable blur
- Perspective width (thinner at distance)
- Apex and landing markers
- Two-pass encoding for quality
- Configurable colors and transparency

**Technical barrier for browser:** FFmpeg.wasm can overlay, but complex real-time rendering is challenging.

### 5. Database Persistence
**Location:** `apps/desktop/backend/api/routes.py`

SQLite database stores:
- Job status and metadata
- Detected shots
- Generated trajectories
- User feedback for ML

Enables:
- Resume processing after restart
- Export ML training data
- Analytics and statistics

**Technical barrier for browser:** IndexedDB could provide persistence, but implementation effort is significant.

### 6. ML Feedback Collection
**Location:** `apps/desktop/backend/api/routes.py` (feedback endpoints)

Three feedback types:
1. **Shot feedback** - Was this a real shot? (true positive/false positive)
2. **Tracer feedback** - Rate tracer accuracy 1-5
3. **Origin feedback** - Rate origin detection accuracy

Data is stored for future model improvement.

**Technical barrier for browser:** Could send feedback to a server, but requires backend infrastructure.

---

## Browser-Only Features (Advantages)

### 1. Fully Client-Side Processing
- No server required
- Video never leaves user's device
- Works offline (after initial load)
- Instant access (no installation)

### 2. 60fps Trajectory Animation
**Location:** `apps/browser/src/components/TrajectoryEditor.tsx`

Smooth canvas animation with:
- requestAnimationFrame loop
- Physics-based easing
- Interactive marker editing

Desktop's Tauri UI is less smooth in trajectory preview.

### 3. Privacy
All processing happens locally. For users concerned about uploading golf videos to servers, the browser app is the only option.

---

## Technical Limitations Preventing Feature Parity

### 1. WebAssembly Performance
WASM is 2-10x slower than native code. For ML inference (YOLO), the gap is even larger without GPU access.

**Impact:** Visual detection would be impractically slow.

**Potential solutions:**
- WebGPU API (emerging, limited browser support)
- ONNX Runtime Web with WebGL backend
- Smaller/quantized models (tradeoff: accuracy)
- Server-side processing option (hybrid approach)

### 2. Memory Constraints
Browser tab memory is limited (~2-4GB). Large videos exhaust memory during FFmpeg processing.

**Impact:** 2GB file size limit in browser.

**Potential solutions:**
- Streaming processing with Web Streams API
- SharedArrayBuffer for better memory management
- Progressive processing with cleanup between phases

### 3. No Direct GPU Access
Browsers can't use CUDA/MPS directly. WebGL is limited for ML workloads.

**Impact:** YOLO inference is CPU-only in browser.

**Potential solutions:**
- WebGPU (future)
- WebGL-based inference (TensorFlow.js, ONNX.js)
- Accept slower processing for browser

### 4. Limited OpenCV
opencv.js is large (~8MB) and slow for operations like optical flow.

**Impact:** Ball tracking methods would be too slow.

**Potential solutions:**
- Implement simpler tracking in pure JS
- Use only template matching (skip optical flow)
- Process at lower resolution

### 5. FFmpeg.wasm Limitations
- No hardware acceleration
- Subset of FFmpeg functionality
- Large WASM binary (~25MB core)

**Impact:** Video processing is slower; some filters unavailable.

**Potential solutions:**
- Accept slower processing
- Use simpler video operations
- Hybrid: send to server for complex operations

---

## Prioritized Gaps to Address

### Priority 1: Critical for Core Experience

| Gap | Effort | Impact | Approach |
|-----|--------|--------|----------|
| Tracer export | High | Users need shareable output | Implement canvas-based tracer rendering, export with MediaRecorder API |
| Basic visual detection | Very High | Audio-only misses many shots | Evaluate TensorFlow.js or ONNX.js for lightweight ball detection |

### Priority 2: High Value Features

| Gap | Effort | Impact | Approach |
|-----|--------|--------|----------|
| Trajectory generation | Medium | Detected shots need good tracers | Port physics-based trajectory to TypeScript |
| Origin detection | High | Tracers need starting point | Simplify to golfer detection only (skip shaft) |
| Simple ball tracking | High | Improve trajectory accuracy | Implement template matching in JS/WASM |

### Priority 3: Nice to Have

| Gap | Effort | Impact | Approach |
|-----|--------|--------|----------|
| Batch upload | Low | Power users want multiple videos | Add to UI, process sequentially |
| Job persistence | Medium | Resume after refresh | Use IndexedDB |
| Feedback collection | Medium | Improve models over time | Send to cloud endpoint |
| File size increase | Medium | Larger videos supported | Improve streaming processing |

### Priority 4: Consider for Future

| Gap | Effort | Impact | Approach |
|-----|--------|--------|----------|
| Full ball tracking | Very High | Best trajectory accuracy | Requires WebGPU or server |
| Advanced tracer styles | Medium | Professional output | Canvas rendering improvements |
| Two-pass export | High | Better quality | FFmpeg.wasm improvements |

---

## Recommended Roadmap

### Phase 1: Core Tracer Export (2-3 weeks)
1. Implement canvas-based tracer rendering (solid line)
2. Use MediaRecorder API to capture canvas + video composite
3. Export as WebM or MP4 (if FFmpeg.wasm supports)

### Phase 2: Basic Visual Detection (4-6 weeks)
1. Evaluate TensorFlow.js COCO-SSD or YOLOv5-nano
2. Implement simplified ball detection (every Nth frame)
3. Combine with existing audio detection
4. Benchmark performance on various devices

### Phase 3: Trajectory Improvement (2-3 weeks)
1. Port physics-based trajectory generation to TypeScript
2. Add simple origin estimation (first detected ball position)
3. Implement basic Bezier curve generation

### Phase 4: Polish and Persistence (2-3 weeks)
1. Add IndexedDB for job persistence
2. Implement batch upload
3. Add feedback submission to cloud endpoint
4. Improve progress reporting

---

## Appendix: Code References

### Browser Source Files
- `apps/browser/src/App.tsx` - Main React component
- `apps/browser/src/components/VideoDropzone.tsx` - File input handling
- `apps/browser/src/components/TrajectoryEditor.tsx` - Canvas trajectory display
- `apps/browser/src/lib/audio-detector.ts` - Essentia.js strike detection
- `apps/browser/src/lib/ffmpeg-client.ts` - FFmpeg.wasm wrapper
- `apps/browser/src/lib/streaming-processor.ts` - Processing orchestration
- `apps/browser/src/stores/processingStore.ts` - Zustand state management

### Desktop Source Files
- `apps/desktop/backend/main.py` - FastAPI server entry
- `apps/desktop/backend/api/routes.py` - Full REST API (1909 lines)
- `apps/desktop/backend/detection/pipeline.py` - Combined detection pipeline
- `apps/desktop/backend/detection/audio.py` - Librosa audio detection
- `apps/desktop/backend/detection/visual.py` - YOLO visual detection
- `apps/desktop/backend/detection/tracker.py` - Ball tracking (1956 lines)
- `apps/desktop/backend/detection/origin.py` - Origin detection
- `apps/desktop/backend/processing/tracer.py` - Tracer rendering

---

## Conclusion

The browser app serves a different user segment than the desktop app:
- **Browser**: Quick, private, no-install experience for basic shot detection
- **Desktop**: Full-featured professional tool with ML-powered detection and export

To close the gap, prioritize **tracer export** (users need shareable output) and **basic visual detection** (audio-only misses too many shots). Full feature parity is unlikely due to fundamental WebAssembly limitations, but a compelling "lite" experience is achievable.
