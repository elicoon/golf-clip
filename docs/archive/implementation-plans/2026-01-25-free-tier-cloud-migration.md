# Free-Tier Cloud Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert GolfClip from a Mac desktop app to a cloud-hosted webapp using free-tier services with a "process and delete" model.

**Architecture:**
- Frontend: React SPA on Vercel (free)
- Backend: FastAPI on Fly.io (free tier - 256MB RAM)
- Database: Neon PostgreSQL (free tier - 0.5GB)
- Storage: Cloudflare R2 (free tier - 10GB, no egress fees)
- Model: "Process and Delete" - videos are deleted after export to stay within storage limits

**Tech Stack:** FastAPI, PostgreSQL (asyncpg), Cloudflare R2 (boto3), React/Vite, Vercel, Fly.io

---

## Phase 1: Frontend Configuration Externalization

### Task 1.1: Create API Configuration Module

**Files:**
- Create: `src/frontend/src/config.ts`
- Modify: `src/frontend/src/components/VideoDropzone.tsx`
- Modify: `src/frontend/src/components/ProcessingView.tsx`
- Modify: `src/frontend/src/components/ClipReview.tsx`
- Modify: `src/frontend/src/components/ExportComplete.tsx`
- Modify: `src/frontend/src/App.tsx`

**Step 1: Create the config module**

```typescript
// src/frontend/src/config.ts
const getApiBaseUrl = (): string => {
  // Vite exposes env vars with VITE_ prefix
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  // Default to localhost for development
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

**Step 2: Create .env.example**

```bash
# src/frontend/.env.example
# API URL for the GolfClip backend
VITE_API_URL=http://127.0.0.1:8420
```

**Step 3: Update VideoDropzone.tsx**

Replace line 149:
```typescript
// Before
xhr.open('POST', 'http://127.0.0.1:8420/api/upload')

// After
import { apiUrl } from '../config'
// ...
xhr.open('POST', apiUrl('/api/upload'))
```

**Step 4: Update ProcessingView.tsx**

Replace line 36:
```typescript
// Before
const BASE_URL = 'http://127.0.0.1:8420'

// After
import { config } from '../config'
const BASE_URL = config.apiBaseUrl
```

**Step 5: Update ClipReview.tsx**

Replace all hardcoded URLs (lines 118, 343, 415, 464, 626, 1131, 1151):
```typescript
import { apiUrl } from '../config'

// Line 118
fetch(apiUrl(`/api/trajectory/${jobId}/${currentShot.id}`))

// Line 343
const response = await fetch(apiUrl(`/api/shots/${jobId}/update`), {

// Line 415
const response = await fetch(apiUrl('/api/export'), {

// Line 464
const response = await fetch(apiUrl(`/api/export/${exportJobId}/status`))

// Line 626
const url = apiUrl(`/api/trajectory/${jobId}/${currentShot.id}/generate?${params}`)

// Line 1131
src={apiUrl(`/api/video?path=${encodeURIComponent(videoPath)}`)}

// Line 1151
fetch(apiUrl(`/api/trajectory/${jobId}/${currentShot.id}`), {
```

**Step 6: Update ExportComplete.tsx**

Replace lines 90 and 165:
```typescript
import { apiUrl } from '../config'

// Line 90
apiUrl(`/api/video?path=${encodeURIComponent(path)}&download=true`)

// Line 165
const response = await fetch(apiUrl(`/api/feedback/${jobId}`), {
```

**Step 7: Update App.tsx**

Replace line 52:
```typescript
import { apiUrl } from './config'

// Line 52
const response = await fetch(apiUrl('/api/process'), {
```

**Step 8: Verify build works**

Run: `cd src/frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 9: Commit**

```bash
git add src/frontend/src/config.ts src/frontend/.env.example src/frontend/src/components/*.tsx src/frontend/src/App.tsx
git commit -m "feat: externalize API URL configuration for cloud deployment"
```

---

### Task 1.2: Remove Tauri Dependencies

**Files:**
- Modify: `src/frontend/package.json`
- Modify: `src/frontend/src/components/VideoDropzone.tsx`
- Delete: `src/frontend/src-tauri/` (if exists)

**Step 1: Update package.json**

Remove Tauri dependencies and script:
```json
{
  "name": "golfclip-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.17.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.12"
  }
}
```

**Step 2: Remove Tauri imports from VideoDropzone.tsx**

Remove Tauri-specific code paths (lines that import from `@tauri-apps/api`). The component already has web fallback logic.

**Step 3: Clean install dependencies**

Run: `cd src/frontend && rm -rf node_modules package-lock.json && npm install`
Expected: Clean install without Tauri packages

**Step 4: Verify app works in browser**

Run: `cd src/frontend && npm run dev`
Expected: App loads at http://localhost:5173 without Tauri errors

**Step 5: Commit**

```bash
git add src/frontend/package.json src/frontend/src/components/VideoDropzone.tsx
git commit -m "chore: remove Tauri dependencies for web-only deployment"
```

---

## Phase 2: Backend Cloud Storage Integration

### Task 2.1: Add R2/S3 Storage Abstraction

**Files:**
- Create: `src/backend/core/storage.py`
- Create: `src/backend/tests/test_storage.py`
- Modify: `src/backend/core/config.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_storage.py
import pytest
from pathlib import Path
from backend.core.storage import StorageBackend, LocalStorage, get_storage

def test_local_storage_upload_download(tmp_path):
    """Test local storage backend can upload and download files."""
    storage = LocalStorage(base_path=tmp_path)

    # Create test file
    test_content = b"test video content"

    # Upload
    key = storage.upload(test_content, "test.mp4")
    assert key == "test.mp4"

    # Download
    downloaded = storage.download(key)
    assert downloaded == test_content

def test_local_storage_delete(tmp_path):
    """Test local storage backend can delete files."""
    storage = LocalStorage(base_path=tmp_path)

    # Upload
    storage.upload(b"content", "test.mp4")

    # Delete
    storage.delete("test.mp4")

    # Verify deleted
    with pytest.raises(FileNotFoundError):
        storage.download("test.mp4")

def test_get_storage_returns_local_by_default():
    """Test get_storage returns LocalStorage when no R2 config."""
    storage = get_storage()
    assert isinstance(storage, LocalStorage)
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && pytest tests/test_storage.py -v`
Expected: FAIL with "No module named 'backend.core.storage'"

**Step 3: Write minimal implementation**

```python
# src/backend/core/storage.py
"""Storage abstraction for local filesystem and Cloudflare R2."""

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional, BinaryIO
import uuid

from loguru import logger


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    def upload(self, content: bytes, filename: str) -> str:
        """Upload content and return the storage key."""
        pass

    @abstractmethod
    def upload_file(self, file_path: Path, filename: Optional[str] = None) -> str:
        """Upload a file from disk and return the storage key."""
        pass

    @abstractmethod
    def download(self, key: str) -> bytes:
        """Download content by key."""
        pass

    @abstractmethod
    def download_to_file(self, key: str, destination: Path) -> Path:
        """Download to a local file path."""
        pass

    @abstractmethod
    def delete(self, key: str) -> None:
        """Delete content by key."""
        pass

    @abstractmethod
    def get_url(self, key: str, expires_in: int = 3600) -> str:
        """Get a URL for accessing the content (signed URL for R2)."""
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check if a key exists."""
        pass


class LocalStorage(StorageBackend):
    """Local filesystem storage backend."""

    def __init__(self, base_path: Optional[Path] = None):
        if base_path is None:
            base_path = Path.home() / ".golfclip" / "storage"
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _key_to_path(self, key: str) -> Path:
        # Sanitize key to prevent path traversal
        safe_key = key.replace("..", "").lstrip("/")
        return self.base_path / safe_key

    def upload(self, content: bytes, filename: str) -> str:
        """Upload content and return the storage key."""
        # Generate unique key
        unique_id = str(uuid.uuid4())[:8]
        key = f"{unique_id}_{filename}"

        path = self._key_to_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

        logger.debug(f"LocalStorage: uploaded {len(content)} bytes to {key}")
        return key

    def upload_file(self, file_path: Path, filename: Optional[str] = None) -> str:
        """Upload a file from disk and return the storage key."""
        if filename is None:
            filename = file_path.name

        unique_id = str(uuid.uuid4())[:8]
        key = f"{unique_id}_{filename}"

        dest_path = self._key_to_path(key)
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Copy file
        import shutil
        shutil.copy2(file_path, dest_path)

        logger.debug(f"LocalStorage: uploaded file {file_path} to {key}")
        return key

    def download(self, key: str) -> bytes:
        """Download content by key."""
        path = self._key_to_path(key)
        if not path.exists():
            raise FileNotFoundError(f"Key not found: {key}")
        return path.read_bytes()

    def download_to_file(self, key: str, destination: Path) -> Path:
        """Download to a local file path."""
        path = self._key_to_path(key)
        if not path.exists():
            raise FileNotFoundError(f"Key not found: {key}")

        import shutil
        shutil.copy2(path, destination)
        return destination

    def delete(self, key: str) -> None:
        """Delete content by key."""
        path = self._key_to_path(key)
        if path.exists():
            path.unlink()
            logger.debug(f"LocalStorage: deleted {key}")

    def get_url(self, key: str, expires_in: int = 3600) -> str:
        """Get a URL for accessing the content (file:// for local)."""
        path = self._key_to_path(key)
        return f"file://{path.absolute()}"

    def exists(self, key: str) -> bool:
        """Check if a key exists."""
        return self._key_to_path(key).exists()


class R2Storage(StorageBackend):
    """Cloudflare R2 storage backend (S3-compatible)."""

    def __init__(
        self,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str,
    ):
        import boto3

        self.bucket_name = bucket_name
        self.endpoint_url = f"https://{account_id}.r2.cloudflarestorage.com"

        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

        logger.info(f"R2Storage: initialized for bucket {bucket_name}")

    def upload(self, content: bytes, filename: str) -> str:
        """Upload content and return the storage key."""
        unique_id = str(uuid.uuid4())[:8]
        key = f"uploads/{unique_id}_{filename}"

        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=content,
        )

        logger.debug(f"R2Storage: uploaded {len(content)} bytes to {key}")
        return key

    def upload_file(self, file_path: Path, filename: Optional[str] = None) -> str:
        """Upload a file from disk and return the storage key."""
        if filename is None:
            filename = file_path.name

        unique_id = str(uuid.uuid4())[:8]
        key = f"uploads/{unique_id}_{filename}"

        self.client.upload_file(str(file_path), self.bucket_name, key)

        logger.debug(f"R2Storage: uploaded file {file_path} to {key}")
        return key

    def download(self, key: str) -> bytes:
        """Download content by key."""
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    def download_to_file(self, key: str, destination: Path) -> Path:
        """Download to a local file path."""
        self.client.download_file(self.bucket_name, key, str(destination))
        return destination

    def delete(self, key: str) -> None:
        """Delete content by key."""
        self.client.delete_object(Bucket=self.bucket_name, Key=key)
        logger.debug(f"R2Storage: deleted {key}")

    def get_url(self, key: str, expires_in: int = 3600) -> str:
        """Get a presigned URL for accessing the content."""
        url = self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )
        return url

    def exists(self, key: str) -> bool:
        """Check if a key exists."""
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except self.client.exceptions.ClientError:
            return False


# Singleton storage instance
_storage_instance: Optional[StorageBackend] = None


def get_storage() -> StorageBackend:
    """Get the configured storage backend."""
    global _storage_instance

    if _storage_instance is not None:
        return _storage_instance

    # Check for R2 configuration
    r2_account_id = os.environ.get("GOLFCLIP_R2_ACCOUNT_ID")
    r2_access_key = os.environ.get("GOLFCLIP_R2_ACCESS_KEY_ID")
    r2_secret_key = os.environ.get("GOLFCLIP_R2_SECRET_ACCESS_KEY")
    r2_bucket = os.environ.get("GOLFCLIP_R2_BUCKET")

    if all([r2_account_id, r2_access_key, r2_secret_key, r2_bucket]):
        logger.info("Using Cloudflare R2 storage backend")
        _storage_instance = R2Storage(
            account_id=r2_account_id,
            access_key_id=r2_access_key,
            secret_access_key=r2_secret_key,
            bucket_name=r2_bucket,
        )
    else:
        logger.info("Using local filesystem storage backend")
        _storage_instance = LocalStorage()

    return _storage_instance
```

**Step 4: Run tests to verify they pass**

Run: `cd src/backend && pytest tests/test_storage.py -v`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backend/core/storage.py src/backend/tests/test_storage.py
git commit -m "feat: add storage abstraction for local and R2 backends"
```

---

### Task 2.2: Update Config for Cloud Settings

**Files:**
- Modify: `src/backend/core/config.py`

**Step 1: Add cloud configuration options**

```python
# src/backend/core/config.py
"""Application configuration."""

from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings."""

    # Server
    host: str = "127.0.0.1"
    port: int = 8420
    debug: bool = True

    # Paths (local mode)
    temp_dir: Path = Path.home() / ".golfclip" / "temp"
    models_dir: Path = Path.home() / ".golfclip" / "models"

    # Processing
    confidence_threshold: float = 0.70
    clip_padding_before: float = 2.0
    clip_padding_after: float = 2.0

    # ML Models
    yolo_model: str = "yolov8n.pt"
    yolo_confidence: float = 0.03
    audio_sample_rate: int = 44100
    audio_sensitivity: float = 0.5

    # FFmpeg
    ffmpeg_threads: int = 0
    ffmpeg_timeout: int = 600

    # === Cloud Configuration ===

    # Cloudflare R2 (S3-compatible storage)
    r2_account_id: Optional[str] = None
    r2_access_key_id: Optional[str] = None
    r2_secret_access_key: Optional[str] = None
    r2_bucket: Optional[str] = None

    # Database URL (PostgreSQL for cloud, SQLite for local)
    database_url: Optional[str] = None

    # Storage mode: "local" or "cloud"
    storage_mode: str = "local"

    # Auto-cleanup: delete source videos after export (for free tier)
    auto_cleanup_after_export: bool = False

    # CORS origins for production
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    class Config:
        env_prefix = "GOLFCLIP_"
        env_file = ".env"

    @property
    def is_cloud_mode(self) -> bool:
        """Check if running in cloud mode (R2 + PostgreSQL)."""
        return bool(self.r2_bucket and self.database_url)


settings = Settings()

# Ensure directories exist (only in local mode)
if not settings.is_cloud_mode:
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    settings.models_dir.mkdir(parents=True, exist_ok=True)
```

**Step 2: Verify config loads**

Run: `cd src/backend && python -c "from backend.core.config import settings; print(settings.is_cloud_mode)"`
Expected: Prints `False`

**Step 3: Commit**

```bash
git add src/backend/core/config.py
git commit -m "feat: add cloud configuration options (R2, PostgreSQL, CORS)"
```

---

## Phase 3: Database Migration (SQLite → PostgreSQL)

### Task 3.1: Add PostgreSQL Support with asyncpg

**Files:**
- Modify: `src/backend/core/database.py`
- Create: `src/backend/tests/test_database_postgres.py`

**Step 1: Install asyncpg dependency**

```bash
cd golf-clip && pip install asyncpg
```

Add to `pyproject.toml` or `setup.py` dependencies.

**Step 2: Create database abstraction**

Update `src/backend/core/database.py` to support both SQLite and PostgreSQL:

```python
# Add at top of database.py after existing imports
import os
from urllib.parse import urlparse

# Check for PostgreSQL URL
DATABASE_URL = os.environ.get("GOLFCLIP_DATABASE_URL")
USE_POSTGRES = DATABASE_URL and DATABASE_URL.startswith("postgres")

if USE_POSTGRES:
    import asyncpg
    _pg_pool: Optional[asyncpg.Pool] = None
```

The full implementation converts all SQL to be PostgreSQL-compatible (using `$1, $2` parameters instead of `?`).

This is a larger refactor - see Task 3.2 for the complete database abstraction layer.

**Step 3: Commit**

```bash
git add src/backend/core/database.py pyproject.toml
git commit -m "feat: add PostgreSQL support alongside SQLite"
```

---

### Task 3.2: Create Database Abstraction Layer

**Files:**
- Create: `src/backend/core/db/__init__.py`
- Create: `src/backend/core/db/base.py`
- Create: `src/backend/core/db/sqlite.py`
- Create: `src/backend/core/db/postgres.py`

This task creates a proper abstraction so the same queries work with both databases.

[Implementation details omitted for brevity - follows same TDD pattern]

---

## Phase 4: Update API Routes for Cloud Storage

### Task 4.1: Update Upload Endpoint to Use Storage Backend

**Files:**
- Modify: `src/backend/api/routes.py`

**Step 1: Update /upload endpoint**

```python
# In routes.py, update upload_video function

from backend.core.storage import get_storage

@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    # Validate file type
    allowed_extensions = {".mp4", ".mov", ".m4v"}
    file_ext = Path(file.filename or "").suffix.lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    storage = get_storage()

    try:
        # Read file content
        content = await file.read()

        # Upload to storage backend
        key = storage.upload(content, file.filename)

        logger.info(f"Uploaded video: {key} ({len(content)} bytes)")

        return {
            "storage_key": key,
            "filename": file.filename,
            "size": len(content),
        }

    except Exception as e:
        logger.exception(f"Failed to upload file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")
```

**Step 2: Update /video streaming endpoint**

```python
@router.get("/video")
async def stream_video(
    key: Optional[str] = None,
    path: Optional[str] = None,  # Backward compatibility
    request: Request,
    download: bool = False
):
    """Stream a video file for playback."""
    storage = get_storage()

    # Support both storage key (cloud) and path (local/legacy)
    if key:
        # Cloud mode: use storage backend
        if not storage.exists(key):
            raise HTTPException(status_code=404, detail="Video not found")

        # For R2, redirect to presigned URL
        if hasattr(storage, 'get_url'):
            url = storage.get_url(key, expires_in=3600)
            return RedirectResponse(url=url)

        # For local, stream from disk
        # ... existing streaming logic
    elif path:
        # Legacy local path support
        # ... existing logic
    else:
        raise HTTPException(status_code=400, detail="Must provide key or path")
```

**Step 3: Commit**

```bash
git add src/backend/api/routes.py
git commit -m "feat: update upload/video endpoints to use storage abstraction"
```

---

### Task 4.2: Add Cleanup Endpoint for Process-and-Delete Model

**Files:**
- Modify: `src/backend/api/routes.py`

**Step 1: Add cleanup endpoint**

```python
@router.post("/cleanup/{job_id}")
async def cleanup_job_files(job_id: str):
    """Delete source video and temporary files for a job.

    Called after successful export to free up storage space.
    """
    job = await get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    storage = get_storage()
    deleted_files = []

    # Delete source video if it's in storage
    if job.get("storage_key"):
        try:
            storage.delete(job["storage_key"])
            deleted_files.append(job["storage_key"])
        except Exception as e:
            logger.warning(f"Failed to delete source video: {e}")

    # Update job to mark as cleaned up
    await update_job(job_id, storage_key=None, cleaned_up=True)

    return {
        "status": "cleaned",
        "job_id": job_id,
        "deleted_files": deleted_files,
    }
```

**Step 2: Commit**

```bash
git add src/backend/api/routes.py
git commit -m "feat: add cleanup endpoint for process-and-delete model"
```

---

## Phase 5: Deployment Configuration

### Task 5.1: Create Dockerfile for Backend

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Create Dockerfile**

```dockerfile
# Dockerfile
FROM python:3.11-slim

# Install ffmpeg and other system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml setup.py ./
COPY src/backend ./src/backend
RUN pip install -e .

# Pre-download YOLO model to bake into image
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Expose port
EXPOSE 8420

# Run with uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8420"]
```

**Step 2: Create .dockerignore**

```
# .dockerignore
.git
.venv
__pycache__
*.pyc
*.pyo
.env
.env.*
node_modules
src/frontend
*.mp4
*.mov
docs/
```

**Step 3: Test Docker build**

Run: `docker build -t golfclip-backend .`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "chore: add Dockerfile for backend deployment"
```

---

### Task 5.2: Create Fly.io Configuration

**Files:**
- Create: `fly.toml`

**Step 1: Create fly.toml**

```toml
# fly.toml
app = "golfclip-api"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[env]
  GOLFCLIP_HOST = "0.0.0.0"
  GOLFCLIP_PORT = "8420"
  GOLFCLIP_DEBUG = "false"
  GOLFCLIP_STORAGE_MODE = "cloud"
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

**Step 2: Commit**

```bash
git add fly.toml
git commit -m "chore: add Fly.io deployment configuration"
```

---

### Task 5.3: Create Vercel Configuration for Frontend

**Files:**
- Create: `src/frontend/vercel.json`

**Step 1: Create vercel.json**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

**Step 2: Commit**

```bash
git add src/frontend/vercel.json
git commit -m "chore: add Vercel deployment configuration"
```

---

## Phase 6: Integration Testing

### Task 6.1: Create End-to-End Test Script

**Files:**
- Create: `scripts/test_cloud_integration.py`

This script tests the full flow:
1. Upload video to R2
2. Process with Fly.io backend
3. Download exported clips
4. Verify cleanup works

[Implementation details follow same TDD pattern]

---

## Deployment Checklist

### Pre-Deployment
- [ ] Create Neon PostgreSQL database
- [ ] Create Cloudflare R2 bucket
- [ ] Set up Fly.io account and install flyctl
- [ ] Set up Vercel account

### Environment Variables (Fly.io Secrets)
```bash
fly secrets set GOLFCLIP_DATABASE_URL="postgres://..."
fly secrets set GOLFCLIP_R2_ACCOUNT_ID="..."
fly secrets set GOLFCLIP_R2_ACCESS_KEY_ID="..."
fly secrets set GOLFCLIP_R2_SECRET_ACCESS_KEY="..."
fly secrets set GOLFCLIP_R2_BUCKET="golfclip-videos"
fly secrets set GOLFCLIP_CORS_ORIGINS="https://golfclip.vercel.app"
```

### Deploy Backend
```bash
fly deploy
```

### Environment Variables (Vercel)
```
VITE_API_URL=https://golfclip-api.fly.dev
```

### Deploy Frontend
```bash
cd src/frontend
vercel --prod
```

---

## Summary

| Phase | Tasks | Files Changed |
|-------|-------|---------------|
| 1. Frontend Config | 2 tasks | 7 files |
| 2. Cloud Storage | 2 tasks | 3 files |
| 3. Database Migration | 2 tasks | 5 files |
| 4. API Updates | 2 tasks | 1 file |
| 5. Deployment Config | 3 tasks | 4 files |
| 6. Integration Testing | 1 task | 1 file |

**Total: 12 tasks, ~20 files**

Estimated implementation time with TDD approach: Execute sequentially using superpowers:executing-plans.
