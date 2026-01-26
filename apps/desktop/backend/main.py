"""Main entry point for GolfClip backend."""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from backend.api.routes import router, _job_cache, _progress_queues, load_jobs_on_startup
from backend.core.config import settings
from backend.core.database import init_db, close_db, DB_PATH
from backend.detection.visual import ensure_model_downloaded, is_model_ready, get_model_status
from backend.models.job import update_job


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events."""
    # Startup
    logger.info("GolfClip backend starting up...")
    logger.info(f"Temp directory: {settings.temp_dir}")
    logger.info(f"Models directory: {settings.models_dir}")
    logger.info(f"Confidence threshold: {settings.confidence_threshold}")

    # Initialize database
    await init_db()
    logger.info(f"Database initialized at {DB_PATH}")

    # Load existing jobs into cache
    await load_jobs_on_startup()

    # Pre-download YOLO model (don't block startup if it fails)
    if await ensure_model_downloaded():
        logger.info("YOLO model is ready")
    else:
        logger.warning("YOLO model not available - will attempt download on first use")

    yield

    # Shutdown
    logger.info("GolfClip backend shutting down...")

    # Cancel any running jobs (update both cache and database)
    for job_id, job in list(_job_cache.items()):
        if job["status"] in ("pending", "processing"):
            job["cancelled"] = True
            try:
                await update_job(job_id, cancelled=True, status="cancelled")
            except Exception as e:
                logger.warning(f"Failed to update job {job_id} during shutdown: {e}")
            logger.info(f"Cancelling job {job_id} during shutdown")

    # Clear progress queues
    _progress_queues.clear()

    # Close database connection
    await close_db()

    logger.info("Shutdown complete")


app = FastAPI(
    title="GolfClip",
    description="Automated golf video editing API",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS for Tauri frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    from backend.models.job import get_all_jobs

    # Get active jobs from cache (faster) and total from database
    active_jobs = sum(1 for j in _job_cache.values() if j["status"] in ("pending", "processing"))
    all_jobs = await get_all_jobs(limit=1000, include_shots=False)

    return {
        "status": "healthy",
        "version": "0.1.0",
        "active_jobs": active_jobs,
        "total_jobs": len(all_jobs),
        "model_ready": is_model_ready(),
    }


@app.get("/api/model-status")
async def model_status():
    """Get YOLO model download status and information."""
    return get_model_status()


def main():
    """Run the FastAPI server."""
    logger.info(f"Starting GolfClip server on {settings.host}:{settings.port}")
    uvicorn.run(
        "backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    main()
