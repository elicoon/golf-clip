# apps/webapp/Dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy shared packages first (better caching)
COPY packages/detection /app/packages/detection
COPY packages/api-schemas /app/packages/api-schemas

# Install shared packages
RUN pip install --no-cache-dir /app/packages/detection /app/packages/api-schemas

# Copy and install webapp
COPY apps/webapp /app/apps/webapp
RUN pip install --no-cache-dir /app/apps/webapp

# Pre-download YOLO model (baked into image)
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

# Create non-root user
RUN useradd -m -u 1000 golfclip
USER golfclip

WORKDIR /app/apps/webapp

EXPOSE 8420

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8420"]
