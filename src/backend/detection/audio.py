"""Audio analysis for detecting golf ball strikes."""

from pathlib import Path
from typing import Callable, Optional

import librosa
import numpy as np
from loguru import logger
from scipy import signal

from backend.core.config import settings


class AudioStrikeDetector:
    """Detects golf ball strike sounds using audio analysis."""

    def __init__(self, audio_path: Path):
        """Initialize the detector with an audio file.

        Args:
            audio_path: Path to WAV audio file
        """
        self.audio_path = audio_path
        self.y: Optional[np.ndarray] = None
        self.sr: int = settings.audio_sample_rate

        # Strike detection parameters
        self.min_strike_interval = 3.0  # Minimum seconds between strikes
        self.strike_frequency_low = 1000  # Hz - golf strikes have energy here
        self.strike_frequency_high = 8000  # Hz

    def load_audio(self) -> None:
        """Load audio file into memory."""
        logger.info(f"Loading audio from {self.audio_path}")
        self.y, self.sr = librosa.load(str(self.audio_path), sr=self.sr, mono=True)
        logger.info(f"Loaded {len(self.y) / self.sr:.2f}s of audio at {self.sr}Hz")

    def detect_strikes(
        self, progress_callback: Optional[Callable[[float], None]] = None
    ) -> list[dict]:
        """Detect potential ball strike timestamps.

        Returns:
            List of dicts with 'timestamp' and 'confidence' keys
        """
        if self.y is None:
            self.load_audio()

        logger.info("Analyzing audio for ball strikes")

        # Apply bandpass filter to focus on strike frequencies
        nyquist = self.sr / 2
        low = self.strike_frequency_low / nyquist
        high = min(self.strike_frequency_high / nyquist, 0.99)
        b, a = signal.butter(4, [low, high], btype="band")
        filtered = signal.filtfilt(b, a, self.y)

        if progress_callback:
            progress_callback(20)

        # Compute onset envelope (detects sudden changes in energy)
        onset_env = librosa.onset.onset_strength(y=filtered, sr=self.sr)

        if progress_callback:
            progress_callback(40)

        # Compute MFCC features for classification
        mfccs = librosa.feature.mfcc(y=filtered, sr=self.sr, n_mfcc=13)

        if progress_callback:
            progress_callback(60)

        # Find peaks in onset envelope
        # Golf strikes are characterized by sudden, sharp transients
        peaks, properties = signal.find_peaks(
            onset_env,
            height=np.percentile(onset_env, 95),  # Only top 5% of peaks
            distance=int(self.min_strike_interval * self.sr / 512),  # Min distance between peaks
            prominence=np.std(onset_env) * 2,  # Significant prominence
        )

        if progress_callback:
            progress_callback(80)

        # Convert peak indices to timestamps
        hop_length = 512  # librosa default
        timestamps = librosa.frames_to_time(peaks, sr=self.sr, hop_length=hop_length)

        # Calculate confidence for each potential strike
        strikes = []
        for i, (peak_idx, timestamp) in enumerate(zip(peaks, timestamps)):
            # Confidence based on:
            # 1. Peak height relative to surrounding audio
            # 2. Sharpness of the transient (rise time)
            # 3. Frequency content matching golf strike signature

            peak_height = onset_env[peak_idx]
            local_mean = np.mean(onset_env[max(0, peak_idx - 50) : peak_idx + 50])
            height_ratio = peak_height / (local_mean + 1e-6)

            # Simple confidence heuristic (can be improved with ML)
            confidence = min(1.0, height_ratio / 10)

            strikes.append(
                {
                    "timestamp": float(timestamp),
                    "confidence": float(confidence),
                    "peak_height": float(peak_height),
                }
            )

        if progress_callback:
            progress_callback(100)

        logger.info(f"Detected {len(strikes)} potential strikes")
        return strikes

    def get_audio_features_at_timestamp(
        self, timestamp: float, window_size: float = 0.1
    ) -> dict:
        """Get audio features around a specific timestamp.

        Useful for refining detection or training ML models.
        """
        if self.y is None:
            self.load_audio()

        # Get sample indices for the window
        center_sample = int(timestamp * self.sr)
        half_window = int(window_size * self.sr / 2)
        start = max(0, center_sample - half_window)
        end = min(len(self.y), center_sample + half_window)

        segment = self.y[start:end]

        # Compute features
        mfccs = librosa.feature.mfcc(y=segment, sr=self.sr, n_mfcc=13)
        spectral_centroid = librosa.feature.spectral_centroid(y=segment, sr=self.sr)
        rms = librosa.feature.rms(y=segment)

        return {
            "mfcc_mean": mfccs.mean(axis=1).tolist(),
            "mfcc_std": mfccs.std(axis=1).tolist(),
            "spectral_centroid_mean": float(spectral_centroid.mean()),
            "rms_mean": float(rms.mean()),
            "rms_max": float(rms.max()),
        }
