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

- Node.js 18+
- Git

### Clone the Repository

```bash
git clone https://github.com/elicoon/golf-clip.git
cd golf-clip
```

---

## Development Setup

GolfClip is a browser-only app. No backend server is required for development.

```bash
cd apps/browser
npm install
npm run dev
```

The app will be available at http://localhost:5173

### Desktop Backend (Paused)

The Python/FastAPI desktop backend (`apps/desktop/`) is paused and not required. If you need it for any reason:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd apps/desktop
uvicorn backend.main:app --host 127.0.0.1 --port 8420 --reload
```

---

## Project Structure

```
golf-clip/
├── apps/
│   ├── browser/          # Production web app (React + TypeScript + Vite)
│   │   └── src/
│   │       ├── components/   # ClipReview, TrajectoryEditor, Scrubber
│   │       ├── lib/          # audio-detector, ffmpeg-client, tracer-renderer, video-frame-pipeline, trajectory-generator
│   │       └── stores/       # Zustand state management
│   └── desktop/          # Desktop backend (Python + FastAPI) [PAUSED]
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

### TypeScript

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

```bash
cd apps/browser

# Unit tests
npm run test

# Type checking
npx tsc --noEmit

# E2E tests (Playwright)
npm run test:e2e
```

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

### Browser App

```
Vite dev server
    │
    ▼
React SPA (Zustand store)
    │
    ├── Audio detection (Essentia.js WASM)
    ├── Video decoding (WebCodecs / FFmpeg WASM)
    ├── Trajectory generation (client-side physics)
    └── Video export (FFmpeg WASM muxing)
```

All processing happens client-side in the browser. No server required.

### Desktop Backend (Paused)

The original desktop architecture is preserved in `apps/desktop/` but not actively developed.

```
React Frontend → HTTP/SSE → FastAPI Backend
                                │
                  ┌─────────────┼─────────────┐
                  │             │             │
            Audio Detection  Origin Det.  Trajectory Gen.
            (librosa)        (YOLO+CV2)   (Physics Model)
                                │
                          SQLite Database
```

---

## Key Concepts

### Audio Shot Detection

Golf ball strikes produce a distinctive transient sound (the "thwack").

**Browser:** Essentia.js WASM analyzes audio frames in the browser using onset detection and spectral analysis.

**Desktop Backend (paused):** Server-side pipeline using librosa — extracts audio with FFmpeg, applies bandpass filter, scores transient peaks on amplitude/spectral content/decay.

### Ball Origin Detection [Desktop Backend — Paused]

Finding where the ball was at impact using YOLO + OpenCV. Not yet ported to browser.

### Trajectory Generation

The shot tracer uses a physics-based approach:
1. Start point: detected or user-placed ball origin
2. End point: user-marked landing position
3. Arc: parabolic curve with configurable shape, height, and curve
4. Animation: physics-based timing (fast start, slow apex, steady descent)

Works the same in both browser and desktop.

---

## Questions?

- Check [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for technical details
- Check [docs/FEATURES.md](./docs/FEATURES.md) for feature documentation
- Check [docs/PRODUCT-WALKTHROUGH.md](./docs/PRODUCT-WALKTHROUGH.md) for user flow

---

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
