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
    # Core line appearance
    color: Tuple[int, int, int] = (255, 255, 255)  # BGR white
    line_width: int = 3

    # Glow settings
    glow_enabled: bool = True
    glow_color: Tuple[int, int, int] = (255, 255, 255)  # BGR
    glow_radius: int = 8
    glow_intensity: float = 0.5

    # Markers
    show_apex_marker: bool = True
    show_landing_marker: bool = True
    apex_marker_radius: int = 6
    landing_marker_radius: int = 8

    # Legacy fields (kept for backwards compatibility)
    fade_tail: bool = False

    # Enhanced rendering mode
    style_mode: str = "hybrid"  # "solid", "comet", or "hybrid"
    tail_length_seconds: float = 0.4  # How much trail to show behind current position
    tail_fade: bool = True  # Fade opacity along tail
    tail_width_taper: bool = True  # Taper width along tail
    perspective_width: bool = True  # Scale width by depth
    min_line_width: float = 1.0  # Minimum width at far distance

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
        # Enhanced rendering options
        if "style_mode" in d:
            style.style_mode = d["style_mode"]
        if "tail_length_seconds" in d:
            style.tail_length_seconds = d["tail_length_seconds"]
        if "tail_fade" in d:
            style.tail_fade = d["tail_fade"]
        if "tail_width_taper" in d:
            style.tail_width_taper = d["tail_width_taper"]
        if "perspective_width" in d:
            style.perspective_width = d["perspective_width"]
        if "min_line_width" in d:
            style.min_line_width = d["min_line_width"]
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
        timestamps = []
        for p in visible_points:
            px = int(p["x"] * frame_width)
            py = int(p["y"] * frame_height)
            pixel_points.append((px, py))
            timestamps.append(p["timestamp"])

        # Estimate depths for perspective width (based on Y position)
        # Higher on screen = farther away (closer to vanishing point)
        depths = None
        if self.style.perspective_width:
            # Estimate origin Y from first point (ball starts low on screen)
            origin_y = 0.8 * frame_height
            vanishing_y = 0.35 * frame_height
            max_depth = 5000.0
            depths = []
            for px, py in pixel_points:
                if py >= origin_y:
                    depth = 0.0
                elif py <= vanishing_y:
                    depth = max_depth
                else:
                    progress = (origin_y - py) / (origin_y - vanishing_y)
                    depth = progress * max_depth
                depths.append(depth)

        # Render based on style mode
        if self.style.style_mode == "comet":
            # Comet tail only - fading trail behind current position
            frame = self._draw_comet_tail(
                frame, pixel_points, timestamps, current_time, depths
            )
        elif self.style.style_mode == "hybrid":
            # Hybrid: solid line underneath, then comet overlay for emphasis
            # Draw fainter solid line first (shows full path)
            solid_frame = frame.copy()
            solid_frame = self._draw_tracer_line(solid_frame, pixel_points)
            # Blend solid line at reduced opacity
            cv2.addWeighted(solid_frame, 0.4, frame, 0.6, 0, frame)
            # Draw comet tail on top for current position emphasis
            frame = self._draw_comet_tail(
                frame, pixel_points, timestamps, current_time, depths
            )
        else:
            # Solid mode - original behavior
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

    def _perspective_width(
        self,
        base_width: float,
        depth: float,
        focal_length: float = 1000.0,
    ) -> float:
        """Calculate line width at given depth for perspective effect.

        Lines appear thinner as they go into the distance.

        Args:
            base_width: Base line width in pixels
            depth: Z-depth value (0 = near camera, larger = farther)
            focal_length: Controls perspective strength

        Returns:
            Adjusted line width, never below min_line_width
        """
        if depth <= 0:
            return base_width
        scale = focal_length / (focal_length + depth)
        return max(base_width * scale, self.style.min_line_width)

    def _draw_head_marker(
        self,
        frame: np.ndarray,
        point: Tuple[int, int],
        width: int = 6,
    ) -> None:
        """Draw a bright marker at the current ball position (head of comet).

        Args:
            frame: BGR image to draw on
            point: Pixel coordinates (x, y)
            width: Marker diameter
        """
        # Draw outer glow
        if self.style.glow_enabled:
            cv2.circle(
                frame,
                point,
                width + self.style.glow_radius // 2,
                self.style.glow_color,
                -1,
                cv2.LINE_AA,
            )
        # Draw bright center
        cv2.circle(frame, point, width // 2, self.style.color, -1, cv2.LINE_AA)

    def _draw_segment_with_glow(
        self,
        frame: np.ndarray,
        p1: Tuple[int, int],
        p2: Tuple[int, int],
        alpha: float,
        width: int,
    ) -> None:
        """Draw a single line segment with glow at specified opacity.

        Args:
            frame: BGR image to draw on (modified in place)
            p1: Start point (x, y) in pixels
            p2: End point (x, y) in pixels
            alpha: Opacity 0-1
            width: Line width in pixels
        """
        if alpha < 0.05:
            return

        # Ensure minimum width
        width = max(int(width), int(self.style.min_line_width))

        # Create overlay for alpha blending
        overlay = frame.copy()

        if self.style.glow_enabled:
            # Draw glow first (thicker line)
            glow_width = width + self.style.glow_radius
            cv2.line(
                overlay, p1, p2,
                self.style.glow_color,
                glow_width,
                cv2.LINE_AA,
            )

        # Draw main line
        cv2.line(overlay, p1, p2, self.style.color, width, cv2.LINE_AA)

        # Blend with alpha
        blend_alpha = alpha * self.style.glow_intensity
        cv2.addWeighted(overlay, blend_alpha, frame, 1 - blend_alpha, 0, frame)

    def _draw_comet_tail(
        self,
        frame: np.ndarray,
        points: List[Tuple[int, int]],
        timestamps: List[float],
        current_time: float,
        depths: Optional[List[float]] = None,
    ) -> np.ndarray:
        """Draw tracer with comet tail effect.

        The comet effect shows only a trailing portion of the trajectory
        with opacity and width fading toward the tail.

        Args:
            frame: BGR image to draw on
            points: Pixel coordinates for each point
            timestamps: Time for each point
            current_time: Current video time
            depths: Optional Z-depth for each point (for perspective width)

        Returns:
            Frame with comet tail rendered
        """
        if len(points) < 2 or len(timestamps) < 2:
            return frame

        tail_start_time = current_time - self.style.tail_length_seconds

        # Find points in the tail range
        tail_points = []
        tail_alphas = []
        tail_widths = []

        for i, (pt, t) in enumerate(zip(points, timestamps)):
            if tail_start_time <= t <= current_time:
                # Calculate fade (1.0 at head, 0.0 at tail end)
                if self.style.tail_length_seconds > 0:
                    progress = (t - tail_start_time) / self.style.tail_length_seconds
                else:
                    progress = 1.0

                alpha = progress if self.style.tail_fade else 1.0

                # Calculate width
                width = float(self.style.line_width)
                if self.style.tail_width_taper:
                    # Width tapers from 50% to 100% along the tail
                    width = width * (0.5 + 0.5 * progress)

                if self.style.perspective_width and depths and i < len(depths):
                    width = self._perspective_width(width, depths[i])

                width = max(width, self.style.min_line_width)

                tail_points.append(pt)
                tail_alphas.append(alpha)
                tail_widths.append(width)

        if len(tail_points) < 2:
            return frame

        # Draw segments with varying alpha and width
        for i in range(len(tail_points) - 1):
            avg_alpha = (tail_alphas[i] + tail_alphas[i + 1]) / 2
            avg_width = int((tail_widths[i] + tail_widths[i + 1]) / 2)
            self._draw_segment_with_glow(
                frame,
                tail_points[i],
                tail_points[i + 1],
                alpha=avg_alpha,
                width=avg_width,
            )

        # Draw bright head at the most recent point
        if tail_points:
            head_width = int(max(tail_widths[-1], self.style.line_width))
            self._draw_head_marker(frame, tail_points[-1], head_width)

        return frame


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
