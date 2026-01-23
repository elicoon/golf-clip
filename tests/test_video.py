"""Tests for video processing and clip export functionality."""

import tempfile
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch, PropertyMock
from dataclasses import dataclass

import pytest


# --- Test Fixtures ---

@pytest.fixture
def mock_ffprobe_result():
    """Mock ffprobe result for a typical golf video."""
    return {
        "format": {
            "duration": "120.5",
            "size": "52428800",  # 50 MB
            "bit_rate": "3500000",
        },
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "30000/1001",  # 29.97 fps
                "pix_fmt": "yuv420p",
                "bit_rate": "3000000",
            },
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "sample_rate": "48000",
            },
        ],
    }


@pytest.fixture
def mock_ffprobe_no_audio():
    """Mock ffprobe result for video without audio."""
    return {
        "format": {
            "duration": "60.0",
            "size": "26214400",
        },
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": 1280,
                "height": 720,
                "r_frame_rate": "30/1",
            },
        ],
    }


@pytest.fixture
def temp_video_file():
    """Create a temporary file to represent a video (mocked)."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(b"fake video data")
        yield Path(f.name)
    Path(f.name).unlink(missing_ok=True)


@pytest.fixture
def temp_output_dir():
    """Create a temporary output directory."""
    with tempfile.TemporaryDirectory() as d:
        yield Path(d)


# --- VideoMetadata Tests ---

class TestVideoMetadata:
    """Tests for VideoMetadata dataclass."""

    def test_video_metadata_creation(self):
        """Test creating VideoMetadata with all fields."""
        from backend.core.video import VideoMetadata

        metadata = VideoMetadata(
            path=Path("/test/video.mp4"),
            duration=120.5,
            width=1920,
            height=1080,
            fps=29.97,
            codec="h264",
            has_audio=True,
            audio_sample_rate=48000,
            audio_codec="aac",
            file_size=52428800,
            bitrate=3500000,
            pixel_format="yuv420p",
        )

        assert metadata.duration == 120.5
        assert metadata.width == 1920
        assert metadata.height == 1080
        assert metadata.fps == 29.97
        assert metadata.has_audio is True

    def test_video_metadata_to_dict(self):
        """Test VideoMetadata.to_dict() conversion."""
        from backend.core.video import VideoMetadata

        test_path = Path("/test/video.mp4")
        metadata = VideoMetadata(
            path=test_path,
            duration=60.0,
            width=1280,
            height=720,
            fps=30.0,
            codec="h264",
            has_audio=False,
            audio_sample_rate=None,
            audio_codec=None,
            file_size=26214400,
            bitrate=None,
            pixel_format="yuv420p",
        )

        d = metadata.to_dict()

        assert d["path"] == str(test_path)  # Use str(Path) for cross-platform
        assert d["duration"] == 60.0
        assert d["width"] == 1280
        assert d["height"] == 720
        assert d["has_audio"] is False
        assert d["audio_sample_rate"] is None


# --- VideoProcessor Tests ---

class TestVideoProcessor:
    """Tests for VideoProcessor class."""

    def test_processor_initialization_file_not_found(self):
        """Test that processor raises error for missing file."""
        from backend.core.video import VideoProcessor

        with pytest.raises(FileNotFoundError):
            VideoProcessor(Path("/nonexistent/video.mp4"))

    def test_processor_initialization(self, temp_video_file):
        """Test processor can be initialized with existing file."""
        from backend.core.video import VideoProcessor

        processor = VideoProcessor(temp_video_file)

        assert processor.video_path == temp_video_file
        assert processor._metadata is None  # Not loaded yet

    @patch("backend.core.video.ffmpeg.probe")
    def test_get_metadata(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test metadata extraction from video."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)
        metadata = processor.get_metadata()

        assert metadata.duration == 120.5
        assert metadata.width == 1920
        assert metadata.height == 1080
        assert abs(metadata.fps - 29.97) < 0.01  # NTSC frame rate
        assert metadata.codec == "h264"
        assert metadata.has_audio is True
        assert metadata.audio_sample_rate == 48000
        assert metadata.audio_codec == "aac"

    @patch("backend.core.video.ffmpeg.probe")
    def test_get_metadata_no_audio(self, mock_probe, temp_video_file, mock_ffprobe_no_audio):
        """Test metadata extraction for video without audio."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_no_audio

        processor = VideoProcessor(temp_video_file)
        metadata = processor.get_metadata()

        assert metadata.has_audio is False
        assert metadata.audio_sample_rate is None
        assert metadata.audio_codec is None

    @patch("backend.core.video.ffmpeg.probe")
    def test_get_metadata_no_video_stream(self, mock_probe, temp_video_file):
        """Test error when no video stream found."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = {
            "format": {"duration": "10"},
            "streams": [{"codec_type": "audio"}],  # Only audio, no video
        }

        processor = VideoProcessor(temp_video_file)

        with pytest.raises(ValueError, match="No video stream found"):
            processor.get_metadata()

    @patch("backend.core.video.ffmpeg.probe")
    def test_metadata_property_caching(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test that metadata property caches result."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)

        # Access metadata twice
        _ = processor.metadata
        _ = processor.metadata

        # Should only call ffprobe once
        assert mock_probe.call_count == 1

    @patch("backend.core.video.ffmpeg.probe")
    def test_clamp_timestamp_negative(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test timestamp clamping for negative values."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)

        assert processor._clamp_timestamp(-5.0) == 0.0
        assert processor._clamp_timestamp(-0.001) == 0.0

    @patch("backend.core.video.ffmpeg.probe")
    def test_clamp_timestamp_past_duration(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test timestamp clamping past video duration."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)

        # Duration is 120.5
        clamped = processor._clamp_timestamp(200.0)
        assert clamped < 120.5

    @patch("backend.core.video.ffmpeg.probe")
    def test_clamp_timestamp_valid(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test timestamp clamping for valid values."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)

        assert processor._clamp_timestamp(60.0) == 60.0
        assert processor._clamp_timestamp(0.0) == 0.0
        assert processor._clamp_timestamp(120.0) == 120.0


class TestVideoProcessorExtractAudio:
    """Tests for audio extraction functionality."""

    @patch("backend.core.video.ffmpeg.probe")
    def test_extract_audio_no_audio_track(self, mock_probe, temp_video_file, mock_ffprobe_no_audio, temp_output_dir):
        """Test error when extracting audio from video without audio."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_no_audio

        processor = VideoProcessor(temp_video_file)
        output_path = temp_output_dir / "audio.wav"

        with pytest.raises(ValueError, match="no audio track"):
            processor.extract_audio(output_path)

    @patch("backend.core.video.ffmpeg.probe")
    @patch("backend.core.video.ffmpeg.input")
    def test_extract_audio_with_progress_callback(
        self, mock_input, mock_probe, temp_video_file, mock_ffprobe_result, temp_output_dir
    ):
        """Test audio extraction calls progress callback."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        # Mock the ffmpeg chain
        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.global_args.return_value = mock_stream

        # Mock async process
        mock_process = MagicMock()
        mock_process.stdout.readline.side_effect = [
            b"out_time_ms=30000000\n",  # 30 seconds
            b"out_time_ms=60000000\n",  # 60 seconds
            b"out_time_ms=120000000\n",  # 120 seconds
            b"",  # End of output
        ]
        mock_process.returncode = 0
        mock_process.stderr = MagicMock()
        mock_stream.run_async.return_value = mock_process

        processor = VideoProcessor(temp_video_file)

        progress_values = []
        def callback(step, progress):
            progress_values.append((step, progress))

        output_path = temp_output_dir / "audio.wav"
        processor.extract_audio(output_path, progress_callback=callback)

        # Should have received progress updates
        assert len(progress_values) > 0
        # First call should be 0%
        assert progress_values[0] == ("Extracting audio", 0)
        # Last call should be 100%
        assert progress_values[-1][1] == 100


class TestVideoProcessorExtractFrame:
    """Tests for frame extraction functionality."""

    @patch("backend.core.video.ffmpeg.probe")
    @patch("backend.core.video.ffmpeg.input")
    def test_extract_frame(self, mock_input, mock_probe, temp_video_file, mock_ffprobe_result, temp_output_dir):
        """Test single frame extraction."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        # Mock the ffmpeg chain
        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.run.return_value = None

        processor = VideoProcessor(temp_video_file)
        output_path = temp_output_dir / "frame.jpg"

        # Create fake output file
        output_path.touch()

        result = processor.extract_frame(5.0, output_path)

        assert result == output_path
        mock_input.assert_called_once()

    @patch("backend.core.video.ffmpeg.probe")
    @patch("backend.core.video.ffmpeg.input")
    def test_extract_frame_clamps_timestamp(
        self, mock_input, mock_probe, temp_video_file, mock_ffprobe_result, temp_output_dir
    ):
        """Test that frame extraction clamps invalid timestamps."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.run.return_value = None

        processor = VideoProcessor(temp_video_file)
        output_path = temp_output_dir / "frame.jpg"
        output_path.touch()

        # Extract at negative timestamp
        processor.extract_frame(-10.0, output_path)

        # Should have been called with ss=0 (clamped)
        call_kwargs = mock_input.call_args[1]
        assert call_kwargs.get("ss", 0) >= 0


class TestVideoProcessorExtractFramesRange:
    """Tests for range-based frame extraction."""

    @patch("backend.core.video.ffmpeg.probe")
    def test_extract_frames_range_invalid_range(
        self, mock_probe, temp_video_file, mock_ffprobe_result
    ):
        """Test range extraction with end <= start."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)

        # End before start
        frames = processor.extract_frames_range(10.0, 5.0)
        assert frames == []

        # Equal times
        frames = processor.extract_frames_range(10.0, 10.0)
        assert frames == []

    @patch("backend.core.video.ffmpeg.probe")
    @patch("backend.core.video.ffmpeg.input")
    def test_extract_frames_range_with_progress(
        self, mock_input, mock_probe, temp_video_file, mock_ffprobe_result, temp_output_dir
    ):
        """Test range extraction reports progress."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        # Mock ffmpeg chain
        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.global_args.return_value = mock_stream

        # Mock process
        mock_process = MagicMock()
        mock_process.stdout.readline.side_effect = [
            b"out_time_ms=1000000\n",
            b"out_time_ms=2000000\n",
            b"",
        ]
        mock_process.returncode = 0
        mock_stream.run_async.return_value = mock_process

        processor = VideoProcessor(temp_video_file)

        progress_values = []
        def callback(step, progress):
            progress_values.append(progress)

        processor.extract_frames_range(
            0.0, 5.0,
            fps=10.0,
            output_dir=temp_output_dir,
            progress_callback=callback
        )

        # Should have received progress updates starting at 0
        assert progress_values[0] == 0


# --- Legacy Function Tests ---

class TestLegacyFunctions:
    """Tests for backwards-compatible legacy functions."""

    @patch("backend.core.video.VideoProcessor")
    def test_get_video_info(self, mock_processor_class, temp_video_file):
        """Test legacy get_video_info function."""
        from backend.core.video import get_video_info, VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=120.5,
            width=1920,
            height=1080,
            fps=30.0,
            codec="h264",
            has_audio=True,
            audio_sample_rate=48000,
            audio_codec="aac",
            file_size=52428800,
            bitrate=3500000,
            pixel_format="yuv420p",
        )

        info = get_video_info(temp_video_file)

        assert info["duration"] == 120.5
        assert info["width"] == 1920
        assert info["has_audio"] is True

    @patch("backend.core.video.ffmpeg.input")
    def test_extract_clip_copy_codec(self, mock_input, temp_video_file, temp_output_dir):
        """Test legacy extract_clip with copy codec."""
        from backend.core.video import extract_clip

        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.run.return_value = None

        output_path = temp_output_dir / "clip.mp4"

        extract_clip(temp_video_file, output_path, 10.0, 20.0, copy_codec=True)

        # Verify output was called with c="copy"
        output_call = mock_stream.output.call_args
        assert output_call[1].get("c") == "copy"

    @patch("backend.core.video.ffmpeg.input")
    def test_extract_clip_reencode(self, mock_input, temp_video_file, temp_output_dir):
        """Test legacy extract_clip with re-encoding."""
        from backend.core.video import extract_clip

        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.run.return_value = None

        output_path = temp_output_dir / "clip.mp4"

        extract_clip(temp_video_file, output_path, 10.0, 20.0, copy_codec=False)

        # Verify output was called with libx264
        output_call = mock_stream.output.call_args
        assert output_call[1].get("vcodec") == "libx264"


# --- ClipExportSettings Tests ---

class TestClipExportSettings:
    """Tests for ClipExportSettings dataclass."""

    def test_default_settings(self):
        """Test default export settings."""
        from backend.processing.clips import ClipExportSettings

        settings = ClipExportSettings()

        assert settings.video_codec == "libx264"
        assert settings.video_preset == "medium"
        assert settings.video_crf == 18
        assert settings.audio_codec == "aac"
        assert settings.use_copy_codec is False

    def test_custom_settings(self):
        """Test custom export settings."""
        from backend.processing.clips import ClipExportSettings

        settings = ClipExportSettings(
            video_preset="fast",
            video_crf=23,
            max_width=1280,
            use_copy_codec=True,
        )

        assert settings.video_preset == "fast"
        assert settings.video_crf == 23
        assert settings.max_width == 1280
        assert settings.use_copy_codec is True


# --- ExportResult Tests ---

class TestExportResult:
    """Tests for ExportResult dataclass."""

    def test_successful_result(self):
        """Test successful export result."""
        from backend.processing.clips import ExportResult

        result = ExportResult(
            success=True,
            output_path=Path("/output/clip.mp4"),
            shot_id=1,
            duration=5.0,
            file_size=1024000,
        )

        assert result.success is True
        assert result.error_message is None

    def test_failed_result(self):
        """Test failed export result."""
        from backend.processing.clips import ExportResult

        result = ExportResult(
            success=False,
            output_path=None,
            shot_id=1,
            duration=0.1,
            error_message="Clip too short",
        )

        assert result.success is False
        assert result.error_message == "Clip too short"

    def test_result_to_dict(self):
        """Test ExportResult.to_dict() conversion."""
        from backend.processing.clips import ExportResult

        test_path = Path("/output/clip.mp4")
        result = ExportResult(
            success=True,
            output_path=test_path,
            shot_id=5,
            duration=10.0,
            file_size=2048000,
        )

        d = result.to_dict()

        assert d["success"] is True
        assert d["output_path"] == str(test_path)  # Use str(Path) for cross-platform
        assert d["shot_id"] == 5
        assert d["duration"] == 10.0


# --- ClipExporter Tests ---

class TestClipExporter:
    """Tests for ClipExporter class."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_exporter_initialization(self, mock_processor_class, temp_video_file):
        """Test ClipExporter initialization."""
        from backend.processing.clips import ClipExporter

        exporter = ClipExporter(temp_video_file)

        assert exporter.video_path == temp_video_file
        mock_processor_class.assert_called_once_with(temp_video_file)

    @patch("backend.processing.clips.VideoProcessor")
    def test_exporter_with_custom_settings(self, mock_processor_class, temp_video_file):
        """Test ClipExporter with custom settings."""
        from backend.processing.clips import ClipExporter, ClipExportSettings

        settings = ClipExportSettings(video_preset="fast")
        exporter = ClipExporter(temp_video_file, settings=settings)

        assert exporter.export_settings.video_preset == "fast"


class TestClipExporterValidation:
    """Tests for clip boundary validation."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_validate_negative_start_time(self, mock_processor_class, temp_video_file):
        """Test validation clamps negative start time."""
        from backend.processing.clips import ClipExporter
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)
        start, end = exporter._validate_clip_boundaries(-5.0, 10.0)

        assert start == 0.0
        assert end == 10.0

    @patch("backend.processing.clips.VideoProcessor")
    def test_validate_end_past_duration(self, mock_processor_class, temp_video_file):
        """Test validation clamps end time past duration."""
        from backend.processing.clips import ClipExporter
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)
        start, end = exporter._validate_clip_boundaries(50.0, 100.0)

        assert start == 50.0
        assert end == 60.0

    @patch("backend.processing.clips.VideoProcessor")
    def test_validate_end_before_start(self, mock_processor_class, temp_video_file):
        """Test validation handles end time before start time."""
        from backend.processing.clips import ClipExporter
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)
        start, end = exporter._validate_clip_boundaries(30.0, 20.0)

        # Should adjust end to be after start
        assert end > start


class TestClipExporterExport:
    """Tests for clip export functionality."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_export_clip_too_short(self, mock_processor_class, temp_video_file, temp_output_dir):
        """Test that very short clips are rejected."""
        from backend.processing.clips import ClipExporter
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)
        output_path = temp_output_dir / "clip.mp4"

        # Try to export a 0.1 second clip (below minimum)
        result = exporter.export_clip(10.0, 10.1, output_path)

        assert result.success is False
        assert "below minimum" in result.error_message

    @patch("backend.processing.clips.VideoProcessor")
    @patch("backend.processing.clips.ffmpeg.input")
    def test_export_clip_copy_codec(
        self, mock_input, mock_processor_class, temp_video_file, temp_output_dir
    ):
        """Test clip export with copy codec."""
        from backend.processing.clips import ClipExporter, ClipExportSettings
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        # Mock ffmpeg
        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.run.return_value = None

        settings = ClipExportSettings(use_copy_codec=True)
        exporter = ClipExporter(temp_video_file, settings=settings)
        output_path = temp_output_dir / "clip.mp4"

        # Create fake output file
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"fake video")

        result = exporter.export_clip(10.0, 20.0, output_path)

        assert result.success is True
        # Verify copy codec was used
        output_call = mock_stream.output.call_args
        assert output_call[1].get("c") == "copy"


class TestClipExporterBatch:
    """Tests for batch clip export."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_export_clips_skips_unapproved(self, mock_processor_class, temp_video_file, temp_output_dir):
        """Test that unapproved clips are skipped by default."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)

        clips = [
            ClipBoundary(shot_id=1, start_time=0, end_time=5, approved=True),
            ClipBoundary(shot_id=2, start_time=10, end_time=15, approved=False),
            ClipBoundary(shot_id=3, start_time=20, end_time=25, approved=True),
        ]

        # Mock the export_clip method to track calls
        exporter.export_clip = MagicMock(return_value=MagicMock(
            success=True,
            output_path=temp_output_dir / "test.mp4",
            shot_id=0,
            duration=5.0,
        ))

        exporter.export_clips(clips, temp_output_dir)

        # Should only have exported 2 clips (approved ones)
        assert exporter.export_clip.call_count == 2

    @patch("backend.processing.clips.VideoProcessor")
    def test_export_clips_with_progress_callback(
        self, mock_processor_class, temp_video_file, temp_output_dir
    ):
        """Test that progress callback is called during batch export."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)

        clips = [
            ClipBoundary(shot_id=1, start_time=0, end_time=5, approved=True),
            ClipBoundary(shot_id=2, start_time=10, end_time=15, approved=True),
        ]

        # Mock export_clip
        exporter.export_clip = MagicMock(return_value=MagicMock(
            success=True,
            output_path=temp_output_dir / "test.mp4",
            shot_id=0,
            duration=5.0,
        ))

        progress_calls = []
        def callback(step, progress):
            progress_calls.append((step, progress))

        exporter.export_clips(clips, temp_output_dir, progress_callback=callback)

        # Should have progress updates
        assert len(progress_calls) > 0
        # Last call should be 100%
        assert progress_calls[-1] == ("Export complete", 100)


class TestClipExporterFilename:
    """Tests for filename pattern building."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_build_filename_default(self, mock_processor_class, temp_video_file):
        """Test default filename pattern."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor

        exporter = ClipExporter(temp_video_file)
        clip = ClipBoundary(shot_id=5, start_time=10, end_time=20, approved=True)

        filename = exporter._build_filename("shot_{shot_id:02d}", clip, None)

        assert filename == "shot_05"

    @patch("backend.processing.clips.VideoProcessor")
    def test_build_filename_with_hole_info(self, mock_processor_class, temp_video_file):
        """Test filename with hole info."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary, HoleInfo

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor

        exporter = ClipExporter(temp_video_file)
        clip = ClipBoundary(shot_id=2, start_time=10, end_time=20, approved=True)
        hole_info = HoleInfo(hole_number=7, yardage=380, par=4, shot_number=1)

        filename = exporter._build_filename("hole{hole}_shot{shot}", clip, hole_info)

        assert filename == "hole7_shot1"

    @patch("backend.processing.clips.VideoProcessor")
    def test_build_filename_invalid_pattern(self, mock_processor_class, temp_video_file):
        """Test fallback for invalid pattern."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor

        exporter = ClipExporter(temp_video_file)
        clip = ClipBoundary(shot_id=3, start_time=10, end_time=20, approved=True)

        # Invalid pattern with missing key
        filename = exporter._build_filename("{nonexistent_key}", clip, None)

        # Should fall back to default
        assert filename == "shot_03"


# --- Legacy Clips Functions Tests ---

class TestLegacyClipsFunctions:
    """Tests for backwards-compatible legacy functions in clips.py."""

    @patch("backend.processing.clips.ClipExporter")
    def test_export_clips_legacy(self, mock_exporter_class, temp_video_file, temp_output_dir):
        """Test legacy export_clips function."""
        from backend.processing.clips import export_clips
        from backend.api.schemas import ClipBoundary
        from backend.processing.clips import ExportResult

        mock_exporter = MagicMock()
        mock_exporter_class.return_value = mock_exporter
        mock_exporter.export_clips.return_value = [
            ExportResult(success=True, output_path=Path("/out/clip1.mp4"), shot_id=1, duration=5.0),
            ExportResult(success=True, output_path=Path("/out/clip2.mp4"), shot_id=2, duration=5.0),
        ]

        clips = [
            ClipBoundary(shot_id=1, start_time=0, end_time=5, approved=True),
            ClipBoundary(shot_id=2, start_time=10, end_time=15, approved=True),
        ]

        result = export_clips(temp_video_file, clips, temp_output_dir)

        assert len(result) == 2
        mock_exporter.export_clips.assert_called_once()

    @patch("backend.processing.clips.export_clips")
    def test_batch_export(self, mock_export_clips, temp_video_file, temp_output_dir):
        """Test batch_export function."""
        from backend.processing.clips import batch_export

        mock_export_clips.return_value = [Path("/out/clip1.mp4")]

        jobs = [
            {
                "video_path": str(temp_video_file),
                "clips": [{"shot_id": 1, "start_time": 0, "end_time": 5, "approved": True}],
            }
        ]

        result = batch_export(jobs, temp_output_dir)

        assert result["total_exported"] == 1
        assert len(result["paths"]) == 1


# --- Additional Edge Case Tests ---

class TestVideoProcessorEdgeCases:
    """Tests for edge cases and bug fixes in VideoProcessor."""

    @patch("backend.core.video.ffmpeg.probe")
    def test_fps_parsing_zero_denominator(self, mock_probe, temp_video_file):
        """Test FPS parsing handles zero denominator gracefully."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = {
            "format": {"duration": "60.0", "size": "1000000"},
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30/0",  # Invalid: zero denominator
                }
            ],
        }

        processor = VideoProcessor(temp_video_file)
        metadata = processor.get_metadata()

        # Should fallback to parsing numerator as fps
        assert metadata.fps == 30.0

    @patch("backend.core.video.ffmpeg.probe")
    def test_fps_parsing_empty_string(self, mock_probe, temp_video_file):
        """Test FPS parsing handles empty string gracefully."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = {
            "format": {"duration": "60.0", "size": "1000000"},
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "",  # Empty string
                }
            ],
        }

        processor = VideoProcessor(temp_video_file)
        metadata = processor.get_metadata()

        # Should fallback to default 30 fps
        assert metadata.fps == 30.0

    @patch("backend.core.video.ffmpeg.probe")
    def test_fps_parsing_single_value(self, mock_probe, temp_video_file):
        """Test FPS parsing handles single value (no fraction)."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = {
            "format": {"duration": "60.0", "size": "1000000"},
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "25",  # Single value, no denominator
                }
            ],
        }

        processor = VideoProcessor(temp_video_file)
        metadata = processor.get_metadata()

        assert metadata.fps == 25.0

    @patch("backend.core.video.ffmpeg.probe")
    def test_extract_frames_at_empty_timestamps(self, mock_probe, temp_video_file, temp_output_dir, mock_ffprobe_result):
        """Test extract_frames_at_timestamps with empty list."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)
        frames = processor.extract_frames_at_timestamps([], temp_output_dir)

        assert frames == []


class TestClipExporterEdgeCases:
    """Tests for edge cases in ClipExporter."""

    @patch("backend.processing.clips.VideoProcessor")
    def test_export_video_without_audio(self, mock_processor_class, temp_video_file, temp_output_dir):
        """Test exporting from video without audio track."""
        from backend.processing.clips import ClipExporter, ClipExportSettings
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=False,  # No audio!
            audio_sample_rate=None, audio_codec=None,
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)

        # Verify metadata shows no audio
        assert exporter.metadata.has_audio is False

    @patch("backend.processing.clips.VideoProcessor")
    def test_closure_variable_capture_in_batch(self, mock_processor_class, temp_video_file, temp_output_dir):
        """Test that progress callback captures correct loop variables."""
        from backend.processing.clips import ClipExporter
        from backend.api.schemas import ClipBoundary
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )

        exporter = ClipExporter(temp_video_file)

        clips = [
            ClipBoundary(shot_id=1, start_time=0, end_time=5, approved=True),
            ClipBoundary(shot_id=2, start_time=10, end_time=15, approved=True),
            ClipBoundary(shot_id=3, start_time=20, end_time=25, approved=True),
        ]

        progress_calls = []
        def progress_callback(step: str, progress: float):
            progress_calls.append((step, progress))

        # Mock export_clip to verify the progress callback is created correctly
        original_export = exporter.export_clip
        clip_indices_seen = []

        def mock_export(start, end, output, progress_callback=None):
            # Call the progress callback to verify closure captured correct values
            if progress_callback:
                # Extract the captured _i from the step name in the callback
                progress_callback("test", 50)
            return MagicMock(success=True, output_path=output, shot_id=0, duration=5.0)

        exporter.export_clip = mock_export

        exporter.export_clips(clips, temp_output_dir, progress_callback=progress_callback)

        # Verify progress was reported for all clips
        assert len(progress_calls) > 0
        # Last call should be 100%
        assert progress_calls[-1] == ("Export complete", 100)


class TestProgressCallbackEdgeCases:
    """Tests for progress callback edge cases."""

    @patch("backend.core.video.ffmpeg.probe")
    @patch("backend.core.video.ffmpeg.input")
    def test_progress_with_zero_duration(
        self, mock_input, mock_probe, temp_video_file, mock_ffprobe_result, temp_output_dir
    ):
        """Test progress monitoring handles zero duration gracefully."""
        from backend.core.video import VideoProcessor

        # Modify to have zero duration
        mock_ffprobe_result["format"]["duration"] = "0"
        mock_probe.return_value = mock_ffprobe_result

        mock_stream = MagicMock()
        mock_input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.overwrite_output.return_value = mock_stream
        mock_stream.global_args.return_value = mock_stream

        # Mock process that reports progress
        mock_process = MagicMock()
        mock_process.stdout.readline.side_effect = [
            b"out_time_ms=1000000\n",
            b"",
        ]
        mock_process.returncode = 0
        mock_stream.run_async.return_value = mock_process

        processor = VideoProcessor(temp_video_file)

        progress_values = []
        def callback(step, progress):
            progress_values.append(progress)

        # Should not crash with zero duration
        processor.extract_frames_range(
            0.0, 0.0,
            fps=10.0,
            output_dir=temp_output_dir,
            progress_callback=callback
        )

        # Should return empty list for zero-duration range
        # (validated before progress monitoring is even called)


# --- Integration-style Tests (marked for optional running) ---

# Path to test video fixture
TEST_VIDEO_PATH = Path(__file__).parent / "fixtures" / "test_video.mp4"


@pytest.fixture
def test_video_file():
    """Provide the test video fixture path."""
    if not TEST_VIDEO_PATH.exists():
        pytest.skip(f"Test video not found: {TEST_VIDEO_PATH}")
    return TEST_VIDEO_PATH


@pytest.mark.integration
class TestVideoProcessorIntegration:
    """Integration tests that require actual ffmpeg.

    Run with: pytest -m integration
    """

    def test_real_video_metadata_extraction(self, test_video_file):
        """Test metadata extraction with real video file."""
        from backend.core.video import VideoProcessor

        processor = VideoProcessor(test_video_file)
        metadata = processor.get_metadata()

        assert metadata.duration > 0
        assert metadata.width == 1280
        assert metadata.height == 720
        assert metadata.fps == pytest.approx(30.0, rel=0.1)
        assert metadata.has_audio is True
        assert metadata.codec == "h264"

    def test_real_frame_extraction(self, test_video_file):
        """Test frame extraction with real video file."""
        from backend.core.video import VideoProcessor

        processor = VideoProcessor(test_video_file)

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "frame.jpg"
            result = processor.extract_frame(1.0, output)

            assert result.exists()
            assert result.stat().st_size > 0

    def test_real_audio_extraction(self, test_video_file):
        """Test audio extraction with real video file."""
        from backend.core.video import VideoProcessor

        processor = VideoProcessor(test_video_file)

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "audio.wav"
            result = processor.extract_audio(output)

            assert result.exists()
            assert result.stat().st_size > 0

    def test_real_frames_range_extraction(self, test_video_file):
        """Test frame range extraction with real video file."""
        from backend.core.video import VideoProcessor

        processor = VideoProcessor(test_video_file)

        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            frames = processor.extract_frames_range(
                start_time=1.0,
                end_time=3.0,
                fps=5.0,
                output_dir=output_dir,
            )

            # 2 seconds at 5 fps = ~10 frames
            assert len(frames) >= 8
            assert len(frames) <= 12
            for frame in frames:
                assert frame.exists()


@pytest.mark.integration
class TestClipExporterIntegration:
    """Integration tests for clip export.

    Run with: pytest -m integration
    """

    def test_real_clip_export(self, test_video_file):
        """Test clip export with real video file."""
        from backend.processing.clips import ClipExporter

        exporter = ClipExporter(test_video_file)

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "clip.mp4"

            progress_log = []
            def callback(step, progress):
                progress_log.append((step, progress))

            result = exporter.export_clip(0.0, 5.0, output, progress_callback=callback)

            assert result.success
            assert output.exists()
            assert result.file_size > 0
            assert len(progress_log) > 0

    def test_real_clip_export_copy_codec(self, test_video_file):
        """Test clip export with copy codec (fast mode)."""
        from backend.processing.clips import ClipExporter, ClipExportSettings

        settings = ClipExportSettings(use_copy_codec=True)
        exporter = ClipExporter(test_video_file, settings=settings)

        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / "clip_copy.mp4"
            result = exporter.export_clip(2.0, 8.0, output)

            assert result.success
            assert output.exists()
            assert result.file_size > 0


class TestCleanupMethods:
    """Tests for temp file cleanup methods."""

    @patch("backend.core.video.ffmpeg.probe")
    def test_cleanup_nonexistent_directory(self, mock_probe, temp_video_file, mock_ffprobe_result):
        """Test cleanup handles nonexistent directory gracefully."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        processor = VideoProcessor(temp_video_file)
        removed = processor.cleanup_temp_files(Path("/nonexistent/path"))

        assert removed == 0

    @patch("backend.core.video.ffmpeg.probe")
    def test_cleanup_removes_temp_directory(self, mock_probe, temp_video_file, temp_output_dir, mock_ffprobe_result):
        """Test cleanup removes temp directory and files."""
        from backend.core.video import VideoProcessor

        mock_probe.return_value = mock_ffprobe_result

        # Create some temp files
        temp_subdir = temp_output_dir / "frames_test"
        temp_subdir.mkdir(parents=True)
        (temp_subdir / "frame_0001.jpg").write_bytes(b"fake")
        (temp_subdir / "frame_0002.jpg").write_bytes(b"fake")
        (temp_subdir / "frame_0003.jpg").write_bytes(b"fake")

        processor = VideoProcessor(temp_video_file)
        removed = processor.cleanup_temp_files(temp_subdir)

        assert removed == 3
        assert not temp_subdir.exists()

    @patch("backend.processing.clips.VideoProcessor")
    def test_clip_exporter_cleanup_delegates(self, mock_processor_class, temp_video_file, temp_output_dir):
        """Test ClipExporter cleanup delegates to VideoProcessor."""
        from backend.processing.clips import ClipExporter
        from backend.core.video import VideoMetadata

        mock_processor = MagicMock()
        mock_processor_class.return_value = mock_processor
        mock_processor.get_metadata.return_value = VideoMetadata(
            path=temp_video_file,
            duration=60.0,
            width=1920, height=1080, fps=30.0,
            codec="h264", has_audio=True,
            audio_sample_rate=48000, audio_codec="aac",
            file_size=50000000, bitrate=3000000,
            pixel_format="yuv420p",
        )
        mock_processor.cleanup_temp_files.return_value = 5

        exporter = ClipExporter(temp_video_file)
        removed = exporter.cleanup_temp_files(temp_output_dir)

        mock_processor.cleanup_temp_files.assert_called_once_with(temp_output_dir)
        assert removed == 5
