# CLAUDE.md - GolfClip

## Project Overview

AI-powered golf clip detection and export tool. Analyzes video to detect golf shots using audio transient detection and visual ball tracking, then exports trimmed clips.

## Tech Stack

- **Backend**: FastAPI + Python 3.11+
- **Audio Processing**: librosa, ffmpeg-python
- **Video Processing**: OpenCV, ffmpeg
- **Database**: SQLite with aiosqlite (async)
- **Testing**: pytest with async support

## Project Structure

```
golf-clip/
├── src/
│   └── backend/
│       ├── api/              # FastAPI routes and endpoints
│       ├── core/             # Database, config, settings
│       ├── detection/        # Shot detection algorithms
│       │   ├── audio.py      # Audio transient detection
│       │   └── visual.py     # Visual ball tracking
│       ├── export/           # Video clip export
│       ├── models/           # Pydantic models and DB schemas
│       └── tests/            # Integration tests
│           ├── conftest.py   # Pytest fixtures
│           └── test_*.py     # Test files
└── PRD.md
```

## Development Commands

```bash
# Run backend server
cd golf-clip/src/backend
uvicorn main:app --reload

# Run tests
cd golf-clip/src/backend
pytest tests/ -v

# Run specific test file
pytest tests/test_integration.py -v

# Skip slow tests
pytest tests/ -v -m "not slow"
```

## Windows/FFmpeg Notes

- **ffmpeg via winget**: Installed but NOT in PATH by default
- Location: `~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/`
- `conftest.py` automatically detects and adds ffmpeg to PATH for tests
- If ffmpeg tests skip, verify winget installation or add ffmpeg bin to system PATH

## Testing Patterns

### Database Isolation
Tests use isolated SQLite databases via `unittest.mock.patch`:
```python
with patch("backend.core.database.DB_PATH", TEST_DB_PATH):
    from backend.main import app
    # App uses test database
```

### Async in Sync Tests
Use `asyncio.new_event_loop()` for async DB calls in synchronous test code:
```python
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
try:
    loop.run_until_complete(async_db_function())
finally:
    loop.close()
```

### Dynamic Module Access
When patching before import, use proxy classes for module-level state:
```python
class JobCacheProxy:
    def __getitem__(self, key):
        from backend.api.routes import _job_cache
        return _job_cache[key]
```

## API Endpoints

- `POST /api/jobs` - Create new detection job
- `GET /api/jobs` - List all jobs
- `GET /api/jobs/{id}` - Get job details
- `GET /api/jobs/{id}/progress` - SSE progress stream
- `PUT /api/jobs/{id}/shots` - Update detected shots
- `POST /api/jobs/{id}/export` - Export clips
- `GET /api/exports/{id}/download` - Download exported file

## Detection Pipeline

1. **Audio Detection**: Analyze audio for transient peaks (golf strike sounds)
2. **Visual Detection**: Track ball movement using optical flow
3. **Confidence Scoring**: Combine audio/visual signals with confidence thresholds
4. **Review**: User reviews and adjusts detected shots
5. **Export**: Trim and export selected clips with customizable pre/post padding
