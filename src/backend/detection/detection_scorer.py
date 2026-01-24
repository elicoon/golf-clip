"""Detection scorer for ball tracking.

Combines multiple signals to select the best ball detection from candidates:
- Template match quality
- Motion consistency
- Brightness (golf ball is white)
- Agreement with Kalman prediction
- Size consistency (ball shouldn't suddenly change size)
"""

from dataclasses import dataclass, field
from typing import Optional
import math


# Default minimum confidence threshold
MIN_CONFIDENCE = 0.4

# Scoring weights
WEIGHT_TEMPLATE = 0.25
WEIGHT_MOTION = 0.20
WEIGHT_BRIGHTNESS = 0.15
WEIGHT_PREDICTION = 0.25
WEIGHT_SIZE = 0.15


@dataclass
class DetectionCandidate:
    """A candidate ball detection from any source."""

    x: float
    y: float
    radius: float
    brightness: float
    template_score: float
    motion_score: float
    source: str  # "template", "motion", "blob", etc.


@dataclass
class ScoredDetection:
    """A detection with computed confidence scores."""

    x: float
    y: float
    radius: float
    confidence: float
    scores: dict = field(default_factory=dict)
    is_selected: bool = False


class DetectionScorer:
    """Scores and selects the best ball detection from candidates."""

    def __init__(
        self,
        min_confidence: float = MIN_CONFIDENCE,
        weight_template: float = WEIGHT_TEMPLATE,
        weight_motion: float = WEIGHT_MOTION,
        weight_brightness: float = WEIGHT_BRIGHTNESS,
        weight_prediction: float = WEIGHT_PREDICTION,
        weight_size: float = WEIGHT_SIZE,
    ):
        """Initialize the scorer.

        Args:
            min_confidence: Minimum confidence threshold for selection.
            weight_template: Weight for template match score.
            weight_motion: Weight for motion consistency score.
            weight_brightness: Weight for brightness score.
            weight_prediction: Weight for prediction agreement score.
            weight_size: Weight for size consistency score.
        """
        self.min_confidence = min_confidence
        self.weight_template = weight_template
        self.weight_motion = weight_motion
        self.weight_brightness = weight_brightness
        self.weight_prediction = weight_prediction
        self.weight_size = weight_size

        # Track expected radius for size consistency
        self._expected_radius: Optional[float] = None

    def score_candidates(
        self,
        candidates: list[DetectionCandidate],
        predicted_x: Optional[float] = None,
        predicted_y: Optional[float] = None,
        prediction_uncertainty: float = 50.0,
        expected_radius: Optional[float] = None,
    ) -> list[ScoredDetection]:
        """Score all candidates and return sorted by confidence.

        Args:
            candidates: List of detection candidates to score.
            predicted_x: X coordinate predicted by Kalman filter.
            predicted_y: Y coordinate predicted by Kalman filter.
            prediction_uncertainty: Uncertainty radius for prediction.
            expected_radius: Expected ball radius from previous frames.

        Returns:
            List of ScoredDetection objects, sorted by confidence (highest first).
        """
        if not candidates:
            return []

        # Use provided expected_radius or internal tracking state
        radius_to_use = expected_radius if expected_radius is not None else self._expected_radius

        scored = []
        for candidate in candidates:
            scores = {}

            # Template match score (already normalized 0-1)
            scores["template"] = candidate.template_score

            # Motion consistency score (already normalized 0-1)
            scores["motion"] = candidate.motion_score

            # Brightness score (golf balls are white)
            scores["brightness"] = self._score_brightness(candidate.brightness)

            # Prediction agreement score
            if predicted_x is not None and predicted_y is not None:
                scores["prediction"] = self._score_prediction_agreement(
                    candidate.x,
                    candidate.y,
                    predicted_x,
                    predicted_y,
                    prediction_uncertainty,
                )
            else:
                # No prediction available, use neutral score
                scores["prediction"] = 0.5

            # Size consistency score
            if radius_to_use is not None:
                scores["size"] = self._score_size_consistency(candidate.radius, radius_to_use)
            else:
                # No previous size available, use neutral score
                scores["size"] = 0.5

            # Compute weighted confidence
            confidence = (
                self.weight_template * scores["template"]
                + self.weight_motion * scores["motion"]
                + self.weight_brightness * scores["brightness"]
                + self.weight_prediction * scores["prediction"]
                + self.weight_size * scores["size"]
            )

            scored.append(
                ScoredDetection(
                    x=candidate.x,
                    y=candidate.y,
                    radius=candidate.radius,
                    confidence=confidence,
                    scores=scores,
                    is_selected=False,
                )
            )

        # Sort by confidence (highest first)
        scored.sort(key=lambda s: s.confidence, reverse=True)

        return scored

    def select_best(self, scored_detections: list[ScoredDetection]) -> Optional[ScoredDetection]:
        """Select the best detection if it passes the threshold.

        Args:
            scored_detections: List of scored detections (should be sorted by confidence).

        Returns:
            The best detection if it passes threshold, otherwise None.
        """
        if not scored_detections:
            return None

        best = scored_detections[0]

        if best.confidence >= self.min_confidence:
            best.is_selected = True
            return best

        return None

    def update_tracking_state(self, selected: ScoredDetection) -> None:
        """Update internal tracking state after a detection is selected.

        Args:
            selected: The selected detection.
        """
        # Update expected radius using exponential moving average
        if self._expected_radius is None:
            self._expected_radius = selected.radius
        else:
            # Smooth update: 70% previous, 30% new
            self._expected_radius = 0.7 * self._expected_radius + 0.3 * selected.radius

    def _score_brightness(self, brightness: float) -> float:
        """Score based on brightness (golf balls are white).

        Args:
            brightness: Brightness value (0-255).

        Returns:
            Score from 0.0 to 1.0.
        """
        # Golf balls are white, so higher brightness is better
        # Normalize to 0-1 range with bonus for very bright
        normalized = brightness / 255.0

        # Apply sigmoid-like curve to favor bright values
        # Score of 0.5 at brightness ~150, high scores for 200+
        if brightness >= 200:
            return min(1.0, 0.8 + (brightness - 200) * 0.004)
        elif brightness >= 150:
            return 0.5 + (brightness - 150) * 0.006
        elif brightness >= 100:
            return 0.3 + (brightness - 100) * 0.004
        else:
            return max(0.0, brightness / 333.0)

    def _score_prediction_agreement(
        self,
        x: float,
        y: float,
        predicted_x: float,
        predicted_y: float,
        uncertainty: float,
    ) -> float:
        """Score based on agreement with Kalman prediction.

        Args:
            x: Candidate X coordinate.
            y: Candidate Y coordinate.
            predicted_x: Predicted X coordinate.
            predicted_y: Predicted Y coordinate.
            uncertainty: Uncertainty radius (pixels).

        Returns:
            Score from 0.0 to 1.0.
        """
        distance = math.sqrt((x - predicted_x) ** 2 + (y - predicted_y) ** 2)

        # Within uncertainty radius: high score
        if distance <= uncertainty:
            return 1.0 - 0.3 * (distance / uncertainty)

        # Beyond uncertainty: score drops off
        excess = distance - uncertainty
        return max(0.0, 0.7 - excess / (2 * uncertainty))

    def _score_size_consistency(self, radius: float, expected_radius: float) -> float:
        """Score based on size consistency with previous detections.

        Args:
            radius: Candidate ball radius.
            expected_radius: Expected radius from tracking history.

        Returns:
            Score from 0.0 to 1.0.
        """
        if expected_radius <= 0:
            return 0.5

        # Compute relative size difference
        ratio = radius / expected_radius
        diff = abs(1.0 - ratio)

        # Allow up to 30% size variation with high score
        if diff <= 0.3:
            return 1.0 - diff
        else:
            return max(0.0, 0.7 - (diff - 0.3) * 2)
