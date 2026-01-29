"""Tests for ML stage implementations."""

import numpy as np
import pytest

from backend.ml.stages import analyze_calibration, analyze_threshold, analyze_weights


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

    def test_handles_all_fp(self):
        """Should recommend highest threshold when all are false positives."""
        feedback = [
            {"feedback_type": "false_positive", "confidence_snapshot": 0.75},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.72},
            {"feedback_type": "false_positive", "confidence_snapshot": 0.68},
        ]

        result = analyze_threshold(feedback, current_threshold=0.70)

        # With all FPs, algorithm should try to filter them all
        # Since there are no TPs, TP retention constraint (>=95%) is trivially met
        assert result["samples_analyzed"] == 3
        assert result["current_fp_rate"] == 1.0
        # Should recommend a threshold that filters the FPs
        assert result["recommended_threshold"] >= 0.75  # At or above highest FP score


class TestWeightOptimization:
    """Tests for Stage 2: Feature weight optimization."""

    def test_learns_discriminative_weights(self):
        """Should learn weights that separate TP from FP."""
        # Create feedback where decay_ratio clearly separates TP from FP
        feedback = []

        # True positives have high decay ratio (ball strikes decay fast)
        for _ in range(30):
            feedback.append({
                "feedback_type": "true_positive",
                "detection_features": {
                    "peak_height": 0.7 + np.random.normal(0, 0.1),
                    "decay_ratio": 0.8 + np.random.normal(0, 0.05),  # High decay
                    "spectral_flatness": 0.3 + np.random.normal(0, 0.05),
                    "frequency_centroid": 3500 + np.random.normal(0, 200),
                    "zero_crossing_rate": 0.25 + np.random.normal(0, 0.05),
                }
            })

        # False positives have low decay ratio (sustained sounds)
        for _ in range(20):
            feedback.append({
                "feedback_type": "false_positive",
                "detection_features": {
                    "peak_height": 0.6 + np.random.normal(0, 0.1),
                    "decay_ratio": 0.3 + np.random.normal(0, 0.05),  # Low decay
                    "spectral_flatness": 0.3 + np.random.normal(0, 0.05),
                    "frequency_centroid": 3500 + np.random.normal(0, 200),
                    "zero_crossing_rate": 0.25 + np.random.normal(0, 0.05),
                }
            })

        result = analyze_weights(feedback)

        assert result["samples_analyzed"] == 50
        assert "learned_weights" in result
        # Decay ratio should have higher weight since it's discriminative
        weights = result["learned_weights"]
        assert weights["decay"] > weights["flatness"]  # decay is more important

    def test_handles_insufficient_samples(self):
        """Should return None weights with insufficient samples."""
        feedback = [
            {"feedback_type": "true_positive", "detection_features": {"peak_height": 0.8}},
        ] * 5

        result = analyze_weights(feedback)

        assert result["learned_weights"] is None
        assert "error" in result


class TestConfidenceRecalibration:
    """Tests for Stage 3: Confidence recalibration."""

    def test_calibrates_overconfident_scores(self):
        """Should reduce confidence when FP rate is high at that level."""
        feedback = []

        # At confidence 0.70-0.75, lots of false positives
        for _ in range(40):
            feedback.append({
                "feedback_type": "false_positive",
                "confidence_snapshot": 0.72,
            })
        for _ in range(10):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.73,
            })

        # At confidence 0.85+, all true positives
        for _ in range(50):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.87,
            })

        # More samples to meet minimum
        for _ in range(100):
            feedback.append({
                "feedback_type": "true_positive",
                "confidence_snapshot": 0.80,
            })

        result = analyze_calibration(feedback)

        assert result["calibration_map"] is not None
        # 0.72 should map to lower calibrated confidence
        assert result["calibration_map"]["0.72"] < 0.72

    def test_handles_insufficient_samples(self):
        """Should return None calibration with insufficient samples."""
        feedback = [
            {"feedback_type": "true_positive", "confidence_snapshot": 0.8}
        ] * 50

        result = analyze_calibration(feedback)

        assert result["calibration_map"] is None
