"""Combined audio + visual shot detection pipeline."""

import asyncio
from pathlib import Path
from typing import Callable, Optional

from loguru import logger

from .schemas import DetectedShot
from .config import settings
from .video import VideoProcessor
from .audio import AudioStrikeDetector, DetectionConfig
from .classifier import ShotClassifier
from .origin import BallOriginDetector
from .tracker import ConstrainedBallTracker
from .visual import BallDetector


class PipelineError(Exception):
    """Custom exception for pipeline errors with context."""

    def __init__(self, message: str, step: str, details: Optional[dict] = None):
        super().__init__(message)
        self.step = step
        self.details = details or {}


def deduplicate_strikes(
    strikes: list[dict],
    min_interval: float = 15.0,
) -> list[dict]:
    """Remove duplicate detections by keeping only the strongest strike in each time window.

    When multiple strikes are detected within min_interval seconds of each other,
    this likely represents a single golf shot with echoes, practice swings, or
    other related sounds. We keep only the strike with highest confidence.

    Args:
        strikes: List of strike dictionaries with 'timestamp' and 'confidence' keys
        min_interval: Minimum seconds between distinct shots (default 15s)

    Returns:
        Filtered list of strikes with duplicates removed
    """
    if not strikes:
        return []

    # Sort by timestamp
    sorted_strikes = sorted(strikes, key=lambda s: s["timestamp"])

    deduplicated = []
    current_group = [sorted_strikes[0]]

    for strike in sorted_strikes[1:]:
        # Check if this strike is within the interval of the current group
        group_start = current_group[0]["timestamp"]

        if strike["timestamp"] - group_start <= min_interval:
            # Same group - add to current group
            current_group.append(strike)
        else:
            # New group - finalize current group and start new one
            # Keep the strike with highest confidence from current group
            best_strike = max(current_group, key=lambda s: s["confidence"])
            deduplicated.append(best_strike)
            current_group = [strike]

    # Don't forget the last group
    if current_group:
        best_strike = max(current_group, key=lambda s: s["confidence"])
        deduplicated.append(best_strike)

    logger.info(
        f"Deduplication: {len(strikes)} strikes -> {len(deduplicated)} "
        f"(removed {len(strikes) - len(deduplicated)} duplicates within {min_interval}s windows)"
    )

    return deduplicated


class ShotDetectionPipeline:
    """Combines audio and visual analysis to detect golf shots."""

    def __init__(self, video_path: Path):
        """Initialize the detection pipeline.

        Args:
            video_path: Path to the input video file
        """
        self.video_path = video_path
        self.video_processor = VideoProcessor(video_path)
        self.video_info = self.video_processor.metadata
        self.audio_detector: Optional[AudioStrikeDetector] = None
        self.ball_detector: Optional[BallDetector] = None
        self.shot_classifier = ShotClassifier()
        self._cancelled = False
        self._frame_width: Optional[int] = None
        self._frame_height: Optional[int] = None
        if self.video_info:
            self._frame_width = self.video_info.width
            self._frame_height = self.video_info.height

    def cancel(self):
        """Request cancellation of the pipeline."""
        self._cancelled = True

    def _check_cancelled(self):
        """Check if cancellation was requested and raise if so."""
        if self._cancelled:
            raise asyncio.CancelledError("Pipeline cancelled")

    async def detect_shots(
        self,
        progress_callback: Optional[Callable[[str, float], None]] = None,
        job_id: Optional[str] = None,
        trajectory_callback: Optional[Callable] = None,
    ) -> list[DetectedShot]:
        """Run the full detection pipeline.

        Args:
            progress_callback: Callback(step_name, progress_percent)
            job_id: Job ID for storing trajectories (required for tracer feature)
            trajectory_callback: Async callback for storing trajectory data.
                                 Signature: async callback(job_id, shot_id, trajectory_data)
                                 If None, trajectories are not stored.

        Returns:
            List of detected shots with timing and confidence
        """
        shots = []

        def report_progress(step: str, progress: float):
            """Helper to report progress safely."""
            if progress_callback:
                try:
                    progress_callback(step, progress)
                except Exception as e:
                    logger.warning(f"Progress callback error: {e}")

        try:
            # Step 1: Extract audio (0-10%)
            self._check_cancelled()
            report_progress("Extracting audio", 0)

            audio_path = settings.temp_dir / f"{self.video_path.stem}_audio.wav"

            def audio_extraction_progress(step: str, p: float):
                # Map 0-100 to 0-10
                report_progress("Extracting audio", p * 0.1)

            try:
                self.video_processor.extract_audio(audio_path, progress_callback=audio_extraction_progress)
            except ValueError as e:
                # Video has no audio - fall back to visual-only detection
                logger.warning(f"No audio track available: {e}")
                report_progress("No audio track - using visual-only detection", 10)
                return await self._visual_only_detection(progress_callback)

            report_progress("Extracting audio", 10)

            # Step 2: Audio analysis (10-40%)
            self._check_cancelled()
            report_progress("Analyzing audio for strikes", 10)

            audio_config = DetectionConfig(sensitivity=settings.audio_sensitivity)
            self.audio_detector = AudioStrikeDetector(audio_path, config=audio_config)
            logger.info(f"Audio detection sensitivity: {settings.audio_sensitivity}")

            def audio_progress(p: float):
                # Map 0-100 to 10-40
                report_progress("Analyzing audio for strikes", 10 + p * 0.3)

            audio_strikes = self.audio_detector.detect_strikes(progress_callback=audio_progress)
            logger.info(f"Audio analysis found {len(audio_strikes)} potential strikes")

            # Deduplicate nearby strikes (keeps strongest in each 25s window)
            audio_strikes = deduplicate_strikes(audio_strikes, min_interval=25.0)

            report_progress("Analyzing audio for strikes", 40)

            if len(audio_strikes) == 0:
                logger.warning(
                    "No audio strikes detected, falling back to visual-only detection. "
                    "If your video has golf shots, try: export GOLFCLIP_AUDIO_SENSITIVITY=0.8"
                )
                return await self._visual_only_detection(progress_callback, start_progress=40)

            # Step 3: Visual analysis around each audio strike (40-80%)
            self._check_cancelled()
            report_progress("Analyzing video for ball detection", 40)

            self.ball_detector = BallDetector()

            # Initialize constrained ball tracker for trajectory detection
            self.origin_detector = BallOriginDetector()
            self.constrained_tracker = ConstrainedBallTracker(self.origin_detector)

            confirmed_shots = []
            total_strikes = len(audio_strikes)

            for i, strike in enumerate(audio_strikes):
                self._check_cancelled()

                strike_time = strike["timestamp"]
                audio_confidence = strike["confidence"]

                # Extract audio features for shot classification
                audio_features = {
                    "frequency_centroid": strike.get("frequency_centroid", 3500.0),
                    "spectral_flatness": strike.get("spectral_flatness", 0.3),
                    "confidence": audio_confidence,
                }

                # Look for ball in frames around the strike
                # Check 1 second before and 0.5 seconds after the audio strike
                search_start = max(0, strike_time - 1.0)
                search_end = min(self.video_info.duration, strike_time + 0.5)

                try:
                    detections = self.ball_detector.detect_ball_in_video_segment(
                        self.video_path,
                        search_start,
                        search_end,
                        sample_fps=30.0,  # Higher FPS for precision
                    )
                except Exception as e:
                    logger.warning(f"Visual detection failed for strike at {strike_time:.2f}s: {e}")
                    # Use audio-only for this strike
                    confirmed_shots.append({
                        "strike_time": strike_time,
                        "audio_confidence": audio_confidence,
                        "visual_confidence": 0.5,  # Neutral visual confidence
                        "combined_confidence": audio_confidence * 0.6,  # Reduced confidence
                        "audio_features": audio_features,
                        "visual_features": None,
                    })
                    continue

                # Look for ball disappearance (indicates contact)
                ball_present_before = []
                ball_present_after = []

                for det in detections:
                    if det["timestamp"] < strike_time:
                        ball_present_before.append(det["detection"] is not None)
                    else:
                        ball_present_after.append(det["detection"] is not None)

                # Visual confidence: ball visible before, gone or moving after
                before_ratio = sum(ball_present_before) / max(1, len(ball_present_before))
                after_ratio = sum(ball_present_after) / max(1, len(ball_present_after))

                # Good signal: ball visible before strike, less visible after (it flew away)
                visual_confidence = before_ratio * (1 - after_ratio * 0.5)

                # Combine audio and visual confidence
                combined_confidence = (audio_confidence * 0.4 + visual_confidence * 0.6)

                # Only include if above minimum threshold
                if combined_confidence > 0.3:
                    # Analyze ball flight trajectory for tracer rendering
                    visual_features = None
                    trajectory_points = []

                    # Try physics-based trajectory generation first (best quality)
                    try:
                        # Detect ball origin
                        origin = self.origin_detector.detect_origin(self.video_path, strike_time)
                        logger.debug(
                            f"Origin detection for strike at {strike_time:.2f}s: "
                            f"({origin.x:.0f},{origin.y:.0f}) conf={origin.confidence:.2f} method={origin.method}"
                        )

                        if origin.confidence >= 0.2:
                            # Use hybrid tracking: detects early frames + physics
                            # This extracts launch parameters from early ball detections
                            # and uses them to generate a better physics trajectory
                            hybrid_trajectory = self.constrained_tracker.track_hybrid_trajectory(
                                video_path=self.video_path,
                                origin=origin,
                                strike_time=strike_time,
                                frame_width=self._frame_width or 1920,
                                frame_height=self._frame_height or 1080,
                            )

                            if hybrid_trajectory and hybrid_trajectory.get("points"):
                                trajectory_points = hybrid_trajectory["points"]
                                visual_features = hybrid_trajectory
                                logger.info(
                                    f"Hybrid tracking for strike at {strike_time:.2f}s: "
                                    f"method={hybrid_trajectory.get('method')}, "
                                    f"{len(trajectory_points)} points, "
                                    f"launch={hybrid_trajectory.get('launch_angle', 0):.1f}°, "
                                    f"lateral={hybrid_trajectory.get('lateral_angle', 0):.1f}°, "
                                    f"shape={hybrid_trajectory.get('shot_shape')}"
                                )
                    except Exception as e:
                        logger.warning(f"Physics/constrained tracking failed for strike at {strike_time:.2f}s: {e}")

                    # Fall back to YOLO-based approach if constrained tracker didn't find enough
                    if len(trajectory_points) < 3:
                        try:
                            flight_analysis = self.ball_detector.analyze_ball_flight(
                                self.video_path,
                                strike_time - 0.5,
                                min(self.video_info.duration, strike_time + 8.0),
                                sample_fps=30.0,
                            )

                            if flight_analysis.trajectory and len(flight_analysis.trajectory) >= 2:
                                trajectory_points = [
                                    {
                                        "timestamp": pt.timestamp,
                                        "x": pt.x,
                                        "y": pt.y,
                                        "confidence": pt.confidence,
                                        "interpolated": pt.interpolated,
                                    }
                                    for pt in flight_analysis.trajectory
                                ]
                                logger.debug(
                                    f"YOLO fallback found {len(trajectory_points)} points "
                                    f"for strike at {strike_time:.2f}s"
                                )
                        except Exception as e:
                            logger.warning(f"YOLO trajectory analysis failed for strike at {strike_time:.2f}s: {e}")

                    # Build visual features if we have trajectory (and don't already have them from physics)
                    if trajectory_points and visual_features is None:
                        # Find apex (highest point = min y)
                        apex_point = min(trajectory_points, key=lambda p: p["y"])
                        apex_dict = {
                            "timestamp": apex_point["timestamp"],
                            "x": apex_point["x"],
                            "y": apex_point["y"],
                        }

                        # Calculate flight duration and average confidence
                        flight_duration = trajectory_points[-1]["timestamp"] - trajectory_points[0]["timestamp"]
                        avg_confidence = sum(p["confidence"] for p in trajectory_points) / len(trajectory_points)

                        visual_features = {
                            "trajectory": trajectory_points,
                            "apex_point": apex_dict,
                            "launch_angle": None,  # Not computed by constrained tracker
                            "flight_duration": flight_duration,
                            "trajectory_confidence": avg_confidence,
                            "smoothness_score": 0.8 if len(trajectory_points) >= 4 else 0.5,
                            "physics_plausibility": 0.8,
                            "has_gaps": False,
                            "gap_count": 0,
                        }
                        logger.debug(
                            f"Captured trajectory for strike at {strike_time:.2f}s: "
                            f"{len(trajectory_points)} points, confidence={avg_confidence:.2f}"
                        )
                    elif visual_features is not None:
                        # Physics trajectory provided visual_features, ensure trajectory key exists
                        if "points" in visual_features and "trajectory" not in visual_features:
                            visual_features["trajectory"] = visual_features["points"]
                        logger.debug(
                            f"Using physics-based visual features for strike at {strike_time:.2f}s"
                        )

                    confirmed_shots.append({
                        "strike_time": strike_time,
                        "audio_confidence": audio_confidence,
                        "visual_confidence": visual_confidence,
                        "combined_confidence": combined_confidence,
                        "audio_features": audio_features,
                        "visual_features": visual_features,
                    })

                # Report progress for visual analysis
                progress = 40 + ((i + 1) / total_strikes) * 40
                report_progress("Analyzing video for ball detection", progress)

            logger.info(f"Confirmed {len(confirmed_shots)} shots after visual analysis")

            report_progress("Analyzing video for ball detection", 80)

            # Step 4: Estimate landing times and create final shot objects (80-100%)
            self._check_cancelled()
            report_progress("Estimating ball landing times", 80)

            for i, shot in enumerate(confirmed_shots):
                self._check_cancelled()

                landing_time, landing_confidence = await self._estimate_landing_time(
                    shot["strike_time"]
                )

                # Calculate clip boundaries
                clip_start = max(0, shot["strike_time"] - settings.clip_padding_before)
                clip_end = min(
                    self.video_info.duration,
                    landing_time + settings.clip_padding_after if landing_time else shot["strike_time"] + 10.0,
                )

                # Classify shot type
                clip_duration = (landing_time or shot["strike_time"] + 5.0) - shot["strike_time"]
                shot_type, type_confidence = self.shot_classifier.classify(
                    audio_features=shot.get("audio_features"),
                    visual_features=shot.get("visual_features"),
                    clip_duration=clip_duration,
                )

                # Build confidence reasons
                reasons = []
                if shot["audio_confidence"] < 0.5:
                    reasons.append("Audio strike unclear")
                if shot["visual_confidence"] < 0.5:
                    reasons.append("Ball detection uncertain")
                if landing_confidence < 0.5:
                    reasons.append("Landing time estimated")
                if type_confidence < 0.5:
                    reasons.append(f"Shot type ({shot_type}) uncertain")

                shots.append(
                    DetectedShot(
                        id=i + 1,
                        strike_time=shot["strike_time"],
                        landing_time=landing_time,
                        clip_start=clip_start,
                        clip_end=clip_end,
                        confidence=shot["combined_confidence"] * landing_confidence,
                        confidence_reasons=reasons,
                        shot_type=shot_type,
                        audio_confidence=shot["audio_confidence"],
                        visual_confidence=shot["visual_confidence"],
                    )
                )

                # Store trajectory if available and callback provided
                if trajectory_callback and job_id and shot.get("visual_features") and shot["visual_features"].get("trajectory"):
                    vf = shot["visual_features"]
                    try:
                        trajectory_data = {
                            "trajectory_points": vf["trajectory"],
                            "confidence": vf.get("trajectory_confidence", 0),
                            "smoothness_score": vf.get("smoothness_score"),
                            "physics_plausibility": vf.get("physics_plausibility"),
                            "apex_point": vf.get("apex_point"),
                            "launch_angle": vf.get("launch_angle"),
                            "flight_duration": vf.get("flight_duration"),
                            "has_gaps": vf.get("has_gaps", False),
                            "gap_count": vf.get("gap_count", 0),
                            "frame_width": self._frame_width or 1920,
                            "frame_height": self._frame_height or 1080,
                        }
                        await trajectory_callback(job_id, i + 1, trajectory_data)
                    except Exception as e:
                        logger.warning(f"Failed to store trajectory for shot {i+1}: {e}")

                progress = 80 + ((i + 1) / max(1, len(confirmed_shots))) * 20
                report_progress("Estimating ball landing times", progress)

            report_progress("Detection complete", 100)

        except asyncio.CancelledError:
            logger.info("Pipeline cancelled by user")
            raise
        except Exception as e:
            logger.exception(f"Pipeline error: {e}")
            raise PipelineError(str(e), step="unknown", details={"exception_type": type(e).__name__})
        finally:
            # Cleanup temp files
            try:
                audio_path = settings.temp_dir / f"{self.video_path.stem}_audio.wav"
                if audio_path.exists():
                    audio_path.unlink()
            except Exception as e:
                logger.warning(f"Failed to cleanup temp audio file: {e}")

        return shots

    async def _visual_only_detection(
        self,
        progress_callback: Optional[Callable[[str, float], None]] = None,
        start_progress: float = 10,
    ) -> list[DetectedShot]:
        """Perform visual-only detection when audio is unavailable.

        This is a fallback mode that scans the video for ball movement patterns.
        Less accurate than audio+visual but still useful.

        Args:
            progress_callback: Progress callback
            start_progress: Starting progress percentage

        Returns:
            List of detected shots
        """

        def report_progress(step: str, progress: float):
            if progress_callback:
                try:
                    progress_callback(step, progress)
                except Exception:
                    pass

        self._check_cancelled()
        report_progress("Visual-only detection mode", start_progress)

        self.ball_detector = BallDetector()

        # Sample the video at regular intervals to find ball movement
        # This is less precise than audio-triggered detection
        sample_interval = 5.0  # Check every 5 seconds
        duration = self.video_info.duration
        shots = []

        current_time = 0
        shot_id = 1
        total_samples = max(1, int(duration / sample_interval))

        while current_time < duration - 2:
            self._check_cancelled()

            search_end = min(current_time + 3.0, duration)

            try:
                # Look for ball appearing and then disappearing (shot pattern)
                detections = self.ball_detector.detect_ball_in_video_segment(
                    self.video_path,
                    current_time,
                    search_end,
                    sample_fps=10.0,
                )

                # Check if ball is in motion
                if self.ball_detector.detect_ball_in_motion(detections):
                    # Found potential shot
                    disappear_time = self.ball_detector.detect_ball_disappearance(detections)

                    if disappear_time:
                        strike_time = disappear_time
                    else:
                        # Use first detection as approximate strike time
                        valid = [d for d in detections if d["detection"]]
                        if valid:
                            strike_time = valid[0]["timestamp"]
                        else:
                            current_time += sample_interval
                            continue

                    clip_start = max(0, strike_time - settings.clip_padding_before)
                    clip_end = min(duration, strike_time + 7.0 + settings.clip_padding_after)

                    # Classify shot type (no audio features available)
                    clip_duration = 5.0  # Default estimate
                    shot_type, type_confidence = self.shot_classifier.classify(
                        audio_features=None,
                        visual_features=None,
                        clip_duration=clip_duration,
                    )

                    confidence_reasons = ["Visual-only detection", "No audio confirmation"]
                    if type_confidence < 0.5:
                        confidence_reasons.append(f"Shot type ({shot_type}) uncertain")

                    shots.append(
                        DetectedShot(
                            id=shot_id,
                            strike_time=strike_time,
                            landing_time=strike_time + 5.0,  # Default estimate
                            clip_start=clip_start,
                            clip_end=clip_end,
                            confidence=0.4,  # Lower confidence for visual-only
                            confidence_reasons=confidence_reasons,
                            shot_type=shot_type,
                            audio_confidence=0.0,
                            visual_confidence=0.6,
                        )
                    )
                    shot_id += 1

                    # Skip ahead to avoid duplicate detections
                    current_time = search_end + sample_interval

            except Exception as e:
                logger.warning(f"Visual detection error at {current_time:.1f}s: {e}")

            current_time += sample_interval

            # Report progress
            progress = start_progress + ((current_time / duration) * (100 - start_progress))
            report_progress("Visual-only detection", min(99, progress))

        report_progress("Detection complete", 100)
        logger.info(f"Visual-only detection found {len(shots)} potential shots")

        if len(shots) == 0:
            logger.warning(
                "Visual detection also found 0 shots. Possible reasons: "
                "1) No golf ball visible in frame, "
                "2) Video quality/resolution too low, "
                "3) Camera angle makes ball hard to track"
            )

        return shots

    async def _estimate_landing_time(
        self, strike_time: float
    ) -> tuple[Optional[float], float]:
        """Estimate when the ball lands after a strike.

        This is challenging - options:
        1. Track ball until it leaves frame, then use physics
        2. Look for ball reappearing stationary
        3. Listen for landing sound

        For MVP, we use a simple heuristic based on typical shot durations.

        Returns:
            Tuple of (estimated landing time, confidence)
        """
        # Typical flight times by shot type (rough estimates):
        # - Drive: 4-6 seconds
        # - Iron: 3-5 seconds
        # - Chip: 1-3 seconds
        # - Putt: 1-5 seconds (rolling)

        # For MVP, use a reasonable default and let user adjust
        # More sophisticated: track ball and use physics simulation
        default_flight_time = 5.0
        estimated_landing = strike_time + default_flight_time

        # Ensure landing is within video duration
        if estimated_landing > self.video_info.duration:
            estimated_landing = self.video_info.duration - settings.clip_padding_after
            confidence = 0.3  # Low confidence if we had to clamp
        else:
            confidence = 0.5  # Medium confidence for default estimate

        # TODO: Implement actual ball tracking for better estimates
        # - Track ball trajectory
        # - Fit parabola to estimate landing
        # - Listen for landing thud

        return estimated_landing, confidence
