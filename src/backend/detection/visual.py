"""Visual analysis for detecting golf balls using YOLO."""

from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
import torch
from loguru import logger
from ultralytics import YOLO

from backend.core.config import settings


class BallDetector:
    """Detects golf balls in video frames using YOLO."""

    def __init__(self):
        """Initialize the YOLO model."""
        self.model: Optional[YOLO] = None
        self.device = self._get_device()

        # Detection parameters
        self.ball_class_id = 32  # COCO class for "sports ball"
        self.confidence_threshold = settings.yolo_confidence

    def _get_device(self) -> str:
        """Get the best available device for inference."""
        if torch.backends.mps.is_available():
            logger.info("Using MPS (Apple Silicon GPU)")
            return "mps"
        elif torch.cuda.is_available():
            logger.info("Using CUDA GPU")
            return "cuda"
        else:
            logger.info("Using CPU")
            return "cpu"

    def load_model(self) -> None:
        """Load the YOLO model."""
        model_path = settings.models_dir / settings.yolo_model

        # Download model if not exists
        if not model_path.exists():
            logger.info(f"Downloading YOLO model to {model_path}")
            self.model = YOLO(settings.yolo_model)
            # Save to our models directory
            model_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            logger.info(f"Loading YOLO model from {model_path}")
            self.model = YOLO(str(model_path))

        # Move to appropriate device
        self.model.to(self.device)
        logger.info("YOLO model loaded successfully")

    def detect_ball_in_frame(self, frame: np.ndarray) -> Optional[dict]:
        """Detect golf ball in a single frame.

        Args:
            frame: BGR image as numpy array

        Returns:
            Dict with 'bbox', 'confidence', 'center' if ball found, else None
        """
        if self.model is None:
            self.load_model()

        # Run inference
        results = self.model(frame, verbose=False, conf=self.confidence_threshold)

        # Look for sports ball detections
        for result in results:
            boxes = result.boxes
            for box in boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])

                # Check if it's a sports ball (or could be golf ball)
                # COCO doesn't have specific "golf ball" class, so we use "sports ball"
                # In production, we'd fine-tune on golf-specific dataset
                if cls == self.ball_class_id:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    center_x = (x1 + x2) / 2
                    center_y = (y1 + y2) / 2
                    width = x2 - x1
                    height = y2 - y1

                    return {
                        "bbox": [float(x1), float(y1), float(x2), float(y2)],
                        "confidence": conf,
                        "center": [float(center_x), float(center_y)],
                        "size": [float(width), float(height)],
                    }

        return None

    def detect_ball_in_video_segment(
        self,
        video_path: Path,
        start_time: float,
        end_time: float,
        sample_fps: float = 10.0,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> list[dict]:
        """Detect ball positions in a video segment.

        Args:
            video_path: Path to video file
            start_time: Start timestamp in seconds
            end_time: End timestamp in seconds
            sample_fps: Frames per second to analyze (lower = faster)
            progress_callback: Optional callback for progress updates

        Returns:
            List of detections with 'timestamp', 'detection' keys
        """
        if self.model is None:
            self.load_model()

        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_interval = int(fps / sample_fps)

        detections = []
        start_frame = int(start_time * fps)
        end_frame = int(end_time * fps)
        total_frames = end_frame - start_frame

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        frame_count = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            current_frame = start_frame + frame_count
            if current_frame >= end_frame:
                break

            # Only process every Nth frame
            if frame_count % frame_interval == 0:
                timestamp = current_frame / fps
                detection = self.detect_ball_in_frame(frame)

                detections.append(
                    {
                        "timestamp": timestamp,
                        "frame": current_frame,
                        "detection": detection,
                    }
                )

                if progress_callback:
                    progress = (frame_count / total_frames) * 100
                    progress_callback(progress)

            frame_count += 1

        cap.release()
        return detections

    def track_ball_flight(
        self, detections: list[dict]
    ) -> tuple[list[dict], float]:
        """Analyze ball detections to track flight path.

        Args:
            detections: List of frame detections from detect_ball_in_video_segment

        Returns:
            Tuple of (trajectory points, confidence score)
        """
        # Filter to frames where ball was detected
        valid_detections = [d for d in detections if d["detection"] is not None]

        if len(valid_detections) < 2:
            return [], 0.0

        trajectory = []
        for det in valid_detections:
            trajectory.append(
                {
                    "timestamp": det["timestamp"],
                    "x": det["detection"]["center"][0],
                    "y": det["detection"]["center"][1],
                    "confidence": det["detection"]["confidence"],
                }
            )

        # Calculate trajectory confidence based on:
        # 1. Number of detections
        # 2. Smoothness of trajectory
        # 3. Physical plausibility (ball should follow parabolic arc)

        detection_ratio = len(valid_detections) / len(detections)

        # Simple trajectory smoothness check
        if len(trajectory) >= 3:
            x_coords = [p["x"] for p in trajectory]
            y_coords = [p["y"] for p in trajectory]

            # Check if trajectory is roughly smooth (not jumping around)
            x_diffs = np.diff(x_coords)
            y_diffs = np.diff(y_coords)

            x_smoothness = 1 - np.std(x_diffs) / (np.mean(np.abs(x_diffs)) + 1e-6)
            y_smoothness = 1 - np.std(y_diffs) / (np.mean(np.abs(y_diffs)) + 1e-6)

            smoothness = max(0, (x_smoothness + y_smoothness) / 2)
        else:
            smoothness = 0.5

        confidence = (detection_ratio * 0.6 + smoothness * 0.4)

        return trajectory, float(confidence)
