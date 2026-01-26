"""Shot type classification for detected golf shots."""

from typing import Optional

from loguru import logger


class ShotClassifier:
    """Rule-based classifier for golf shot types.

    Classifies shots as: drive, iron, chip, or putt based on:
    - Audio features (frequency, intensity)
    - Clip duration (flight time)
    - Visual features (trajectory arc, if available)

    This is an MVP implementation using simple heuristics.
    A future ML model can replace these rules.
    """

    # Shot type constants
    DRIVE = "drive"
    IRON = "iron"
    CHIP = "chip"
    PUTT = "putt"

    # Duration thresholds (seconds)
    DRIVE_MIN_DURATION = 6.0
    IRON_MIN_DURATION = 3.0
    CHIP_MIN_DURATION = 1.0

    # Audio feature thresholds
    DRIVE_CENTROID_MAX = 3000.0  # Drives have lower frequency impact
    STRONG_AUDIO_CONFIDENCE = 0.6

    def __init__(self):
        """Initialize the classifier."""
        pass

    def classify(
        self,
        audio_features: Optional[dict],
        visual_features: Optional[dict],
        clip_duration: float,
    ) -> tuple[str, float]:
        """Classify the shot type based on available features.

        Args:
            audio_features: Dict with keys like 'frequency_centroid', 'spectral_flatness',
                          'confidence'. Can be None if audio unavailable.
            visual_features: Dict with keys like 'arc_height', 'trajectory_angle'.
                           Can be None if visual tracking unavailable.
            clip_duration: Duration of the shot clip in seconds (landing_time - strike_time).

        Returns:
            Tuple of (shot_type, confidence) where shot_type is one of:
            'drive', 'iron', 'chip', 'putt'
        """
        # Collect evidence for each shot type
        scores = {
            self.DRIVE: 0.0,
            self.IRON: 0.0,
            self.CHIP: 0.0,
            self.PUTT: 0.0,
        }

        confidence_factors = []

        # Duration-based classification
        duration_score, duration_type = self._score_by_duration(clip_duration)
        scores[duration_type] += duration_score * 0.5
        confidence_factors.append(duration_score)

        # Audio-based classification
        if audio_features:
            audio_score, audio_type = self._score_by_audio(audio_features)
            scores[audio_type] += audio_score * 0.3
            confidence_factors.append(audio_score)

        # Visual-based classification
        # High-confidence visual signals (rolling, very low trajectory) are definitive
        if visual_features:
            visual_score, visual_type = self._score_by_visual(visual_features)
            # Boost weight for high-confidence visual signals
            visual_weight = 0.4 if visual_score >= 0.7 else 0.2
            scores[visual_type] += visual_score * visual_weight
            confidence_factors.append(visual_score)

        # Find the shot type with highest score
        best_type = max(scores, key=scores.get)
        best_score = scores[best_type]

        # Calculate overall confidence
        if confidence_factors:
            base_confidence = sum(confidence_factors) / len(confidence_factors)
        else:
            base_confidence = 0.3

        # Boost confidence if multiple signals agree
        if best_score > 0.5:
            confidence = min(0.95, base_confidence + 0.1)
        else:
            confidence = base_confidence * 0.8

        # Default to iron if no clear winner
        if best_score < 0.2:
            logger.debug(
                f"Shot classification uncertain (score={best_score:.2f}), defaulting to iron | "
                f"duration={clip_duration:.1f}s, has_audio={audio_features is not None}, "
                f"has_visual={visual_features is not None}"
            )
            return self.IRON, 0.3

        final_confidence = round(confidence, 2)
        logger.debug(
            f"Classified as {best_type} (conf={final_confidence}) | "
            f"duration={clip_duration:.1f}s, scores={{{', '.join(f'{k}:{v:.2f}' for k, v in scores.items())}}}"
        )
        return best_type, final_confidence

    def _score_by_duration(self, clip_duration: float) -> tuple[float, str]:
        """Score shot type based on clip duration.

        Args:
            clip_duration: Duration in seconds

        Returns:
            Tuple of (confidence, shot_type)
        """
        if clip_duration >= self.DRIVE_MIN_DURATION:
            # Long duration suggests drive
            confidence = min(0.9, 0.6 + (clip_duration - 6.0) * 0.05)
            return confidence, self.DRIVE

        elif clip_duration >= self.IRON_MIN_DURATION:
            # Medium duration suggests iron
            confidence = 0.7
            return confidence, self.IRON

        elif clip_duration >= self.CHIP_MIN_DURATION:
            # Short duration could be chip or putt
            # Default to chip, visual features will refine
            confidence = 0.5
            return confidence, self.CHIP

        else:
            # Very short duration suggests putt
            confidence = 0.6
            return confidence, self.PUTT

    def _score_by_audio(self, audio_features: dict) -> tuple[float, str]:
        """Score shot type based on audio characteristics.

        Drives have louder, lower-frequency impacts.
        Chips and putts have softer, higher-frequency sounds.

        Args:
            audio_features: Dict with frequency_centroid, spectral_flatness, confidence

        Returns:
            Tuple of (confidence, shot_type)
        """
        centroid = audio_features.get("frequency_centroid", 3500.0)
        flatness = audio_features.get("spectral_flatness", 0.3)
        audio_confidence = audio_features.get("confidence", 0.5)

        # Strong, low-frequency impact suggests drive
        if centroid < self.DRIVE_CENTROID_MAX and audio_confidence > self.STRONG_AUDIO_CONFIDENCE:
            return 0.7, self.DRIVE

        # High frequency, low intensity suggests chip or putt
        if centroid > 4000.0 and audio_confidence < 0.5:
            # Distinguish by spectral flatness
            # Putts tend to have lower flatness (more tonal rolling sound)
            if flatness < 0.2:
                return 0.5, self.PUTT
            else:
                return 0.5, self.CHIP

        # Medium characteristics suggest iron
        return 0.6, self.IRON

    def _score_by_visual(self, visual_features: dict) -> tuple[float, str]:
        """Score shot type based on visual trajectory.

        Chips have high arc relative to distance.
        Putts stay low (rolling on ground).
        Drives have long, medium-arc trajectory.

        Args:
            visual_features: Dict with arc_height, trajectory_angle, etc.

        Returns:
            Tuple of (confidence, shot_type)
        """
        arc_height = visual_features.get("arc_height", None)
        trajectory_angle = visual_features.get("trajectory_angle", None)
        is_rolling = visual_features.get("is_rolling", False)

        # If ball is rolling, it's definitively a putt
        if is_rolling:
            return 0.95, self.PUTT

        # Low trajectory strongly suggests putt
        if trajectory_angle is not None and trajectory_angle < 10:
            return 0.85, self.PUTT

        # High arc relative to distance suggests chip
        if arc_height is not None:
            if arc_height > 0.5:  # Normalized arc height
                return 0.7, self.CHIP
            elif arc_height > 0.3:
                return 0.5, self.IRON
            else:
                return 0.5, self.DRIVE

        # No clear visual signal
        return 0.3, self.IRON
