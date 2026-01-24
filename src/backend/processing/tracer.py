"""Shot tracer rendering using OpenCV.

Renders ball flight trajectory overlays on video frames with:
- Progressive animation (line grows as ball moves)
- Glow effect (Gaussian blur on separate layer)
- Bezier curve interpolation for smooth paths
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Tuple, List
import tempfile

import cv2
import numpy as np
from loguru import logger


@dataclass
class TracerStyle:
    """Configuration for tracer visual appearance."""
    color: Tuple[int, int, int] = (255, 255, 255)  # BGR white
    line_width: int = 3
    glow_enabled: bool = True
    glow_color: Tuple[int, int, int] = (255, 255, 255)  # BGR
    glow_radius: int = 8
    glow_intensity: float = 0.5
    show_apex_marker: bool = True
    show_landing_marker: bool = True
    apex_marker_radius: int = 6
    landing_marker_radius: int = 8
    fade_tail: bool = False
    tail_length_seconds: float = 0.5  # How much trail to show behind current position

    @classmethod
    def from_dict(cls, d: dict) -> "TracerStyle":
        """Create from API dict with hex colors."""
        style = cls()
        if "color" in d:
            style.color = hex_to_bgr(d["color"])
        if "line_width" in d:
            style.line_width = d["line_width"]
        if "glow_enabled" in d:
            style.glow_enabled = d["glow_enabled"]
        if "glow_color" in d:
            style.glow_color = hex_to_bgr(d["glow_color"])
        if "glow_radius" in d:
            style.glow_radius = d["glow_radius"]
        if "show_apex_marker" in d:
            style.show_apex_marker = d["show_apex_marker"]
        if "show_landing_marker" in d:
            style.show_landing_marker = d["show_landing_marker"]
        return style


def hex_to_bgr(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color string to BGR tuple."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (b, g, r)  # OpenCV uses BGR


def bgr_to_hex(bgr: Tuple[int, int, int]) -> str:
    """Convert BGR tuple to hex string."""
    b, g, r = bgr
    return f"#{r:02x}{g:02x}{b:02x}"


class TracerRenderer:
    """Renders shot tracer overlays on video frames."""

    def __init__(self, style: Optional[TracerStyle] = None):
        self.style = style or TracerStyle()

    def render_tracer_on_frame(
        self,
        frame: np.ndarray,
        trajectory_points: List[dict],
        current_time: float,
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
    ) -> np.ndarray:
        """Render the tracer line up to current_time on a frame.

        Args:
            frame: BGR image as numpy array (modified in place)
            trajectory_points: List of dicts with timestamp, x (0-1), y (0-1)
            current_time: Current video timestamp in seconds
            frame_width: Frame width for denormalizing coordinates
            frame_height: Frame height for denormalizing coordinates
            apex_point: Optional apex point dict

        Returns:
            Frame with tracer overlay
        """
        if not trajectory_points:
            return frame

        # Filter points up to current time
        visible_points = [
            p for p in trajectory_points
            if p["timestamp"] <= current_time
        ]

        if len(visible_points) < 2:
            return frame

        # Convert normalized coords to pixel coords
        pixel_points = []
        for p in visible_points:
            px = int(p["x"] * frame_width)
            py = int(p["y"] * frame_height)
            pixel_points.append((px, py))

        # Draw the tracer
        frame = self._draw_tracer_line(frame, pixel_points)

        # Draw apex marker if we've passed it
        if self.style.show_apex_marker and apex_point:
            if apex_point["timestamp"] <= current_time:
                ax = int(apex_point["x"] * frame_width)
                ay = int(apex_point["y"] * frame_height)
                self._draw_apex_marker(frame, (ax, ay))

        # Draw landing marker at last visible point
        if self.style.show_landing_marker and len(visible_points) >= 2:
            # Check if we're at the end of the trajectory
            if visible_points[-1]["timestamp"] >= trajectory_points[-1]["timestamp"] - 0.1:
                lx, ly = pixel_points[-1]
                self._draw_landing_marker(frame, (lx, ly))

        return frame

    def _draw_tracer_line(
        self,
        frame: np.ndarray,
        points: List[Tuple[int, int]],
    ) -> np.ndarray:
        """Draw the tracer line with optional glow effect."""
        if len(points) < 2:
            return frame

        pts = np.array(points, dtype=np.int32)

        if self.style.glow_enabled:
            # Create glow on separate layer
            glow_layer = np.zeros_like(frame)

            # Draw thicker line for glow
            cv2.polylines(
                glow_layer,
                [pts],
                isClosed=False,
                color=self.style.glow_color,
                thickness=self.style.line_width + self.style.glow_radius,
                lineType=cv2.LINE_AA,
            )

            # Apply Gaussian blur for glow effect
            glow_layer = cv2.GaussianBlur(
                glow_layer,
                (self.style.glow_radius * 2 + 1, self.style.glow_radius * 2 + 1),
                0,
            )

            # Blend glow layer with frame
            frame = cv2.addWeighted(
                frame, 1.0,
                glow_layer, self.style.glow_intensity,
                0,
            )

        # Draw main tracer line
        cv2.polylines(
            frame,
            [pts],
            isClosed=False,
            color=self.style.color,
            thickness=self.style.line_width,
            lineType=cv2.LINE_AA,
        )

        return frame

    def _draw_apex_marker(self, frame: np.ndarray, point: Tuple[int, int]) -> None:
        """Draw a marker at the apex point."""
        # Draw filled circle with border
        cv2.circle(frame, point, self.style.apex_marker_radius + 2, (0, 0, 0), -1, cv2.LINE_AA)
        cv2.circle(frame, point, self.style.apex_marker_radius, self.style.color, -1, cv2.LINE_AA)

    def _draw_landing_marker(self, frame: np.ndarray, point: Tuple[int, int]) -> None:
        """Draw a marker at the landing point."""
        # Draw X marker
        r = self.style.landing_marker_radius
        color = self.style.color
        thickness = 2
        cv2.line(frame, (point[0] - r, point[1] - r), (point[0] + r, point[1] + r), color, thickness, cv2.LINE_AA)
        cv2.line(frame, (point[0] - r, point[1] + r), (point[0] + r, point[1] - r), color, thickness, cv2.LINE_AA)


class TracerExporter:
    """Exports video clips with tracer overlay."""

    def __init__(
        self,
        video_path: Path,
        style: Optional[TracerStyle] = None,
    ):
        self.video_path = Path(video_path)
        self.renderer = TracerRenderer(style)
        self.style = style or TracerStyle()

    def export_with_tracer(
        self,
        output_path: Path,
        start_time: float,
        end_time: float,
        trajectory_points: List[dict],
        frame_width: int,
        frame_height: int,
        apex_point: Optional[dict] = None,
        progress_callback: Optional[Callable[[float], None]] = None,
    ) -> Path:
        """Export a clip with tracer overlay rendered frame-by-frame.

        Args:
            output_path: Where to save the output video
            start_time: Clip start time in seconds
            end_time: Clip end time in seconds
            trajectory_points: Normalized trajectory points
            frame_width: Original frame width for coordinate scaling
            frame_height: Original frame height
            apex_point: Optional apex point for marker
            progress_callback: Called with progress 0-100

        Returns:
            Path to output video
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {self.video_path}")

        # Use temp file for video without audio, then add audio back
        temp_video = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        temp_video_path = temp_video.name
        temp_video.close()

        writer = None
        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            # Set up video writer
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(temp_video_path, fourcc, fps, (width, height))

            if not writer.isOpened():
                raise ValueError("Could not create video writer")

            # Seek to start
            start_frame = int(start_time * fps)
            end_frame = int(end_time * fps)
            total_frames = end_frame - start_frame

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            frame_count = 0
            while cap.isOpened() and frame_count < total_frames:
                ret, frame = cap.read()
                if not ret:
                    break

                # Calculate current time relative to video start
                current_time = start_time + (frame_count / fps)

                # Render tracer
                frame = self.renderer.render_tracer_on_frame(
                    frame,
                    trajectory_points,
                    current_time,
                    width,
                    height,
                    apex_point,
                )

                writer.write(frame)
                frame_count += 1

                if progress_callback and frame_count % 30 == 0:
                    progress = (frame_count / total_frames) * 100
                    progress_callback(min(99, progress))

            writer.release()
            writer = None  # Mark as released

            # Add audio from original using ffmpeg
            self._add_audio(temp_video_path, output_path, start_time, end_time)

            if progress_callback:
                progress_callback(100)

            logger.info(f"Exported clip with tracer to {output_path}")
            return output_path

        finally:
            cap.release()
            if writer is not None:
                writer.release()
            # Clean up temp file
            Path(temp_video_path).unlink(missing_ok=True)

    def _add_audio(
        self,
        video_path: str,
        output_path: Path,
        start_time: float,
        end_time: float,
    ) -> None:
        """Add audio from original video to the tracer video."""
        import subprocess

        duration = end_time - start_time

        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,  # Video with tracer (no audio)
            "-ss", str(start_time),
            "-t", str(duration),
            "-i", str(self.video_path),  # Original video (for audio)
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-c:a", "aac",
            "-map", "0:v:0",
            "-map", "1:a:0?",
            "-shortest",
            str(output_path),
        ]

        try:
            subprocess.run(cmd, check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            logger.warning(f"Failed to add audio: {e.stderr.decode() if e.stderr else e}")
            # Fall back to video without audio
            import shutil
            shutil.copy(video_path, output_path)
