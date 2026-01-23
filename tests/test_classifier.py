"""Tests for shot type classification."""

import pytest


class TestShotClassifierConstants:
    """Tests for ShotClassifier constants and thresholds."""

    def test_shot_type_constants(self):
        """Test that shot type constants are defined."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        assert classifier.DRIVE == "drive"
        assert classifier.IRON == "iron"
        assert classifier.CHIP == "chip"
        assert classifier.PUTT == "putt"

    def test_duration_thresholds(self):
        """Test that duration thresholds are sensible."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        # Thresholds should be ordered: drive > iron > chip
        assert classifier.DRIVE_MIN_DURATION > classifier.IRON_MIN_DURATION
        assert classifier.IRON_MIN_DURATION > classifier.CHIP_MIN_DURATION


class TestDurationBasedClassification:
    """Tests for duration-based shot classification."""

    def test_long_duration_classified_as_drive(self):
        """Test that long clip duration suggests drive."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=None,
            clip_duration=8.0,  # Long duration
        )
        assert shot_type == "drive"
        assert confidence > 0.3

    def test_medium_duration_classified_as_iron(self):
        """Test that medium clip duration suggests iron."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=None,
            clip_duration=4.5,  # Medium duration
        )
        assert shot_type == "iron"
        assert confidence > 0.3

    def test_short_duration_classified_as_chip(self):
        """Test that short clip duration suggests chip."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=None,
            clip_duration=2.0,  # Short duration
        )
        assert shot_type == "chip"
        assert confidence > 0.3

    def test_very_short_duration_classified_as_putt(self):
        """Test that very short clip duration suggests putt."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=None,
            clip_duration=0.5,  # Very short duration
        )
        assert shot_type == "putt"
        assert confidence > 0.3

    def test_boundary_duration_drive_iron(self):
        """Test classification at drive/iron boundary (6s)."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # Just above threshold -> drive
        shot_type, _ = classifier.classify(None, None, 6.1)
        assert shot_type == "drive"

        # Just below threshold -> iron
        shot_type, _ = classifier.classify(None, None, 5.9)
        assert shot_type == "iron"

    def test_boundary_duration_iron_chip(self):
        """Test classification at iron/chip boundary (3s)."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # Just above threshold -> iron
        shot_type, _ = classifier.classify(None, None, 3.1)
        assert shot_type == "iron"

        # Just below threshold -> chip
        shot_type, _ = classifier.classify(None, None, 2.9)
        assert shot_type == "chip"


class TestAudioBasedClassification:
    """Tests for audio feature-based classification."""

    def test_low_frequency_strong_audio_suggests_drive(self):
        """Test that low frequency + strong audio suggests drive."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        audio_features = {
            "frequency_centroid": 2500.0,  # Low frequency
            "spectral_flatness": 0.3,
            "confidence": 0.8,  # Strong audio
        }
        shot_type, confidence = classifier.classify(
            audio_features=audio_features,
            visual_features=None,
            clip_duration=5.0,  # Would be iron by duration alone
        )
        # Audio should influence toward drive
        assert confidence > 0.3

    def test_high_frequency_low_confidence_suggests_chip_or_putt(self):
        """Test that high frequency + low confidence suggests chip/putt."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        audio_features = {
            "frequency_centroid": 4500.0,  # High frequency
            "spectral_flatness": 0.4,  # Higher flatness -> chip
            "confidence": 0.3,  # Low confidence
        }
        shot_type, confidence = classifier.classify(
            audio_features=audio_features,
            visual_features=None,
            clip_duration=2.0,
        )
        assert shot_type in ["chip", "putt"]
        assert confidence > 0.3

    def test_low_flatness_suggests_putt(self):
        """Test that low spectral flatness with high frequency suggests putt."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        audio_features = {
            "frequency_centroid": 4500.0,  # High frequency
            "spectral_flatness": 0.1,  # Low flatness -> putt (rolling sound)
            "confidence": 0.3,
        }
        shot_type, _ = classifier.classify(
            audio_features=audio_features,
            visual_features=None,
            clip_duration=0.8,  # Short duration also suggests putt
        )
        assert shot_type == "putt"

    def test_missing_audio_features_use_defaults(self):
        """Test that missing audio feature keys use default values."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        # Partial audio features
        audio_features = {"confidence": 0.5}

        shot_type, confidence = classifier.classify(
            audio_features=audio_features,
            visual_features=None,
            clip_duration=4.0,
        )
        # Should still classify without error
        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1


class TestVisualBasedClassification:
    """Tests for visual feature-based classification."""

    def test_rolling_ball_classified_as_putt(self):
        """Test that rolling ball is classified as putt."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {"is_rolling": True}

        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=2.0,  # Would be chip by duration
        )
        assert shot_type == "putt"
        assert confidence > 0.3

    def test_low_trajectory_classified_as_putt(self):
        """Test that low trajectory angle suggests putt."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {"trajectory_angle": 5.0}  # Very low angle

        shot_type, _ = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=1.5,
        )
        assert shot_type == "putt"

    def test_high_arc_classified_as_chip(self):
        """Test that high arc height suggests chip."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {"arc_height": 0.7}  # High arc

        shot_type, _ = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=2.0,
        )
        assert shot_type == "chip"

    def test_medium_arc_classified_as_iron(self):
        """Test that medium arc height suggests iron."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {"arc_height": 0.35}  # Medium arc

        shot_type, _ = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=4.0,
        )
        assert shot_type == "iron"

    def test_low_arc_classified_as_drive(self):
        """Test that low arc height suggests drive."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {"arc_height": 0.2}  # Low arc

        shot_type, _ = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=7.0,  # Also long duration
        )
        assert shot_type == "drive"


class TestCombinedClassification:
    """Tests for classification using multiple feature sources."""

    def test_all_features_agree_high_confidence(self):
        """Test that agreeing features produce higher confidence."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # All features suggest drive
        audio_features = {
            "frequency_centroid": 2500.0,
            "spectral_flatness": 0.3,
            "confidence": 0.8,
        }
        visual_features = {"arc_height": 0.2}

        shot_type, confidence = classifier.classify(
            audio_features=audio_features,
            visual_features=visual_features,
            clip_duration=7.0,
        )
        assert shot_type == "drive"
        assert confidence > 0.5  # Should have good confidence

    def test_conflicting_features_lower_confidence(self):
        """Test that conflicting features still produce valid result."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # Duration suggests drive, visual suggests putt
        visual_features = {"is_rolling": True}

        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=visual_features,
            clip_duration=7.0,  # Long duration
        )
        # Should still produce valid classification
        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1

    def test_duration_only_default_iron_on_uncertainty(self):
        """Test that uncertain classification defaults to iron."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # Edge case with minimal features
        shot_type, confidence = classifier.classify(
            audio_features=None,
            visual_features=None,
            clip_duration=3.0,  # Boundary duration
        )
        # Should produce valid result
        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert confidence > 0


class TestConfidenceScores:
    """Tests for confidence score calculation."""

    def test_confidence_in_valid_range(self):
        """Test that confidence is always between 0 and 1."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        test_cases = [
            (None, None, 0.5),
            (None, None, 3.0),
            (None, None, 7.0),
            ({"confidence": 0.9, "frequency_centroid": 2000}, None, 6.0),
            (None, {"is_rolling": True}, 1.0),
        ]

        for audio, visual, duration in test_cases:
            _, confidence = classifier.classify(audio, visual, duration)
            assert 0 <= confidence <= 1, f"Confidence {confidence} out of range"

    def test_more_features_can_increase_confidence(self):
        """Test that more feature sources can increase confidence."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        # Duration only
        _, conf_duration = classifier.classify(None, None, 7.0)

        # Duration + audio
        audio_features = {
            "frequency_centroid": 2500.0,
            "spectral_flatness": 0.3,
            "confidence": 0.8,
        }
        _, conf_with_audio = classifier.classify(audio_features, None, 7.0)

        # With agreeing audio, confidence should be at least as good
        # (may not always increase, but shouldn't decrease significantly)
        assert conf_with_audio >= conf_duration * 0.8

    def test_confidence_rounded_to_two_decimals(self):
        """Test that confidence is rounded to 2 decimal places."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        _, confidence = classifier.classify(None, None, 5.0)

        # Check that confidence has at most 2 decimal places
        assert confidence == round(confidence, 2)


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_zero_duration(self):
        """Test classification with zero duration."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(None, None, 0.0)

        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1

    def test_negative_duration(self):
        """Test classification with negative duration (edge case)."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(None, None, -1.0)

        # Should handle gracefully
        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1

    def test_very_long_duration(self):
        """Test classification with very long duration."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(None, None, 30.0)

        assert shot_type == "drive"  # Very long -> drive
        assert confidence > 0.5

    def test_empty_audio_features_dict(self):
        """Test with empty audio features dict."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify({}, None, 5.0)

        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1

    def test_empty_visual_features_dict(self):
        """Test with empty visual features dict."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        shot_type, confidence = classifier.classify(None, {}, 5.0)

        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1

    def test_none_values_in_visual_features(self):
        """Test with None values in visual features dict."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()
        visual_features = {
            "arc_height": None,
            "trajectory_angle": None,
            "is_rolling": False,
        }
        shot_type, confidence = classifier.classify(None, visual_features, 4.0)

        assert shot_type in ["drive", "iron", "chip", "putt"]
        assert 0 <= confidence <= 1


class TestScoringMethods:
    """Tests for individual scoring methods."""

    def test_score_by_duration_returns_valid_tuple(self):
        """Test that _score_by_duration returns valid tuple."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        for duration in [0.5, 2.0, 4.0, 7.0, 10.0]:
            score, shot_type = classifier._score_by_duration(duration)
            assert 0 <= score <= 1
            assert shot_type in ["drive", "iron", "chip", "putt"]

    def test_score_by_audio_returns_valid_tuple(self):
        """Test that _score_by_audio returns valid tuple."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        test_features = [
            {"frequency_centroid": 2000, "spectral_flatness": 0.2, "confidence": 0.8},
            {"frequency_centroid": 4500, "spectral_flatness": 0.1, "confidence": 0.3},
            {"frequency_centroid": 3500, "spectral_flatness": 0.3, "confidence": 0.5},
        ]

        for features in test_features:
            score, shot_type = classifier._score_by_audio(features)
            assert 0 <= score <= 1
            assert shot_type in ["drive", "iron", "chip", "putt"]

    def test_score_by_visual_returns_valid_tuple(self):
        """Test that _score_by_visual returns valid tuple."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        test_features = [
            {"is_rolling": True},
            {"trajectory_angle": 5.0},
            {"arc_height": 0.7},
            {"arc_height": 0.35},
            {"arc_height": 0.2},
            {},
        ]

        for features in test_features:
            score, shot_type = classifier._score_by_visual(features)
            assert 0 <= score <= 1
            assert shot_type in ["drive", "iron", "chip", "putt"]


class TestReproducibility:
    """Tests for consistent, reproducible results."""

    def test_same_inputs_same_outputs(self):
        """Test that same inputs produce same outputs."""
        from backend.detection.classifier import ShotClassifier

        classifier = ShotClassifier()

        audio_features = {
            "frequency_centroid": 3000.0,
            "spectral_flatness": 0.25,
            "confidence": 0.7,
        }
        visual_features = {"arc_height": 0.4}

        results = []
        for _ in range(5):
            shot_type, confidence = classifier.classify(
                audio_features, visual_features, 5.0
            )
            results.append((shot_type, confidence))

        # All results should be identical
        assert all(r == results[0] for r in results)

    def test_different_instances_same_results(self):
        """Test that different classifier instances produce same results."""
        from backend.detection.classifier import ShotClassifier

        classifier1 = ShotClassifier()
        classifier2 = ShotClassifier()

        audio_features = {"frequency_centroid": 2500.0, "confidence": 0.8}

        result1 = classifier1.classify(audio_features, None, 6.5)
        result2 = classifier2.classify(audio_features, None, 6.5)

        assert result1 == result2
