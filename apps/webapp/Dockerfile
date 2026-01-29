# apps/webapp/Dockerfile
# Multi-stage build to keep image under 8GB

# =============================================================================
# Stage 1: Builder - Install all dependencies
# =============================================================================
FROM python:3.11-slim AS builder

# Install build dependencies for OpenCV/ultralytics
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch FIRST (before anything can pull CUDA version)
RUN pip install --no-cache-dir \
    torch==2.2.0+cpu \
    torchvision==0.17.0+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# Copy and install shared packages
COPY packages/api-schemas /app/packages/api-schemas
COPY packages/detection /app/packages/detection

RUN pip install --no-cache-dir /app/packages/api-schemas && \
    pip install --no-cache-dir /app/packages/detection

# Install ultralytics - it will use the already-installed CPU torch
RUN pip install --no-cache-dir ultralytics

# Install remaining dependencies
RUN pip install --no-cache-dir \
    librosa \
    scipy \
    ffmpeg-python \
    opencv-python-headless

# Copy and install webapp
COPY apps/webapp /app/apps/webapp
RUN pip install --no-cache-dir /app/apps/webapp

# Pre-download YOLO model
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# =============================================================================
# Stage 2: Runtime - Copy only what's needed
# =============================================================================
FROM python:3.11-slim AS runtime

# Install system dependencies (ffmpeg for video processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy Python packages from builder (excludes build artifacts and caches)
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --from=builder /app/apps/webapp /app/apps/webapp
COPY --from=builder /app/packages /app/packages

# Copy pre-downloaded YOLO model from builder's working directory
COPY --from=builder /app/yolov8n.pt /app/yolov8n.pt

# Create non-root user
RUN useradd -m -u 1000 golfclip && \
    chown -R golfclip:golfclip /app

USER golfclip
WORKDIR /app/apps/webapp

EXPOSE 8420

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8420"]
