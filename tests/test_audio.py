"""Tests for audio strike detection."""

import gc
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf


def safe_cleanup(path: Path, max_retries: int = 3) -> None:
    """Safely clean up a file, handling Windows file locking issues."""
    gc.collect()  # Force garbage collection to release file handles
    for i in range(max_retries):
        try:
            if path.exists():
                path.unlink()
            return
        except PermissionError:
            if i < max_retries - 1:
                time.sleep(0.1)  # Brief wait for file handles to release
                gc.collect()
            # On final attempt, just ignore the error - temp files will be cleaned up later


class TestDetectionConfig:
    """Tests for the DetectionConfig dataclass."""

    def test_default_config(self):
        """Test that default config has sensible values."""
        from backend.detection.audio import DetectionConfig

        config = DetectionConfig()
        assert config.frequency_low == 1000
        assert config.frequency_high == 8000
        assert config.min_strike_interval == 3.0
        assert config.sensitivity == 0.5

    def test_sensitivity_affects_thresholds(self):
        """Test that sensitivity parameter adjusts detection thresholds."""
        from backend.detection.audio import DetectionConfig

        low_sensitivity = DetectionConfig(sensitivity=0.0)
        high_sensitivity = DetectionConfig(sensitivity=1.0)

        # Lower sensitivity = higher percentile threshold (fewer peaks)
        assert low_sensitivity.percentile_threshold > high_sensitivity.percentile_threshold

        # Lower sensitivity = higher prominence multiplier (fewer peaks)
        assert low_sensitivity.prominence_multiplier > high_sensitivity.prominence_multiplier

    def test_percentile_threshold_range(self):
        """Test percentile threshold stays in valid range."""
        from backend.detection.audio import DetectionConfig

        for sens in [0.0, 0.25, 0.5, 0.75, 1.0]:
            config = DetectionConfig(sensitivity=sens)
            assert 0 <= config.percentile_threshold <= 100

    def test_custom_frequency_range(self):
        """Test custom frequency range configuration."""
        from backend.detection.audio import DetectionConfig

        config = DetectionConfig(frequency_low=500, frequency_high=10000)
        assert config.frequency_low == 500
        assert config.frequency_high == 10000

    def test_invalid_sensitivity_raises_error(self):
        """Test that invalid sensitivity values raise ValueError."""
        from backend.detection.audio import DetectionConfig

        with pytest.raises(ValueError, match="sensitivity must be between 0 and 1"):
            DetectionConfig(sensitivity=-0.1)

        with pytest.raises(ValueError, match="sensitivity must be between 0 and 1"):
            DetectionConfig(sensitivity=1.5)

    def test_invalid_frequency_range_raises_error(self):
        """Test that invalid frequency range raises ValueError."""
        from backend.detection.audio import DetectionConfig

        with pytest.raises(ValueError, match="frequency_low must be less than frequency_high"):
            DetectionConfig(frequency_low=8000, frequency_high=1000)

    def test_negative_interval_raises_error(self):
        """Test that negative min_strike_interval raises ValueError."""
        from backend.detection.audio import DetectionConfig

        with pytest.raises(ValueError, match="min_strike_interval must be non-negative"):
            DetectionConfig(min_strike_interval=-1.0)

    def test_custom_confidence_parameters(self):
        """Test custom confidence calculation parameters."""
        from backend.detection.audio import DetectionConfig

        config = DetectionConfig(
            target_centroid_hz=4000.0,
            confidence_window_frames=150,
        )
        assert config.target_centroid_hz == 4000.0
        assert config.confidence_window_frames == 150


class TestStrikeDetection:
    """Tests for the StrikeDetection dataclass."""

    def test_to_dict(self):
        """Test conversion to dictionary."""
        from backend.detection.audio import StrikeDetection

        strike = StrikeDetection(
            timestamp=5.5,
            confidence=0.85,
            peak_height=10.0,
            spectral_flatness=0.3,
            onset_strength=5.0,
            frequency_centroid=3500.0,
        )

        d = strike.to_dict()
        assert d["timestamp"] == 5.5
        assert d["confidence"] == 0.85
        assert d["peak_height"] == 10.0
        assert d["spectral_flatness"] == 0.3
        assert d["onset_strength"] == 5.0
        assert d["frequency_centroid"] == 3500.0

    def test_to_dict_preserves_types(self):
        """Test that to_dict preserves numeric types."""
        from backend.detection.audio import StrikeDetection

        strike = StrikeDetection(
            timestamp=1.0,
            confidence=0.5,
            peak_height=1.0,
            spectral_flatness=0.1,
            onset_strength=2.0,
            frequency_centroid=3000.0,
        )

        d = strike.to_dict()
        for key, value in d.items():
            assert isinstance(value, float), f"{key} should be float"


class SyntheticAudioGenerator:
    """Helper class to generate synthetic audio for testing."""

    def __init__(self, sample_rate: int = 44100):
        self.sr = sample_rate

    def generate_silence(self, duration: float) -> np.ndarray:
        """Generate silence."""
        return np.zeros(int(duration * self.sr))

    def generate_noise(self, duration: float, amplitude: float = 0.1) -> np.ndarray:
        """Generate white noise."""
        np.random.seed(42)  # For reproducibility
        return np.random.randn(int(duration * self.sr)) * amplitude

    def generate_tone(
        self, duration: float, frequency: float, amplitude: float = 0.5
    ) -> np.ndarray:
        """Generate a pure sine tone."""
        t = np.linspace(0, duration, int(duration * self.sr), endpoint=False)
        return amplitude * np.sin(2 * np.pi * frequency * t)

    def generate_strike_sound(
        self,
        duration: float = 0.05,
        center_freq: float = 3000,
        amplitude: float = 0.8,
    ) -> np.ndarray:
        """Generate a synthetic golf strike sound.

        Golf strikes are characterized by:
        - Sharp transient onset
        - Energy in 1000-8000 Hz range
        - Quick decay
        """
        np.random.seed(42)  # For reproducibility
        t = np.linspace(0, duration, int(duration * self.sr), endpoint=False)

        # Create a sharp transient with exponential decay
        envelope = np.exp(-t * 50)  # Fast decay

        # Mix of frequencies typical of golf strikes
        freqs = [center_freq * 0.5, center_freq, center_freq * 1.5, center_freq * 2]
        signal = np.zeros_like(t)
        for f in freqs:
            signal += np.sin(2 * np.pi * f * t) / len(freqs)

        # Add some noise for realism
        noise = np.random.randn(len(t)) * 0.3

        return (signal + noise) * envelope * amplitude

    def generate_test_audio_with_strikes(
        self,
        total_duration: float = 30.0,
        strike_times: list[float] = None,
        background_noise: float = 0.05,
    ) -> tuple[np.ndarray, list[float]]:
        """Generate test audio with synthetic strikes at specified times.

        Args:
            total_duration: Total audio duration in seconds
            strike_times: List of times for strikes (defaults to [5, 10, 20])
            background_noise: Background noise amplitude

        Returns:
            Tuple of (audio_array, strike_times)
        """
        if strike_times is None:
            strike_times = [5.0, 10.0, 20.0]

        np.random.seed(42)  # For reproducibility
        # Start with background noise
        audio = self.generate_noise(total_duration, background_noise)

        # Add strikes at specified times
        for t in strike_times:
            strike = self.generate_strike_sound()
            start_sample = int(t * self.sr)
            end_sample = start_sample + len(strike)
            if end_sample <= len(audio):
                audio[start_sample:end_sample] += strike

        return audio, strike_times

    def save_to_file(self, audio: np.ndarray, path: Path) -> None:
        """Save audio to WAV file."""
        sf.write(str(path), audio, self.sr)


@pytest.fixture
def audio_generator():
    """Provide a synthetic audio generator."""
    return SyntheticAudioGenerator(sample_rate=44100)


@pytest.fixture
def temp_audio_file(audio_generator, tmp_path):
    """Create a temporary audio file with synthetic strikes."""
    audio_path = tmp_path / "test_strikes.wav"
    audio, strike_times = audio_generator.generate_test_audio_with_strikes(
        total_duration=30.0,
        strike_times=[5.0, 12.0, 22.0],
        background_noise=0.02,
    )
    audio_generator.save_to_file(audio, audio_path)
    yield audio_path, strike_times
    # tmp_path cleanup is handled by pytest


class TestAudioStrikeDetector:
    """Tests for the AudioStrikeDetector class."""

    def test_detector_initialization(self):
        """Test that detector can be initialized."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        detector = AudioStrikeDetector(Path("test_audio.wav"))
        assert detector is not None
        assert detector.config is not None
        assert isinstance(detector.config, DetectionConfig)

    def test_detector_with_custom_config(self):
        """Test detector with custom configuration."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        config = DetectionConfig(sensitivity=0.8, min_strike_interval=5.0)
        detector = AudioStrikeDetector(Path("test.wav"), config=config)

        assert detector.config.sensitivity == 0.8
        assert detector.config.min_strike_interval == 5.0

    def test_load_audio(self, temp_audio_file):
        """Test audio loading."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        assert detector.y is not None
        assert len(detector.y) > 0
        assert detector.sr == 44100

    def test_detect_strikes_returns_list(self, temp_audio_file):
        """Test that detect_strikes returns a list of detections."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        assert isinstance(strikes, list)

    def test_strike_has_required_fields(self, temp_audio_file):
        """Test that each strike has required fields."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        for strike in strikes:
            assert "timestamp" in strike
            assert "confidence" in strike
            assert "peak_height" in strike
            assert "spectral_flatness" in strike
            assert "onset_strength" in strike
            assert "frequency_centroid" in strike

    def test_confidence_in_valid_range(self, temp_audio_file):
        """Test that confidence scores are between 0 and 1."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        for strike in strikes:
            assert 0 <= strike["confidence"] <= 1

    def test_timestamps_are_positive(self, temp_audio_file):
        """Test that timestamps are non-negative."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        for strike in strikes:
            assert strike["timestamp"] >= 0

    def test_detects_synthetic_strikes(self, temp_audio_file):
        """Test that detector finds strikes near expected times."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        audio_path, expected_times = temp_audio_file

        # Use high sensitivity to catch synthetic strikes
        config = DetectionConfig(sensitivity=0.8)
        detector = AudioStrikeDetector(audio_path, config=config)
        strikes = detector.detect_strikes()

        # Should detect at least some strikes
        assert len(strikes) > 0

        # Check that detected strikes are near expected times
        detected_times = [s["timestamp"] for s in strikes]

        # For each expected strike, check if there's a detection within 1 second
        for expected in expected_times:
            closest = min(detected_times, key=lambda x: abs(x - expected))
            # Allow 1 second tolerance for synthetic audio
            assert abs(closest - expected) < 1.0, (
                f"Expected strike at {expected}s, closest detection at {closest}s"
            )

    def test_progress_callback(self, temp_audio_file):
        """Test that progress callback is called."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)

        progress_values = []

        def callback(progress):
            progress_values.append(progress)

        detector.detect_strikes(progress_callback=callback)

        # Should have progress updates
        assert len(progress_values) > 0
        # Should reach 100%
        assert 100 in progress_values
        # Progress should be monotonically increasing
        assert progress_values == sorted(progress_values)

    def test_min_strike_interval_respected(self, audio_generator, tmp_path):
        """Test that minimum strike interval is respected."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        # Create audio with strikes too close together
        audio_path = tmp_path / "close_strikes.wav"
        audio, _ = audio_generator.generate_test_audio_with_strikes(
            total_duration=20.0,
            strike_times=[5.0, 5.5, 6.0],  # Strikes 0.5s apart
            background_noise=0.02,
        )
        audio_generator.save_to_file(audio, audio_path)

        config = DetectionConfig(min_strike_interval=3.0, sensitivity=0.8)
        detector = AudioStrikeDetector(audio_path, config=config)
        strikes = detector.detect_strikes()

        # With 3s minimum interval, should not detect all three
        detected_times = sorted([s["timestamp"] for s in strikes])

        for i in range(len(detected_times) - 1):
            interval = detected_times[i + 1] - detected_times[i]
            assert interval >= config.min_strike_interval * 0.9  # Allow small tolerance

    def test_timestamps_within_audio_duration(self, temp_audio_file):
        """Test that all timestamps are within the audio duration."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        audio_duration = len(detector.y) / detector.sr

        strikes = detector.detect_strikes()

        for strike in strikes:
            assert strike["timestamp"] <= audio_duration


class TestBandpassFilter:
    """Tests for bandpass filtering functionality."""

    def test_filter_removes_low_frequencies(self, audio_generator, tmp_path):
        """Test that filter attenuates frequencies below cutoff."""
        from backend.detection.audio import AudioStrikeDetector

        # Create audio with low frequency content only
        audio_path = tmp_path / "low_freq.wav"
        low_freq_audio = audio_generator.generate_tone(5.0, frequency=200)
        audio_generator.save_to_file(low_freq_audio, audio_path)

        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        filtered = detector._apply_bandpass_filter()

        # Filtered signal should have much lower energy
        original_energy = np.sum(detector.y**2)
        filtered_energy = np.sum(filtered**2)

        # Low frequencies should be heavily attenuated (>90% reduction)
        assert filtered_energy < original_energy * 0.1

    def test_filter_passes_strike_frequencies(self, audio_generator, tmp_path):
        """Test that filter passes frequencies in strike range."""
        from backend.detection.audio import AudioStrikeDetector

        # Create audio with frequency in strike range
        audio_path = tmp_path / "mid_freq.wav"
        mid_freq_audio = audio_generator.generate_tone(5.0, frequency=3000)
        audio_generator.save_to_file(mid_freq_audio, audio_path)

        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        filtered = detector._apply_bandpass_filter()

        # Filtered signal should retain significant energy
        original_energy = np.sum(detector.y**2)
        filtered_energy = np.sum(filtered**2)

        # Mid frequencies should pass through with >50% energy
        assert filtered_energy > original_energy * 0.5

    def test_filter_caching(self, temp_audio_file):
        """Test that filter results are cached."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        # First call
        filtered1 = detector._apply_bandpass_filter()
        # Second call should return cached result
        filtered2 = detector._apply_bandpass_filter()

        assert filtered1 is filtered2  # Same object (cached)


class TestSpectralFeatures:
    """Tests for spectral feature computation."""

    def test_spectral_features_shape(self, temp_audio_file):
        """Test that spectral features have correct shape."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        filtered = detector._apply_bandpass_filter()

        flatness, centroid = detector._compute_spectral_features(filtered)

        assert len(flatness) > 0
        assert len(centroid) > 0
        assert len(flatness) == len(centroid)

    def test_spectral_flatness_range(self, temp_audio_file):
        """Test that spectral flatness is in valid range [0, 1]."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        filtered = detector._apply_bandpass_filter()

        flatness, _ = detector._compute_spectral_features(filtered)

        assert np.all(flatness >= 0)
        assert np.all(flatness <= 1)

    def test_spectral_centroid_positive(self, temp_audio_file):
        """Test that spectral centroid is positive."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()
        filtered = detector._apply_bandpass_filter()

        _, centroid = detector._compute_spectral_features(filtered)

        assert np.all(centroid >= 0)


class TestAudioFeatures:
    """Tests for audio feature extraction."""

    def test_get_audio_features_at_timestamp(self, temp_audio_file):
        """Test audio feature extraction at a timestamp."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        features = detector.get_audio_features_at_timestamp(5.0, window_size=0.1)

        assert "mfcc_mean" in features
        assert "mfcc_std" in features
        assert "spectral_centroid_mean" in features
        assert "spectral_flatness_mean" in features
        assert "rms_mean" in features
        assert "rms_max" in features
        assert "zero_crossing_rate" in features

        # Check MFCC dimensions
        assert len(features["mfcc_mean"]) == 13
        assert len(features["mfcc_std"]) == 13

    def test_features_at_invalid_timestamp(self, temp_audio_file):
        """Test feature extraction at timestamp beyond audio length."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        # Request features beyond audio length
        features = detector.get_audio_features_at_timestamp(1000.0)

        # Should return zeros for empty segment
        assert features["rms_mean"] == 0.0

    def test_features_at_strike_vs_silence(self, temp_audio_file):
        """Test that features differ between strike and silence regions."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, strike_times = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        # Features at a strike time
        strike_features = detector.get_audio_features_at_timestamp(strike_times[0])
        # Features at a quiet region (far from strikes)
        quiet_features = detector.get_audio_features_at_timestamp(1.0)

        # Strike should have higher RMS
        assert strike_features["rms_max"] > quiet_features["rms_max"]


class TestWaveformData:
    """Tests for waveform data extraction."""

    def test_get_waveform_data(self, temp_audio_file):
        """Test waveform data extraction."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)

        waveform = detector.get_waveform_data(start_time=0, duration=5.0, num_points=500)

        assert "times" in waveform
        assert "amplitudes" in waveform
        assert len(waveform["times"]) == len(waveform["amplitudes"])
        assert len(waveform["times"]) <= 500

    def test_waveform_amplitudes_non_negative(self, temp_audio_file):
        """Test that waveform amplitudes are non-negative (absolute values)."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)

        waveform = detector.get_waveform_data()

        assert all(a >= 0 for a in waveform["amplitudes"])

    def test_waveform_empty_segment(self, temp_audio_file):
        """Test waveform extraction for empty segment."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        detector.load_audio()

        # Request segment beyond audio length
        waveform = detector.get_waveform_data(start_time=1000.0, duration=1.0)

        assert waveform["times"] == []
        assert waveform["amplitudes"] == []

    def test_waveform_preserves_peaks(self, temp_audio_file):
        """Test that waveform downsampling preserves peaks."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, strike_times = temp_audio_file
        detector = AudioStrikeDetector(audio_path)

        # Get waveform around a strike
        strike_time = strike_times[0]
        waveform = detector.get_waveform_data(
            start_time=strike_time - 0.1, duration=0.2, num_points=100
        )

        # Should have some significant amplitudes
        max_amplitude = max(waveform["amplitudes"])
        assert max_amplitude > 0.1  # Strike should be visible


class TestSensitivityLevels:
    """Tests for different sensitivity configurations."""

    def test_sensitivity_range_extremes(self):
        """Test that extreme sensitivity values work correctly."""
        from backend.detection.audio import DetectionConfig

        low = DetectionConfig(sensitivity=0.0)
        high = DetectionConfig(sensitivity=1.0)

        # Verify thresholds are different
        assert low.percentile_threshold != high.percentile_threshold
        assert low.prominence_multiplier != high.prominence_multiplier

    def test_medium_sensitivity_values(self):
        """Test medium sensitivity produces middle-ground thresholds."""
        from backend.detection.audio import DetectionConfig

        low = DetectionConfig(sensitivity=0.0)
        mid = DetectionConfig(sensitivity=0.5)
        high = DetectionConfig(sensitivity=1.0)

        # Mid should be between low and high
        assert low.percentile_threshold > mid.percentile_threshold > high.percentile_threshold


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_silence_no_strikes(self, audio_generator, tmp_path):
        """Test that silence produces no strike detections."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path = tmp_path / "silence.wav"
        silence = audio_generator.generate_silence(10.0)
        audio_generator.save_to_file(silence, audio_path)

        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        assert len(strikes) == 0

    def test_constant_noise_few_strikes(self, audio_generator, tmp_path):
        """Test that constant noise doesn't produce many false positives."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        audio_path = tmp_path / "noise.wav"
        np.random.seed(42)
        noise = np.random.randn(int(30.0 * 44100)) * 0.3
        audio_generator.save_to_file(noise, audio_path)

        config = DetectionConfig(sensitivity=0.5)
        detector = AudioStrikeDetector(audio_path, config=config)
        strikes = detector.detect_strikes()

        # Constant noise shouldn't produce many transients
        # Allow some false positives but not too many
        assert len(strikes) < 10

    def test_very_short_audio(self, audio_generator, tmp_path):
        """Test handling of very short audio files."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path = tmp_path / "short.wav"
        short_audio = audio_generator.generate_noise(0.5)  # 0.5 seconds
        audio_generator.save_to_file(short_audio, audio_path)

        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        # Should handle short audio without error
        assert isinstance(strikes, list)

    def test_cached_results(self, temp_audio_file):
        """Test that cached analysis results are reused."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)

        # First detection
        strikes1 = detector.detect_strikes()

        # Verify caches are populated
        assert detector._filtered is not None
        assert detector._onset_env is not None

        # Second detection should use cache
        strikes2 = detector.detect_strikes()

        # Results should be identical
        assert len(strikes1) == len(strikes2)
        for s1, s2 in zip(strikes1, strikes2):
            assert s1["timestamp"] == s2["timestamp"]
            assert s1["confidence"] == s2["confidence"]

    def test_single_sample_audio(self, tmp_path):
        """Test handling of extremely short audio (edge case)."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path = tmp_path / "tiny.wav"
        # Create audio with just a few samples
        tiny_audio = np.array([0.1, 0.2, 0.1])
        sf.write(str(audio_path), tiny_audio, 44100)

        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        assert isinstance(strikes, list)
        assert len(strikes) == 0  # Too short to have meaningful strikes

    def test_file_not_found_raises_error(self):
        """Test that loading a non-existent file raises FileNotFoundError."""
        from backend.detection.audio import AudioStrikeDetector

        detector = AudioStrikeDetector(Path("/nonexistent/path/audio.wav"))

        with pytest.raises(FileNotFoundError, match="Audio file not found"):
            detector.load_audio()


class TestConfidenceCalculation:
    """Tests for confidence score calculation."""

    def test_high_confidence_for_clear_strikes(self, audio_generator, tmp_path):
        """Test that clear strikes get high confidence scores."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        audio_path = tmp_path / "clear_strike.wav"
        # Create audio with very clear strike (high amplitude, low noise)
        audio, strike_times = audio_generator.generate_test_audio_with_strikes(
            total_duration=10.0,
            strike_times=[5.0],
            background_noise=0.01,  # Very low noise
        )
        audio_generator.save_to_file(audio, audio_path)

        config = DetectionConfig(sensitivity=0.7)
        detector = AudioStrikeDetector(audio_path, config=config)
        strikes = detector.detect_strikes()

        # Should detect the strike with reasonable confidence
        if len(strikes) > 0:
            # Find the strike closest to expected time
            closest = min(strikes, key=lambda s: abs(s["timestamp"] - 5.0))
            assert closest["confidence"] > 0.3  # Should have decent confidence

    def test_confidence_components_reasonable(self, temp_audio_file):
        """Test that confidence calculation produces reasonable values."""
        from backend.detection.audio import AudioStrikeDetector

        audio_path, _ = temp_audio_file
        detector = AudioStrikeDetector(audio_path)
        strikes = detector.detect_strikes()

        for strike in strikes:
            # All component features should be positive
            assert strike["peak_height"] >= 0
            assert strike["spectral_flatness"] >= 0
            assert strike["onset_strength"] >= 0
            assert strike["frequency_centroid"] >= 0


class TestIntegration:
    """Integration tests for the full detection pipeline."""

    def test_full_pipeline_with_multiple_strikes(self, audio_generator, tmp_path):
        """Test full pipeline with multiple well-spaced strikes."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        audio_path = tmp_path / "multi_strike.wav"
        strike_times = [5.0, 15.0, 25.0, 35.0]
        audio, _ = audio_generator.generate_test_audio_with_strikes(
            total_duration=45.0,
            strike_times=strike_times,
            background_noise=0.02,
        )
        audio_generator.save_to_file(audio, audio_path)

        config = DetectionConfig(sensitivity=0.7, min_strike_interval=3.0)
        detector = AudioStrikeDetector(audio_path, config=config)

        progress_log = []
        strikes = detector.detect_strikes(progress_callback=lambda p: progress_log.append(p))

        # Should detect strikes
        assert len(strikes) > 0

        # Progress should have been reported
        assert len(progress_log) > 0
        assert max(progress_log) == 100

        # Strikes should be sorted by timestamp
        timestamps = [s["timestamp"] for s in strikes]
        assert timestamps == sorted(timestamps)

    def test_pipeline_reproducibility(self, temp_audio_file):
        """Test that the pipeline produces consistent results."""
        from backend.detection.audio import AudioStrikeDetector, DetectionConfig

        audio_path, _ = temp_audio_file
        config = DetectionConfig(sensitivity=0.6)

        # Run detection twice with fresh detector instances
        detector1 = AudioStrikeDetector(audio_path, config=config)
        strikes1 = detector1.detect_strikes()

        detector2 = AudioStrikeDetector(audio_path, config=config)
        strikes2 = detector2.detect_strikes()

        # Results should be identical
        assert len(strikes1) == len(strikes2)
        for s1, s2 in zip(strikes1, strikes2):
            assert abs(s1["timestamp"] - s2["timestamp"]) < 0.001
            assert abs(s1["confidence"] - s2["confidence"]) < 0.001
