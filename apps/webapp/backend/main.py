"""GolfClip Webapp - Cloud Backend."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from backend.core.config import settings
from backend.core.database import init_db, close_db


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "mode": "cloud"}


# API routes
from backend.api.routes import router
app.include_router(router, prefix="/api")
