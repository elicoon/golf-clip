"""Combined audio + visual shot detection pipeline."""

from pathlib import Path
from typing import Callable, Optional

from loguru import logger

from backend.api.schemas import DetectedShot
from backend.core.config import settings
from backend.core.video import extract_audio, get_video_info
from backend.detection.audio import AudioStrikeDetector
from backend.detection.visual import BallDetector


class ShotDetectionPipeline:
    """Combines audio and visual analysis to detect golf shots."""

    def __init__(self, video_path: Path):
        """Initialize the detection pipeline.

        Args:
            video_path: Path to the input video file
        """
        self.video_path = video_path
        self.video_info = get_video_info(video_path)
        self.audio_detector: Optional[AudioStrikeDetector] = None
        self.ball_detector: Optional[BallDetector] = None

    async def detect_shots(
        self,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ) -> list[DetectedShot]:
        """Run the full detection pipeline.

        Args:
            progress_callback: Callback(step_name, progress_percent)

        Returns:
            List of detected shots with timing and confidence
        """
        shots = []

        # Step 1: Extract audio
        if progress_callback:
            progress_callback("Extracting audio", 0)

        audio_path = settings.temp_dir / f"{self.video_path.stem}_audio.wav"
        extract_audio(self.video_path, audio_path)

        if progress_callback:
            progress_callback("Extracting audio", 100)

        # Step 2: Audio analysis
        if progress_callback:
            progress_callback("Analyzing audio for strikes", 0)

        self.audio_detector = AudioStrikeDetector(audio_path)

        def audio_progress(p):
            if progress_callback:
                progress_callback("Analyzing audio for strikes", p)

        audio_strikes = self.audio_detector.detect_strikes(progress_callback=audio_progress)
        logger.info(f"Audio analysis found {len(audio_strikes)} potential strikes")

        # Step 3: Visual analysis around each audio strike
        if progress_callback:
            progress_callback("Analyzing video for ball detection", 0)

        self.ball_detector = BallDetector()

        confirmed_shots = []
        for i, strike in enumerate(audio_strikes):
            strike_time = strike["timestamp"]
            audio_confidence = strike["confidence"]

            # Look for ball in frames around the strike
            # Check 1 second before and 0.5 seconds after the audio strike
            search_start = max(0, strike_time - 1.0)
            search_end = min(self.video_info["duration"], strike_time + 0.5)

            detections = self.ball_detector.detect_ball_in_video_segment(
                self.video_path,
                search_start,
                search_end,
                sample_fps=30.0,  # Higher FPS for precision
            )

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
                confirmed_shots.append(
                    {
                        "strike_time": strike_time,
                        "audio_confidence": audio_confidence,
                        "visual_confidence": visual_confidence,
                        "combined_confidence": combined_confidence,
                    }
                )

            if progress_callback:
                progress = ((i + 1) / len(audio_strikes)) * 100
                progress_callback("Analyzing video for ball detection", progress)

        logger.info(f"Confirmed {len(confirmed_shots)} shots after visual analysis")

        # Step 4: Estimate landing times and create final shot objects
        if progress_callback:
            progress_callback("Estimating ball landing times", 0)

        for i, shot in enumerate(confirmed_shots):
            landing_time, landing_confidence = await self._estimate_landing_time(
                shot["strike_time"]
            )

            # Calculate clip boundaries
            clip_start = max(0, shot["strike_time"] - settings.clip_padding_before)
            clip_end = min(
                self.video_info["duration"],
                landing_time + settings.clip_padding_after if landing_time else shot["strike_time"] + 10.0,
            )

            # Build confidence reasons
            reasons = []
            if shot["audio_confidence"] < 0.5:
                reasons.append("Audio strike unclear")
            if shot["visual_confidence"] < 0.5:
                reasons.append("Ball detection uncertain")
            if landing_confidence < 0.5:
                reasons.append("Landing time estimated")

            shots.append(
                DetectedShot(
                    id=i + 1,
                    strike_time=shot["strike_time"],
                    landing_time=landing_time,
                    clip_start=clip_start,
                    clip_end=clip_end,
                    confidence=shot["combined_confidence"] * landing_confidence,
                    confidence_reasons=reasons,
                    shot_type=None,  # TODO: Classify shot type
                    audio_confidence=shot["audio_confidence"],
                    visual_confidence=shot["visual_confidence"],
                )
            )

            if progress_callback:
                progress = ((i + 1) / len(confirmed_shots)) * 100
                progress_callback("Estimating ball landing times", progress)

        # Cleanup temp files
        try:
            audio_path.unlink()
        except Exception:
            pass

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
        if estimated_landing > self.video_info["duration"]:
            estimated_landing = self.video_info["duration"] - settings.clip_padding_after
            confidence = 0.3  # Low confidence if we had to clamp
        else:
            confidence = 0.5  # Medium confidence for default estimate

        # TODO: Implement actual ball tracking for better estimates
        # - Track ball trajectory
        # - Fit parabola to estimate landing
        # - Listen for landing thud

        return estimated_landing, confidence
