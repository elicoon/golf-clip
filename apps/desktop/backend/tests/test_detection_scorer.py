"""Tests for detection scorer."""

import pytest

from backend.detection.detection_scorer import DetectionScorer, DetectionCandidate, ScoredDetection


class TestDetectionScorer:
    """Tests for DetectionScorer."""

    def test_brightness_scoring_prefers_white(self):
        """Brighter candidates should score higher."""
        scorer = DetectionScorer()

        bright = DetectionCandidate(
            x=100, y=100, radius=10, brightness=220,
            template_score=0.7, motion_score=0.7, source="template"
        )
        dark = DetectionCandidate(
            x=100, y=100, radius=10, brightness=80,
            template_score=0.7, motion_score=0.7, source="template"
        )

        scored = scorer.score_candidates([bright, dark])
        assert scored[0].x == bright.x  # Bright should be first

    def test_prediction_agreement(self):
        """Candidates near prediction should score higher."""
        scorer = DetectionScorer()

        near = DetectionCandidate(
            x=105, y=98, radius=10, brightness=200,
            template_score=0.7, motion_score=0.7, source="template"
        )
        far = DetectionCandidate(
            x=200, y=200, radius=10, brightness=200,
            template_score=0.7, motion_score=0.7, source="template"
        )

        scored = scorer.score_candidates(
            [near, far],
            predicted_x=100,
            predicted_y=100,
            prediction_uncertainty=30,
        )
        assert scored[0].x == near.x  # Near should be first

    def test_best_selection(self):
        """Should select highest scoring candidate."""
        scorer = DetectionScorer()

        candidates = [
            DetectionCandidate(x=100, y=100, radius=10, brightness=200,
                               template_score=0.9, motion_score=0.8, source="template"),
            DetectionCandidate(x=150, y=150, radius=10, brightness=180,
                               template_score=0.6, motion_score=0.5, source="motion"),
        ]

        scored = scorer.score_candidates(candidates)
        best = scorer.select_best(scored)

        assert best is not None
        assert best.x == 100

    def test_threshold_enforcement(self):
        """Should return None if no candidate passes threshold."""
        scorer = DetectionScorer(min_confidence=0.9)

        candidates = [
            DetectionCandidate(x=100, y=100, radius=10, brightness=100,
                               template_score=0.3, motion_score=0.3, source="template"),
        ]

        scored = scorer.score_candidates(candidates)
        best = scorer.select_best(scored)

        assert best is None
