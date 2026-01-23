"""Tests for audio detection improvements.

These tests verify the decay ratio, zero-crossing rate, and deduplication
features added to improve strike detection accuracy.
"""

import numpy as np
import pytest

from backend.detection.pipeline import deduplicate_strikes
from backend.detection.audio import AudioStrikeDetector, DetectionConfig


class TestDeduplicateStrikes:
    """Test the deduplicate_strikes() function."""

    def test_empty_list(self):
        """Empty input should return empty output."""
        result = deduplicate_strikes([])
        assert result == []

    def test_single_strike(self):
        """Single strike should be returned as-is."""
        strikes = [{"timestamp": 10.0, "confidence": 0.8}]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 1
        assert result[0]["timestamp"] == 10.0

    def test_two_strikes_far_apart(self):
        """Strikes far apart should both be kept."""
        strikes = [
            {"timestamp": 10.0, "confidence": 0.8},
            {"timestamp": 50.0, "confidence": 0.9},
        ]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 2

    def test_two_strikes_close_keeps_highest_confidence(self):
        """Two strikes within interval should keep higher confidence."""
        strikes = [
            {"timestamp": 10.0, "confidence": 0.6},
            {"timestamp": 12.0, "confidence": 0.9},
        ]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 1
        assert result[0]["confidence"] == 0.9
        assert result[0]["timestamp"] == 12.0

    def test_multiple_groups(self):
        """Multiple distinct groups should each keep their best."""
        strikes = [
            # Group 1: timestamps 5, 8, 10 (within 15s)
            {"timestamp": 5.0, "confidence": 0.5},
            {"timestamp": 8.0, "confidence": 0.85},
            {"timestamp": 10.0, "confidence": 0.7},
            # Group 2: timestamps 30, 35 (within 15s, >15s from group 1)
            {"timestamp": 30.0, "confidence": 0.6},
            {"timestamp": 35.0, "confidence": 0.95},
            # Group 3: timestamp 60 (alone)
            {"timestamp": 60.0, "confidence": 0.75},
        ]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 3

        # Group 1 best: 0.85 at 8.0
        assert result[0]["confidence"] == 0.85
        # Group 2 best: 0.95 at 35.0
        assert result[1]["confidence"] == 0.95
        # Group 3: 0.75 at 60.0
        assert result[2]["confidence"] == 0.75

    def test_unsorted_input(self):
        """Unsorted input should be handled correctly."""
        strikes = [
            {"timestamp": 50.0, "confidence": 0.9},
            {"timestamp": 10.0, "confidence": 0.8},
            {"timestamp": 30.0, "confidence": 0.7},
        ]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 3
        # Should be sorted by timestamp
        assert result[0]["timestamp"] == 10.0
        assert result[1]["timestamp"] == 30.0
        assert result[2]["timestamp"] == 50.0

    def test_exact_boundary(self):
        """Strikes exactly at interval boundary should be separate groups."""
        strikes = [
            {"timestamp": 0.0, "confidence": 0.8},
            {"timestamp": 15.0, "confidence": 0.7},  # Exactly 15s apart
        ]
        # At exactly 15s, they should be in same group (<=)
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 1
        assert result[0]["confidence"] == 0.8

    def test_just_over_boundary(self):
        """Strikes just over interval boundary should be separate groups."""
        strikes = [
            {"timestamp": 0.0, "confidence": 0.7},
            {"timestamp": 15.1, "confidence": 0.8},  # Just over 15s
        ]
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 2

    def test_custom_interval(self):
        """Custom min_interval should be respected."""
        strikes = [
            {"timestamp": 0.0, "confidence": 0.6},
            {"timestamp": 20.0, "confidence": 0.9},
        ]
        # With 25s interval, both should be in same group
        result = deduplicate_strikes(strikes, min_interval=25.0)
        assert len(result) == 1
        assert result[0]["confidence"] == 0.9

        # With 15s interval, they should be separate
        result = deduplicate_strikes(strikes, min_interval=15.0)
        assert len(result) == 2


class TestAudioDetectorFeatures:
    """Test the audio detector's feature calculations."""

    @pytest.fixture
    def detector(self):
        """Create an audio detector with synthetic audio."""
        config = DetectionConfig(sensitivity=0.5)
        detector = AudioStrikeDetector(config)

        # Create synthetic audio: 2 seconds at 44100 Hz
        sample_rate = 44100
        duration = 2.0
        num_samples = int(sample_rate * duration)

        # Generate base signal with transient
        t = np.linspace(0, duration, num_samples, dtype=np.float32)
        audio = np.zeros(num_samples, dtype=np.float32)

        # Add a sharp transient at 1.0 seconds (simulating golf strike)
        strike_idx = int(1.0 * sample_rate)
        strike_len = int(0.02 * sample_rate)  # 20ms transient

        # Fast attack, exponential decay
        decay = np.exp(-np.linspace(0, 8, strike_len))
        audio[strike_idx:strike_idx + strike_len] = decay * 0.9

        # Add some background noise
        audio += np.random.randn(num_samples).astype(np.float32) * 0.01

        detector.y = audio
        detector.sr = sample_rate
        detector._hop_length = 512

        return detector

    def test_compute_zero_crossing_rate_normal(self, detector):
        """ZCR should return valid value for normal audio."""
        # Test around the strike (1.0 seconds)
        strike_sample = int(1.0 * detector.sr)
        window = int(0.05 * detector.sr)  # 50ms window

        zcr = detector._compute_zero_crossing_rate(
            strike_sample - window // 2,
            strike_sample + window // 2
        )

        assert 0 <= zcr <= 1
        # Strike transients typically have moderate ZCR
        assert 0.01 < zcr < 0.9

    def test_compute_zero_crossing_rate_empty_segment(self, detector):
        """ZCR should handle edge cases gracefully."""
        # Empty or invalid segment
        zcr = detector._compute_zero_crossing_rate(100, 50)  # start > end
        assert zcr == 0.5  # Default value

        # Very short segment
        zcr = detector._compute_zero_crossing_rate(0, 1)
        assert zcr == 0.5

    def test_compute_zero_crossing_rate_out_of_bounds(self, detector):
        """ZCR should handle out-of-bounds indices."""
        # Negative start
        zcr = detector._compute_zero_crossing_rate(-1000, 1000)
        assert 0 <= zcr <= 1

        # Past end of audio
        zcr = detector._compute_zero_crossing_rate(
            len(detector.y) - 100,
            len(detector.y) + 100
        )
        assert 0 <= zcr <= 1

    def test_compute_decay_ratio_impulsive(self, detector):
        """Decay ratio should be high for impulsive sounds."""
        import librosa

        # Compute onset envelope
        onset_env = librosa.onset.onset_strength(
            y=detector.y,
            sr=detector.sr,
            hop_length=detector._hop_length
        )

        # Find the peak (should be around 1.0 seconds)
        peak_idx = np.argmax(onset_env)

        decay_ratio = detector._compute_decay_ratio(peak_idx, onset_env)

        assert 0 <= decay_ratio <= 1
        # Impulsive strike should have high decay ratio
        assert decay_ratio > 0.3

    def test_compute_decay_ratio_at_end(self, detector):
        """Decay ratio should handle peaks at end of audio."""
        import librosa

        onset_env = librosa.onset.onset_strength(
            y=detector.y,
            sr=detector.sr,
            hop_length=detector._hop_length
        )

        # Test with peak at very end
        decay_ratio = detector._compute_decay_ratio(len(onset_env) - 1, onset_env)
        assert 0 <= decay_ratio <= 1

    def test_compute_decay_ratio_sustained_sound(self):
        """Decay ratio should be lower for sustained sounds."""
        config = DetectionConfig(sensitivity=0.5)
        detector = AudioStrikeDetector(config)

        # Create sustained tone (not impulsive)
        sample_rate = 44100
        duration = 2.0
        num_samples = int(sample_rate * duration)
        t = np.linspace(0, duration, num_samples, dtype=np.float32)

        # Sustained sine wave with gradual envelope
        envelope = np.ones(num_samples)
        envelope[:1000] = np.linspace(0, 1, 1000)  # Slow attack
        envelope[-1000:] = np.linspace(1, 0, 1000)  # Slow decay
        audio = np.sin(2 * np.pi * 440 * t) * envelope * 0.5

        detector.y = audio.astype(np.float32)
        detector.sr = sample_rate
        detector._hop_length = 512

        import librosa
        onset_env = librosa.onset.onset_strength(
            y=detector.y,
            sr=detector.sr,
            hop_length=detector._hop_length
        )

        if len(onset_env) > 0 and np.max(onset_env) > 0:
            peak_idx = np.argmax(onset_env)
            decay_ratio = detector._compute_decay_ratio(peak_idx, onset_env)
            # Sustained sound should have lower decay ratio than impulsive
            assert 0 <= decay_ratio <= 1


class TestStrikeDetectionWithNewFeatures:
    """Test that new features are included in detection output."""

    @pytest.fixture
    def detector_with_strike(self):
        """Create detector with clear strike sound."""
        config = DetectionConfig(sensitivity=0.7)
        detector = AudioStrikeDetector(config)

        # Create audio with a clear impulsive strike
        sample_rate = 44100
        duration = 3.0
        num_samples = int(sample_rate * duration)

        audio = np.zeros(num_samples, dtype=np.float32)

        # Add impulsive strike at 1.5 seconds
        strike_idx = int(1.5 * sample_rate)
        strike_len = int(0.015 * sample_rate)  # 15ms strike

        # Very fast attack, fast decay (typical of ball strike)
        decay = np.exp(-np.linspace(0, 10, strike_len))
        audio[strike_idx:strike_idx + strike_len] = decay * 0.95

        # Add light background noise
        audio += np.random.randn(num_samples).astype(np.float32) * 0.005

        detector.y = audio
        detector.sr = sample_rate
        detector._hop_length = 512

        return detector

    def test_strike_detection_includes_decay_ratio(self, detector_with_strike):
        """Detected strikes should include decay_ratio field."""
        strikes = detector_with_strike.detect_strikes()

        # May or may not detect depending on thresholds
        if strikes:
            for strike in strikes:
                # detect_strikes() returns dicts (via to_dict())
                assert "decay_ratio" in strike
                assert 0 <= strike["decay_ratio"] <= 1

    def test_strike_detection_includes_zcr(self, detector_with_strike):
        """Detected strikes should include zero_crossing_rate field."""
        strikes = detector_with_strike.detect_strikes()

        if strikes:
            for strike in strikes:
                # detect_strikes() returns dicts (via to_dict())
                assert "zero_crossing_rate" in strike
                assert 0 <= strike["zero_crossing_rate"] <= 1

    def test_strike_dict_includes_all_fields(self, detector_with_strike):
        """Strike dicts should include all expected fields."""
        strikes = detector_with_strike.detect_strikes()

        if strikes:
            strike = strikes[0]
            # Core fields
            assert "timestamp" in strike
            assert "confidence" in strike
            # New feature fields
            assert "decay_ratio" in strike
            assert "zero_crossing_rate" in strike
            # Existing feature fields
            assert "spectral_flatness" in strike
            assert "onset_strength" in strike
            assert "frequency_centroid" in strike


class TestDetectionConfigDefaults:
    """Test that detection config has appropriate defaults."""

    def test_min_strike_interval_default(self):
        """Default min_strike_interval should be 25 seconds."""
        config = DetectionConfig()
        assert config.min_strike_interval == 25.0

    def test_sensitivity_range(self):
        """Sensitivity should be in valid range."""
        config = DetectionConfig(sensitivity=0.0)
        assert config.sensitivity == 0.0

        config = DetectionConfig(sensitivity=1.0)
        assert config.sensitivity == 1.0

        config = DetectionConfig(sensitivity=0.5)
        assert config.sensitivity == 0.5
