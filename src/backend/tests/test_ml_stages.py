"""Tests for ML stage implementations."""

import pytest
import numpy as np

from backend.ml.stages import analyze_threshold


class TestThresholdTuning:
    """Tests for Stage 1: Threshold tuning."""

    def test_finds_optimal_threshold(self):
        """Should find threshold that reduces FP while keeping TP."""
        # Simulate feedback with confidence scores
        feedback = [
            # True positives at high confidence
            {"feedback_type": "true_positive", "confidence_snapshot": 0.85},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.82},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.78},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.75},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.72},
            # False positives at lower confidence
            {"feedback_type": "false_positive", "confidence_snapshot": 0.71},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.68},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.65},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.62},
        ]

        result = analyze_threshold(feedback, current_threshold=0.60)

        # Should recommend higher threshold to filter FPs
        assert result["recommended_threshold"] > 0.70
        assert result["projected_fp_rate"] < result["current_fp_rate"]
        assert result["projected_tp_retention"] >= 0.80  # Keep most TPs

    def test_handles_empty_feedback(self):
        """Should handle empty feedback gracefully."""
        result = analyze_threshold([], current_threshold=0.70)

        assert result["recommended_threshold"] == 0.70
        assert result["samples_analyzed"] == 0

    def test_handles_all_tp(self):
        """Should keep threshold low when all are true positives."""
        feedback = [
            {"feedback_type": "true_positive", "confidence_snapshot": 0.75},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.72},
            {"feedback_type": "true_positive", "confidence_snapshot": 0.68},
        ]

        result = analyze_threshold(feedback, current_threshold=0.70)

        # No FPs to filter, don't raise threshold unnecessarily
        assert result["recommended_threshold"] <= 0.70
