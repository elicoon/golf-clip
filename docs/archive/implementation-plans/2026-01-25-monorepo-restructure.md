# Monorepo Restructure + Webapp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure golf-clip into a monorepo with shared packages, then add cloud webapp alongside existing desktop app.

**Architecture:**
```
golf-clip/
├── packages/
│   ├── frontend/           # Shared React app
│   ├── detection/          # Shared ML/detection Python code
│   └── api-schemas/        # Shared Pydantic models
├── apps/
│   ├── desktop/            # Tauri + local SQLite + local files
│   │   ├── src-tauri/
│   │   └── backend/        # Desktop-specific routes
│   └── webapp/             # Fly.io + PostgreSQL + R2
│       └── backend/        # Cloud-specific routes
└── docs/
```

**Tech Stack:** Python 3.11, FastAPI, React/Vite, Tauri (desktop), Fly.io + Vercel (webapp)

---

## Phase 1: Monorepo Directory Structure

### Task 1.1: Create New Directory Structure

**Files:**
- Create directories: `packages/`, `apps/`

**Step 1: Create the directory structure**

```bash
cd /Users/ecoon/golf-clip
mkdir -p packages/frontend
mkdir -p packages/detection
mkdir -p packages/api-schemas
mkdir -p apps/desktop
mkdir -p apps/webapp
```

**Step 2: Verify structure**

Run: `ls -la packages/ apps/`
Expected: Empty directories created

**Step 3: Commit**

```bash
git add packages/ apps/
git commit -m "chore: create monorepo directory structure"
```

---

### Task 1.2: Move Frontend to packages/frontend

**Files:**
- Move: `src/frontend/*` → `packages/frontend/`

**Step 1: Move frontend code**

```bash
cd /Users/ecoon/golf-clip
mv src/frontend/* packages/frontend/
rmdir src/frontend
```

**Step 2: Verify frontend still builds**

```bash
cd packages/frontend
npm install
npm run build
```

Expected: Build succeeds

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move frontend to packages/frontend"
```

---

### Task 1.3: Extract Shared Detection Code to packages/detection

**Files:**
- Create: `packages/detection/pyproject.toml`
- Create: `packages/detection/src/golfclip_detection/__init__.py`
- Move detection modules to package

The detection package includes:
- `audio.py` - Audio transient detection
- `visual.py` - YOLO ball detection
- `origin.py` - Ball origin detection
- `tracker.py` - Constraint-based tracking
- `early_tracker.py` - Early ball motion detection
- `pipeline.py` - Combined detection pipeline
- `color_family.py`, `search_expansion.py`, etc.

**Step 1: Create package structure**

```bash
mkdir -p packages/detection/src/golfclip_detection
```

**Step 2: Create pyproject.toml**

```toml
# packages/detection/pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "golfclip-detection"
version = "0.1.0"
description = "Golf shot detection algorithms for GolfClip"
requires-python = ">=3.11"
dependencies = [
    "numpy>=1.24.0",
    "opencv-python>=4.8.0",
    "librosa>=0.10.0",
    "ultralytics>=8.0.0",
    "scipy>=1.11.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]

[tool.setuptools.packages.find]
where = ["src"]
```

**Step 3: Move detection files**

```bash
# Copy (not move yet) to preserve git history better
cp src/backend/detection/*.py packages/detection/src/golfclip_detection/
```

**Step 4: Create __init__.py with exports**

```python
# packages/detection/src/golfclip_detection/__init__.py
"""GolfClip detection algorithms."""

from .audio import AudioDetector, DetectionConfig
from .origin import BallOriginDetector, OriginDetection
from .tracker import ConstrainedBallTracker
from .pipeline import ShotDetectionPipeline

__all__ = [
    "AudioDetector",
    "DetectionConfig",
    "BallOriginDetector",
    "OriginDetection",
    "ConstrainedBallTracker",
    "ShotDetectionPipeline",
]
```

**Step 5: Update imports within detection package**

Update relative imports (e.g., `from .audio import ...`) in all detection files.

**Step 6: Verify package installs**

```bash
cd packages/detection
pip install -e .
python -c "from golfclip_detection import AudioDetector; print('OK')"
```

Expected: Imports work

**Step 7: Commit**

```bash
git add packages/detection/
git commit -m "refactor: extract detection code to packages/detection"
```

---

### Task 1.4: Extract API Schemas to packages/api-schemas

**Files:**
- Create: `packages/api-schemas/pyproject.toml`
- Create: `packages/api-schemas/src/golfclip_schemas/__init__.py`
- Move: `src/backend/api/schemas.py` content

**Step 1: Create package structure**

```bash
mkdir -p packages/api-schemas/src/golfclip_schemas
```

**Step 2: Create pyproject.toml**

```toml
# packages/api-schemas/pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "golfclip-schemas"
version = "0.1.0"
description = "Shared API schemas for GolfClip"
requires-python = ">=3.11"
dependencies = [
    "pydantic>=2.0.0",
]

[tool.setuptools.packages.find]
where = ["src"]
```

**Step 3: Copy schemas**

```bash
cp src/backend/api/schemas.py packages/api-schemas/src/golfclip_schemas/schemas.py
```

**Step 4: Create __init__.py**

```python
# packages/api-schemas/src/golfclip_schemas/__init__.py
"""Shared API schemas for GolfClip."""

from .schemas import *
```

**Step 5: Verify package installs**

```bash
cd packages/api-schemas
pip install -e .
python -c "from golfclip_schemas import DetectedShot; print('OK')"
```

**Step 6: Commit**

```bash
git add packages/api-schemas/
git commit -m "refactor: extract API schemas to packages/api-schemas"
```

---

### Task 1.5: Create apps/desktop with Existing Backend

**Files:**
- Move: `src/backend/*` → `apps/desktop/backend/`
- Move: `src-tauri/` → `apps/desktop/src-tauri/` (if exists)
- Update imports to use shared packages

**Step 1: Move backend code**

```bash
mv src/backend apps/desktop/backend
```

**Step 2: Create desktop pyproject.toml**

```toml
# apps/desktop/pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "golfclip-desktop"
version = "0.1.0"
description = "GolfClip Desktop App Backend"
requires-python = ">=3.11"
dependencies = [
    "golfclip-detection",
    "golfclip-schemas",
    "fastapi>=0.109.0",
    "uvicorn>=0.27.0",
    "aiosqlite>=0.19.0",
    "python-multipart>=0.0.6",
    "loguru>=0.7.0",
    "pydantic-settings>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "httpx>=0.26.0",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["backend*"]
```

**Step 3: Update imports in desktop backend**

Replace:
```python
from backend.detection.audio import AudioDetector
```

With:
```python
from golfclip_detection import AudioDetector
```

And:
```python
from backend.api.schemas import DetectedShot
```

With:
```python
from golfclip_schemas import DetectedShot
```

**Step 4: Verify desktop backend still works**

```bash
cd apps/desktop
pip install -e .
pip install -e ../../packages/detection
pip install -e ../../packages/api-schemas
python -c "from backend.main import app; print('OK')"
```

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move desktop backend to apps/desktop"
```

---

### Task 1.6: Create Root Workspace Configuration

**Files:**
- Create: `pyproject.toml` (root workspace)
- Create: `package.json` (root npm workspace)

**Step 1: Create root pyproject.toml**

```toml
# pyproject.toml (root)
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "golfclip-monorepo"
version = "0.1.0"
description = "GolfClip - AI Golf Shot Detection"
requires-python = ">=3.11"

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
    "ruff>=0.1.0",
]

# Install all packages in editable mode for development
all = [
    "golfclip-detection",
    "golfclip-schemas",
    "golfclip-desktop",
]
```

**Step 2: Create root package.json for npm workspaces**

```json
{
  "name": "golfclip",
  "private": true,
  "workspaces": [
    "packages/frontend",
    "apps/desktop",
    "apps/webapp"
  ]
}
```

**Step 3: Create development setup script**

```bash
# scripts/setup-dev.sh
#!/bin/bash
set -e

echo "Setting up GolfClip development environment..."

# Install Python packages in editable mode
pip install -e packages/detection
pip install -e packages/api-schemas
pip install -e apps/desktop

# Install frontend dependencies
cd packages/frontend && npm install && cd ../..

echo "Development environment ready!"
```

**Step 4: Commit**

```bash
git add pyproject.toml package.json scripts/
git commit -m "chore: add root workspace configuration"
```

---

### Task 1.7: Clean Up Old src/ Directory

**Files:**
- Remove: `src/` (should be empty now)

**Step 1: Remove empty src directory**

```bash
rmdir src 2>/dev/null || rm -rf src
```

**Step 2: Update CLAUDE.md paths**

Update all paths in CLAUDE.md to reflect new structure:
- `src/backend/` → `apps/desktop/backend/`
- `src/frontend/` → `packages/frontend/`

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up old src directory, update documentation"
```

---

## Phase 2: Create Webapp App

### Task 2.1: Create apps/webapp Backend Structure

**Files:**
- Create: `apps/webapp/pyproject.toml`
- Create: `apps/webapp/backend/__init__.py`
- Create: `apps/webapp/backend/main.py`
- Create: `apps/webapp/backend/core/config.py`
- Create: `apps/webapp/backend/core/storage.py`
- Create: `apps/webapp/backend/core/database.py`
- Create: `apps/webapp/backend/api/routes.py`

**Step 1: Create webapp pyproject.toml**

```toml
# apps/webapp/pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "golfclip-webapp"
version = "0.1.0"
description = "GolfClip Webapp Backend (Cloud)"
requires-python = ">=3.11"
dependencies = [
    "golfclip-detection",
    "golfclip-schemas",
    "fastapi>=0.109.0",
    "uvicorn>=0.27.0",
    "asyncpg>=0.29.0",
    "boto3>=1.34.0",
    "python-multipart>=0.0.6",
    "loguru>=0.7.0",
    "pydantic-settings>=2.0.0",
]

[tool.setuptools.packages.find]
where = ["."]
include = ["backend*"]
```

**Step 2: Create webapp main.py (copied from desktop, modified)**

```python
# apps/webapp/backend/main.py
"""GolfClip Webapp - Cloud Backend."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from backend.core.config import settings
from backend.core.database import init_db, close_db
from backend.api.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting GolfClip Webapp...")
    await init_db()
    yield
    await close_db()
    logger.info("GolfClip Webapp shutdown complete")


app = FastAPI(
    title="GolfClip Webapp API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "healthy", "mode": "cloud"}
```

**Step 3: Create webapp config.py (cloud-specific)**

```python
# apps/webapp/backend/core/config.py
"""Webapp configuration - cloud mode only."""

from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Cloud webapp settings."""

    # Server
    host: str = "0.0.0.0"
    port: int = 8420
    debug: bool = False

    # PostgreSQL (required for webapp)
    database_url: str

    # Cloudflare R2 (required for webapp)
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str

    # Processing
    confidence_threshold: float = 0.70
    clip_padding_before: float = 2.0
    clip_padding_after: float = 2.0

    # ML
    yolo_model: str = "yolov8n.pt"
    yolo_confidence: float = 0.03
    audio_sample_rate: int = 44100
    audio_sensitivity: float = 0.5

    # FFmpeg
    ffmpeg_threads: int = 0
    ffmpeg_timeout: int = 600

    # Cleanup
    auto_cleanup_after_export: bool = True

    # CORS
    cors_origins: list[str] = ["https://golfclip.vercel.app"]

    class Config:
        env_prefix = "GOLFCLIP_"
        env_file = ".env"


settings = Settings()
```

**Step 4: Create webapp storage.py (R2 only)**

```python
# apps/webapp/backend/core/storage.py
"""Cloudflare R2 storage for webapp."""

import uuid
from pathlib import Path
from typing import Optional

import boto3
from loguru import logger

from backend.core.config import settings


class R2Storage:
    """Cloudflare R2 storage backend."""

    def __init__(self):
        self.bucket_name = settings.r2_bucket
        self.endpoint_url = f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"

        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
        )

        logger.info(f"R2Storage initialized for bucket {self.bucket_name}")

    def upload(self, content: bytes, filename: str, prefix: str = "uploads") -> str:
        """Upload content and return the storage key."""
        unique_id = str(uuid.uuid4())[:8]
        key = f"{prefix}/{unique_id}_{filename}"

        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content,
        )

        logger.debug(f"Uploaded {len(content)} bytes to {key}")
        return key

    def download(self, key: str) -> bytes:
        """Download content by key."""
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    def download_to_file(self, key: str, destination: Path) -> Path:
        """Download to a local temp file for processing."""
        self.client.download_file(self.bucket_name, key, str(destination))
        return destination

    def delete(self, key: str) -> None:
        """Delete content by key."""
        self.client.delete_object(Bucket=self.bucket_name, Key=key)
        logger.debug(f"Deleted {key}")

    def get_presigned_url(self, key: str, expires_in: int = 3600) -> str:
        """Get a presigned URL for direct access."""
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )

    def exists(self, key: str) -> bool:
        """Check if a key exists."""
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except self.client.exceptions.ClientError:
            return False


# Singleton
_storage: Optional[R2Storage] = None


def get_storage() -> R2Storage:
    global _storage
    if _storage is None:
        _storage = R2Storage()
    return _storage
```

**Step 5: Create webapp database.py (PostgreSQL)**

```python
# apps/webapp/backend/core/database.py
"""PostgreSQL database for webapp using asyncpg."""

from typing import Optional
import asyncpg
from loguru import logger

from backend.core.config import settings

_pool: Optional[asyncpg.Pool] = None


async def init_db() -> None:
    """Initialize database connection pool."""
    global _pool

    logger.info("Connecting to PostgreSQL...")
    _pool = await asyncpg.create_pool(
        settings.database_url,
        min_size=2,
        max_size=10,
    )

    # Run migrations
    async with _pool.acquire() as conn:
        await _run_migrations(conn)

    logger.info("Database initialized")


async def close_db() -> None:
    """Close database connection pool."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_connection():
    """Get a connection from the pool."""
    if _pool is None:
        raise RuntimeError("Database not initialized")
    return _pool.acquire()


async def _run_migrations(conn: asyncpg.Connection) -> None:
    """Apply database migrations."""
    # Create schema version table
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)

    # Check current version
    row = await conn.fetchrow("SELECT MAX(version) as v FROM schema_version")
    current = row["v"] or 0

    if current < 1:
        await _migrate_v1(conn)


async def _migrate_v1(conn: asyncpg.Connection) -> None:
    """Initial schema."""
    logger.info("Applying migration v1")

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            storage_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            progress REAL NOT NULL DEFAULT 0,
            current_step TEXT NOT NULL DEFAULT 'Initializing',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            error_json JSONB,
            total_shots_detected INTEGER DEFAULT 0,
            shots_needing_review INTEGER DEFAULT 0
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS shots (
            id SERIAL PRIMARY KEY,
            job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
            shot_number INTEGER NOT NULL,
            strike_time REAL NOT NULL,
            clip_start REAL NOT NULL,
            clip_end REAL NOT NULL,
            confidence REAL NOT NULL,
            audio_confidence REAL,
            visual_confidence REAL,
            landing_x REAL,
            landing_y REAL
        )
    """)

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS shot_trajectories (
            id SERIAL PRIMARY KEY,
            job_id TEXT,
            shot_id INTEGER,
            points JSONB,
            apex_point JSONB,
            confidence REAL,
            frame_width INTEGER,
            frame_height INTEGER,
            is_manual_override BOOLEAN DEFAULT FALSE
        )
    """)

    await conn.execute("""
        INSERT INTO schema_version (version) VALUES (1)
    """)
```

**Step 6: Commit**

```bash
git add apps/webapp/
git commit -m "feat: create webapp backend structure with R2 and PostgreSQL"
```

---

### Task 2.2: Create Webapp API Routes

**Files:**
- Create: `apps/webapp/backend/api/routes.py`

The webapp routes are similar to desktop but:
- Use `storage_key` instead of `path`
- Return presigned URLs for video streaming
- Include cleanup endpoint

[Detailed implementation similar to desktop routes but adapted for cloud storage]

**Step 1: Create routes.py**

Copy from desktop and modify for cloud storage patterns.

**Step 2: Commit**

```bash
git add apps/webapp/backend/api/
git commit -m "feat: add webapp API routes with cloud storage support"
```

---

### Task 2.3: Create Deployment Configs

**Files:**
- Create: `apps/webapp/Dockerfile`
- Create: `apps/webapp/fly.toml`
- Create: `packages/frontend/vercel.json`

**Step 1: Create Dockerfile**

```dockerfile
# apps/webapp/Dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install shared packages first
COPY packages/detection /app/packages/detection
COPY packages/api-schemas /app/packages/api-schemas
RUN pip install /app/packages/detection /app/packages/api-schemas

# Install webapp
COPY apps/webapp /app/apps/webapp
RUN pip install /app/apps/webapp

# Pre-download YOLO model
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

EXPOSE 8420
WORKDIR /app/apps/webapp
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8420"]
```

**Step 2: Create fly.toml**

```toml
# apps/webapp/fly.toml
app = "golfclip-api"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"
  build-target = "."

[env]
  GOLFCLIP_DEBUG = "false"
  GOLFCLIP_AUTO_CLEANUP_AFTER_EXPORT = "true"

[http_service]
  internal_port = 8420
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 256
```

**Step 3: Create vercel.json**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

**Step 4: Commit**

```bash
git add apps/webapp/Dockerfile apps/webapp/fly.toml packages/frontend/vercel.json
git commit -m "chore: add deployment configurations"
```

---

### Task 2.4: Add Frontend API Configuration

**Files:**
- Create: `packages/frontend/src/config.ts`
- Create: `packages/frontend/.env.example`
- Modify: All components with hardcoded URLs

**Step 1: Create config.ts**

```typescript
// packages/frontend/src/config.ts
const getApiBaseUrl = (): string => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  return 'http://127.0.0.1:8420'
}

export const config = {
  apiBaseUrl: getApiBaseUrl(),
}

export const apiUrl = (path: string): string => {
  const base = config.apiBaseUrl.replace(/\/$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${cleanPath}`
}
```

**Step 2: Update all component URLs**

Replace all `http://127.0.0.1:8420` with `apiUrl()` calls.

**Step 3: Commit**

```bash
git add packages/frontend/
git commit -m "feat: externalize API URL configuration in frontend"
```

---

## Phase 3: Verification

### Task 3.1: Verify Desktop App Still Works

**Step 1: Run setup script**

```bash
./scripts/setup-dev.sh
```

**Step 2: Start desktop backend**

```bash
cd apps/desktop
uvicorn backend.main:app --reload --port 8420
```

**Step 3: Start frontend**

```bash
cd packages/frontend
npm run dev
```

**Step 4: Test full flow**

- Upload a video
- Process it
- Review shots
- Export clips

Expected: Everything works as before

---

### Task 3.2: Verify Webapp Works Locally (Mock Mode)

**Step 1: Create .env for local testing**

```bash
# apps/webapp/.env
GOLFCLIP_DATABASE_URL=postgres://localhost/golfclip_test
GOLFCLIP_R2_ACCOUNT_ID=test
GOLFCLIP_R2_ACCESS_KEY_ID=test
GOLFCLIP_R2_SECRET_ACCESS_KEY=test
GOLFCLIP_R2_BUCKET=test
```

**Step 2: Verify imports work**

```bash
cd apps/webapp
pip install -e .
python -c "from backend.main import app; print('OK')"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| **1. Restructure** | 7 tasks | Create monorepo, move code to packages/apps |
| **2. Webapp** | 4 tasks | Create cloud backend with R2/PostgreSQL |
| **3. Verify** | 2 tasks | Test both apps work |

**Total: 13 tasks**

After completion:
- `apps/desktop/` - Run with `uvicorn` for Mac app
- `apps/webapp/` - Deploy to Fly.io for cloud
- `packages/frontend/` - Deploy to Vercel (serves both apps)
- `packages/detection/` - Shared ML code
