"""Audio analysis for detecting golf ball strikes."""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import librosa
import numpy as np
from loguru import logger
from scipy import signal

from backend.core.config import settings


@dataclass
class DetectionConfig:
    """Configuration for strike detection sensitivity."""

    # Frequency range for golf strikes (Hz)
    frequency_low: int = 1000
    frequency_high: int = 8000

    # Timing constraints
    min_strike_interval: float = 3.0  # Minimum seconds between strikes

    # Sensitivity parameters (0-1 scale, higher = more sensitive)
    sensitivity: float = 0.5

    # Confidence calculation parameters
    target_centroid_hz: float = 3500.0  # Expected spectral centroid for golf strikes
    confidence_window_frames: int = 100  # Window size for local mean calculation

    def __post_init__(self):
        """Validate configuration parameters."""
        if not 0 <= self.sensitivity <= 1:
            raise ValueError("sensitivity must be between 0 and 1")
        if self.frequency_low >= self.frequency_high:
            raise ValueError("frequency_low must be less than frequency_high")
        if self.min_strike_interval < 0:
            raise ValueError("min_strike_interval must be non-negative")

    # Peak detection thresholds (derived from sensitivity)
    @property
    def percentile_threshold(self) -> float:
        """Percentile for onset envelope peak detection (lower = more peaks)."""
        return 98 - (self.sensitivity * 15)  # Range: 83-98

    @property
    def prominence_multiplier(self) -> float:
        """Multiplier for peak prominence threshold (lower = more peaks)."""
        return 2.5 - (self.sensitivity * 1.5)  # Range: 1.0-2.5


@dataclass
class StrikeDetection:
    """Represents a detected golf strike."""

    timestamp: float
    confidence: float
    peak_height: float
    spectral_flatness: float
    onset_strength: float
    frequency_centroid: float

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "timestamp": self.timestamp,
            "confidence": self.confidence,
            "peak_height": self.peak_height,
            "spectral_flatness": self.spectral_flatness,
            "onset_strength": self.onset_strength,
            "frequency_centroid": self.frequency_centroid,
        }


class AudioStrikeDetector:
    """Detects golf ball strike sounds using audio analysis.

    Golf club strikes produce a distinctive sharp transient sound with
    energy concentrated in the 1000-8000 Hz range. This detector uses:
    1. Bandpass filtering to isolate strike frequencies
    2. Onset detection for sharp transients
    3. Spectral analysis to distinguish strikes from other sounds
    4. Peak detection with configurable sensitivity
    """

    def __init__(
        self,
        audio_path: Path,
        config: Optional[DetectionConfig] = None,
    ):
        """Initialize the detector with an audio file.

        Args:
            audio_path: Path to WAV audio file
            config: Detection configuration (uses defaults if None)
        """
        self.audio_path = audio_path
        self.config = config or DetectionConfig()
        self.y: Optional[np.ndarray] = None
        self.sr: int = settings.audio_sample_rate

        # Cached analysis results
        self._filtered: Optional[np.ndarray] = None
        self._onset_env: Optional[np.ndarray] = None
        self._hop_length: int = 512

    def load_audio(self) -> None:
        """Load audio file into memory."""
        if not self.audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {self.audio_path}")
        logger.info(f"Loading audio from {self.audio_path}")
        self.y, self.sr = librosa.load(str(self.audio_path), sr=self.sr, mono=True)
        logger.info(f"Loaded {len(self.y) / self.sr:.2f}s of audio at {self.sr}Hz")

    def _apply_bandpass_filter(self) -> np.ndarray:
        """Apply bandpass filter to isolate strike frequencies.

        Returns:
            Filtered audio signal
        """
        if self._filtered is not None:
            return self._filtered

        # Minimum samples needed for filtfilt (depends on filter order)
        # 4th order Butterworth needs at least 27 samples (9 taps * 3)
        min_samples = 30
        if len(self.y) < min_samples:
            logger.warning(
                f"Audio too short for bandpass filter ({len(self.y)} samples). "
                "Returning original signal."
            )
            self._filtered = self.y.copy()
            return self._filtered

        nyquist = self.sr / 2
        low = self.config.frequency_low / nyquist
        high = min(self.config.frequency_high / nyquist, 0.99)

        # 4th order Butterworth bandpass filter
        b, a = signal.butter(4, [low, high], btype="band")
        self._filtered = signal.filtfilt(b, a, self.y)
        return self._filtered

    def _compute_onset_envelope(self, filtered: np.ndarray) -> np.ndarray:
        """Compute onset strength envelope for transient detection.

        Args:
            filtered: Bandpass filtered audio

        Returns:
            Onset strength envelope
        """
        if self._onset_env is not None:
            return self._onset_env

        # Use multiple onset detection features for robustness
        self._onset_env = librosa.onset.onset_strength(
            y=filtered,
            sr=self.sr,
            hop_length=self._hop_length,
            aggregate=np.median,  # More robust to noise
        )
        return self._onset_env

    def _compute_spectral_features(
        self, filtered: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Compute spectral features for strike classification.

        Args:
            filtered: Bandpass filtered audio

        Returns:
            Tuple of (spectral_flatness, spectral_centroid) arrays
        """
        # Spectral flatness: high for noise-like sounds, low for tonal
        # Golf strikes should have moderate flatness (transient, not pure tone)
        flatness = librosa.feature.spectral_flatness(
            y=filtered, hop_length=self._hop_length
        )[0]

        # Spectral centroid: "brightness" of the sound
        centroid = librosa.feature.spectral_centroid(
            y=filtered, sr=self.sr, hop_length=self._hop_length
        )[0]

        return flatness, centroid

    def _find_peaks(self, onset_env: np.ndarray) -> tuple[np.ndarray, dict]:
        """Find peaks in onset envelope that could be strikes.

        Args:
            onset_env: Onset strength envelope

        Returns:
            Tuple of (peak_indices, peak_properties)
        """
        # Handle edge cases: empty or constant signal
        if len(onset_env) == 0:
            return np.array([], dtype=int), {}

        env_std = np.std(onset_env)
        env_max = np.max(onset_env)

        # If signal has no variation (silence or constant), return no peaks
        if env_std < 1e-10 or env_max < 1e-10:
            return np.array([], dtype=int), {}

        # Calculate adaptive threshold based on local statistics
        height_threshold = np.percentile(onset_env, self.config.percentile_threshold)

        # Ensure height threshold is meaningful (not too low for noisy signals)
        # This helps reject random noise peaks
        height_threshold = max(height_threshold, env_std * 2)

        # Minimum distance between peaks (in frames)
        min_distance = max(
            1,
            int(self.config.min_strike_interval * self.sr / self._hop_length)
        )

        # Prominence threshold based on local variation
        prominence_threshold = env_std * self.config.prominence_multiplier

        peaks, properties = signal.find_peaks(
            onset_env,
            height=height_threshold,
            distance=min_distance,
            prominence=prominence_threshold,
            width=(1, 50),  # Strikes are sharp, not too wide
        )

        return peaks, properties

    def _calculate_confidence(
        self,
        peak_idx: int,
        onset_env: np.ndarray,
        spectral_flatness: np.ndarray,
        spectral_centroid: np.ndarray,
        properties: dict,
        peak_num: int,
    ) -> tuple[float, dict]:
        """Calculate confidence score for a potential strike.

        Confidence is based on multiple features:
        1. Peak height relative to local context (transient strength)
        2. Spectral flatness (should be moderate for strikes)
        3. Spectral centroid (should be in expected range)
        4. Peak sharpness (rise time)

        Args:
            peak_idx: Index of the peak in onset envelope
            onset_env: Full onset envelope
            spectral_flatness: Spectral flatness array
            spectral_centroid: Spectral centroid array
            properties: Peak properties from find_peaks
            peak_num: Index in the peaks array

        Returns:
            Tuple of (confidence_score, feature_dict)
        """
        # Feature 1: Height ratio (peak vs local mean)
        window = self.config.confidence_window_frames
        start = max(0, peak_idx - window)
        end = min(len(onset_env), peak_idx + window)
        local_mean = np.mean(onset_env[start:end])
        peak_height = onset_env[peak_idx]
        height_ratio = peak_height / (local_mean + 1e-6)
        height_score = min(1.0, height_ratio / 10)

        # Feature 2: Spectral flatness at peak
        # Golf strikes have moderate flatness (0.1-0.5 typical)
        if peak_idx < len(spectral_flatness):
            flatness = spectral_flatness[peak_idx]
        else:
            flatness = spectral_flatness[-1]
        # Optimal flatness around 0.2-0.4
        flatness_score = 1.0 - abs(flatness - 0.3) * 2
        flatness_score = max(0, min(1, flatness_score))

        # Feature 3: Spectral centroid
        if peak_idx < len(spectral_centroid):
            centroid = spectral_centroid[peak_idx]
        else:
            centroid = spectral_centroid[-1]
        # Expected centroid for golf strikes: 2000-5000 Hz
        target_centroid = self.config.target_centroid_hz
        centroid_score = 1.0 - abs(centroid - target_centroid) / 5000
        centroid_score = max(0, min(1, centroid_score))

        # Feature 4: Peak prominence (sharpness)
        env_std = np.std(onset_env)
        if env_std < 1e-10:
            env_std = 1e-10  # Prevent division by zero
        if "prominences" in properties and peak_num < len(properties["prominences"]):
            prominence = properties["prominences"][peak_num]
            prominence_score = min(1.0, prominence / (env_std * 3))
        else:
            prominence_score = 0.5

        # Feature 5: Rise time (sharper = better)
        if peak_idx > 5:
            pre_peak = onset_env[peak_idx - 5 : peak_idx]
            rise = peak_height - np.min(pre_peak)
            rise_score = min(1.0, rise / (env_std * 2))
        else:
            rise_score = 0.5

        # Weighted combination
        confidence = (
            height_score * 0.30
            + flatness_score * 0.15
            + centroid_score * 0.15
            + prominence_score * 0.25
            + rise_score * 0.15
        )

        features = {
            "peak_height": float(peak_height),
            "spectral_flatness": float(flatness),
            "onset_strength": float(height_ratio),
            "frequency_centroid": float(centroid),
        }

        return float(confidence), features

    def detect_strikes(
        self, progress_callback: Optional[Callable[[float], None]] = None
    ) -> list[dict]:
        """Detect potential ball strike timestamps.

        Args:
            progress_callback: Optional callback for progress updates (0-100)

        Returns:
            List of dicts with 'timestamp', 'confidence', and feature keys
        """
        if self.y is None:
            self.load_audio()

        logger.info("Analyzing audio for ball strikes")

        # Step 1: Apply bandpass filter
        filtered = self._apply_bandpass_filter()
        if progress_callback:
            progress_callback(20)

        # Step 2: Compute onset envelope
        onset_env = self._compute_onset_envelope(filtered)
        if progress_callback:
            progress_callback(40)

        # Step 3: Compute spectral features
        spectral_flatness, spectral_centroid = self._compute_spectral_features(filtered)
        if progress_callback:
            progress_callback(60)

        # Step 4: Find peaks
        peaks, properties = self._find_peaks(onset_env)
        if progress_callback:
            progress_callback(80)

        # Step 5: Calculate confidence and build results
        timestamps = librosa.frames_to_time(
            peaks, sr=self.sr, hop_length=self._hop_length
        )

        strikes = []
        for i, (peak_idx, timestamp) in enumerate(zip(peaks, timestamps)):
            confidence, features = self._calculate_confidence(
                peak_idx,
                onset_env,
                spectral_flatness,
                spectral_centroid,
                properties,
                i,
            )

            strike = StrikeDetection(
                timestamp=float(timestamp),
                confidence=confidence,
                **features,
            )
            strikes.append(strike.to_dict())

        if progress_callback:
            progress_callback(100)

        logger.info(f"Detected {len(strikes)} potential strikes")
        return strikes

    def get_audio_features_at_timestamp(
        self, timestamp: float, window_size: float = 0.1
    ) -> dict:
        """Get audio features around a specific timestamp.

        Useful for refining detection or training ML models.

        Args:
            timestamp: Time in seconds
            window_size: Window size in seconds

        Returns:
            Dictionary of audio features
        """
        if self.y is None:
            self.load_audio()

        # Get sample indices for the window
        center_sample = int(timestamp * self.sr)
        half_window = int(window_size * self.sr / 2)
        start = max(0, center_sample - half_window)
        end = min(len(self.y), center_sample + half_window)

        segment = self.y[start:end]

        if len(segment) == 0:
            return {
                "mfcc_mean": [0.0] * 13,
                "mfcc_std": [0.0] * 13,
                "spectral_centroid_mean": 0.0,
                "spectral_flatness_mean": 0.0,
                "rms_mean": 0.0,
                "rms_max": 0.0,
                "zero_crossing_rate": 0.0,
            }

        # Compute features
        mfccs = librosa.feature.mfcc(y=segment, sr=self.sr, n_mfcc=13)
        spectral_centroid = librosa.feature.spectral_centroid(y=segment, sr=self.sr)
        spectral_flatness = librosa.feature.spectral_flatness(y=segment)
        rms = librosa.feature.rms(y=segment)
        zcr = librosa.feature.zero_crossing_rate(segment)

        return {
            "mfcc_mean": mfccs.mean(axis=1).tolist(),
            "mfcc_std": mfccs.std(axis=1).tolist(),
            "spectral_centroid_mean": float(spectral_centroid.mean()),
            "spectral_flatness_mean": float(spectral_flatness.mean()),
            "rms_mean": float(rms.mean()),
            "rms_max": float(rms.max()),
            "zero_crossing_rate": float(zcr.mean()),
        }

    def get_waveform_data(
        self, start_time: float = 0, duration: Optional[float] = None, num_points: int = 1000
    ) -> dict:
        """Get downsampled waveform data for visualization.

        Args:
            start_time: Start time in seconds
            duration: Duration in seconds (None for entire file)
            num_points: Number of points to return

        Returns:
            Dictionary with 'times' and 'amplitudes' arrays
        """
        if self.y is None:
            self.load_audio()

        start_sample = int(start_time * self.sr)
        if duration is None:
            end_sample = len(self.y)
        else:
            end_sample = min(len(self.y), int((start_time + duration) * self.sr))

        segment = self.y[start_sample:end_sample]

        if len(segment) == 0:
            return {"times": [], "amplitudes": []}

        # Downsample for visualization
        if len(segment) > num_points:
            # Use max pooling to preserve peaks
            chunk_size = len(segment) // num_points
            amplitudes = []
            for i in range(num_points):
                chunk = segment[i * chunk_size : (i + 1) * chunk_size]
                amplitudes.append(float(np.max(np.abs(chunk))))
            times = np.linspace(
                start_time, start_time + len(segment) / self.sr, num_points
            ).tolist()
        else:
            amplitudes = np.abs(segment).tolist()
            times = np.linspace(
                start_time, start_time + len(segment) / self.sr, len(segment)
            ).tolist()

        return {"times": times, "amplitudes": amplitudes}
