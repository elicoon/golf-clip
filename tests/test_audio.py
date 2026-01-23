"""Tests for audio strike detection."""

import pytest
from pathlib import Path


class TestAudioStrikeDetector:
    """Tests for the AudioStrikeDetector class."""

    def test_detector_initialization(self):
        """Test that detector can be initialized."""
        from backend.detection.audio import AudioStrikeDetector

        # This would need a test audio file
        # For now, just verify the class exists and can be imported
        assert AudioStrikeDetector is not None

    @pytest.mark.skip(reason="Requires test audio file")
    def test_detect_strikes_returns_list(self):
        """Test that detect_strikes returns a list of detections."""
        from backend.detection.audio import AudioStrikeDetector

        detector = AudioStrikeDetector(Path("test_audio.wav"))
        strikes = detector.detect_strikes()
        assert isinstance(strikes, list)

    @pytest.mark.skip(reason="Requires test audio file")
    def test_strike_has_required_fields(self):
        """Test that each strike has timestamp and confidence."""
        from backend.detection.audio import AudioStrikeDetector

        detector = AudioStrikeDetector(Path("test_audio.wav"))
        strikes = detector.detect_strikes()

        for strike in strikes:
            assert "timestamp" in strike
            assert "confidence" in strike
            assert 0 <= strike["confidence"] <= 1
