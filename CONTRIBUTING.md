# Contributing to GolfClip

Thanks for your interest in contributing to GolfClip! This document provides guidelines and instructions for contributing.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Project Structure](#project-structure)
4. [Making Changes](#making-changes)
5. [Code Style](#code-style)
6. [Testing](#testing)
7. [Submitting Changes](#submitting-changes)

---

## Getting Started

### Prerequisites

- macOS (Apple Silicon or Intel) or Windows
- Python 3.11+
- Node.js 18+
- FFmpeg installed and in PATH
- Git

### Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/golf-clip.git
cd golf-clip
```

---

## Development Setup

### Backend Setup

```bash
# Create Python virtual environment
python3.11 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies (including dev dependencies)
pip install -e ".[dev]"
```

### Frontend Setup

```bash
cd apps/browser
npm install
```

### Running the Development Servers

You need two terminal windows:

**Terminal 1 - Backend:**
```bash
cd golf-clip
source .venv/bin/activate
cd apps/desktop
uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload
```

**Terminal 2 - Frontend:**
```bash
cd golf-clip/apps/browser
npm run dev
```

The app will be available at http://localhost:5173

---

## Project Structure

```
golf-clip/
├── apps/
│   ├── browser/          # Production web app (React + TypeScript + Vite)
│   │   └── src/
│   │       ├── components/   # ClipReview, TrajectoryEditor, Scrubber
│   │       ├── lib/          # audio-detector, trajectory-generator, video-frame-pipeline
│   │       └── stores/       # Zustand state management
│   └── desktop/          # Desktop backend (Python + FastAPI)
│       └── backend/
│           ├── api/          # REST + SSE endpoints
│           ├── detection/    # Shot detection algorithms
│           ├── processing/   # Video processing + tracer rendering
│           └── models/       # Database CRUD operations
├── docs/                 # Documentation
└── scripts/              # Development and testing scripts
```

---

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-dark-mode`
- `fix/tracer-animation-timing`
- `refactor/detection-pipeline`
- `docs/update-readme`

### Commit Messages

Follow conventional commit format:
```
type(scope): description

feat(frontend): add trajectory configuration UI
fix(detection): correct ball origin y-coordinate
docs(readme): add UI walkthrough section
refactor(api): simplify export endpoint
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

---

## Code Style

### Python (Backend)

- Follow PEP 8
- Use type hints
- Document public functions with docstrings

```python
async def detect_shots(video_path: str, sensitivity: float = 0.5) -> list[dict]:
    """
    Detect golf shots in a video using audio analysis.

    Args:
        video_path: Path to the video file
        sensitivity: Detection sensitivity (0-1)

    Returns:
        List of detected shots with timestamps and confidence
    """
    ...
```

### TypeScript (Frontend)

- Use functional components with hooks
- Type all props and state
- Use meaningful variable names

```typescript
interface TrajectoryConfig {
  startingLine: 'left' | 'center' | 'right';
  shotShape: 'hook' | 'draw' | 'straight' | 'fade' | 'slice';
  shotHeight: 'low' | 'medium' | 'high';
  flightTime: number;
}
```

---

## Testing

### Running Backend Tests

```bash
cd golf-clip/apps/desktop

# Run all tests
pytest tests/ -v

# Run specific test file
pytest tests/test_audio_detection.py -v

# Skip slow tests
pytest tests/ -v -m "not slow"

# Run with coverage
pytest tests/ -v --cov=backend --cov-report=html
```

### Test Video

Use any short golf video for testing:
```
path/to/your/video.mp4
```

The video should contain visible golf shots for detection to produce results.

---

## Submitting Changes

### Pull Request Process

1. **Create a branch** from `master`
2. **Make your changes** with clear commits
3. **Test your changes** locally
4. **Update documentation** if needed
5. **Submit a PR** with:
   - Clear title and description
   - Screenshots for UI changes
   - Link to related issues

### PR Title Format

```
feat(component): short description
fix(detection): short description
```

### PR Description Template

```markdown
## Summary
Brief description of changes.

## Changes
- Added X
- Fixed Y
- Updated Z

## Testing
How you tested this change.

## Screenshots
(For UI changes)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ VideoDropzone│  │ProcessingView│  │     ClipReview       │   │
│  └──────────────┘  └──────────────┘  │  ┌────────────────┐  │   │
│                                       │  │TrajectoryEditor│  │   │
│                                       │  └────────────────┘  │   │
│                                       └──────────────────────┘   │
│                           │                                      │
│                    Zustand Store                                 │
│                           │                                      │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────┼─────────────────────────────────────┐
│                      BACKEND (FastAPI)                           │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐ │
│  │                      API Routes                             │ │
│  │  /upload  /process  /shots  /trajectory  /export            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│  ┌─────────────┐  ┌───────────────┐  ┌────────────────────────┐ │
│  │   Audio     │  │    Origin     │  │      Trajectory        │ │
│  │  Detection  │  │   Detection   │  │      Generation        │ │
│  │  (librosa)  │  │ (YOLO+OpenCV) │  │    (Physics Model)     │ │
│  └─────────────┘  └───────────────┘  └────────────────────────┘ │
│                           │                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                   SQLite Database                            │ │
│  │     jobs │ shots │ shot_trajectories │ shot_feedback         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

### Audio Shot Detection

Golf ball strikes produce a distinctive transient sound (the "thwack"). The detector:
1. Extracts audio using FFmpeg
2. Applies bandpass filter (1000-8000 Hz)
3. Detects transient peaks
4. Scores each peak on multiple features (amplitude, spectral content, decay)
5. Deduplicates nearby detections

### Ball Origin Detection

Finding where the ball was at impact:
1. Detect golfer using YOLO
2. Find club shaft using line detection
3. Locate clubhead via color analysis
4. Ball position = clubhead center (at address, ball sits in front of clubface)

### Trajectory Generation

The shot tracer uses a physics-based approach:
1. Start point: detected ball origin
2. End point: user-marked landing position
3. Arc: parabolic curve with configurable shape, height, and curve
4. Animation: physics-based timing (fast start, slow apex, steady descent)

---

## Questions?

- Check [CLAUDE.md](./CLAUDE.md) for technical details
- Check [docs/FEATURES.md](./docs/FEATURES.md) for feature documentation
- Check [docs/PRODUCT-WALKTHROUGH.md](./docs/PRODUCT-WALKTHROUGH.md) for user flow

---

## License

This project is private. All rights reserved.
