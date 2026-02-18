"""Test script for visual ball detection on a real golf video."""

import sys
from pathlib import Path

import cv2

# Add src to path
src_path = Path(__file__).parent.parent / "src"
sys.path.insert(0, str(src_path))

from backend.detection.visual import BallDetector


def main():
    # Path to test video — pass as command-line argument, e.g.:
    #   python scripts/test_video_detection.py /path/to/your/golf_video.mp4
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_video_detection.py <video_path>")
        return
    video_path = Path(sys.argv[1])

    if not video_path.exists():
        print(f"Video not found: {video_path}")
        return

    print(f"Testing with video: {video_path}")
    print("-" * 50)

    # Get video metadata using OpenCV (doesn't require FFmpeg)
    print("\n1. Getting video metadata...")
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        print("Failed to open video!")
        return

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps > 0 else 0
    file_size = video_path.stat().st_size

    print(f"   Duration: {duration:.2f}s")
    print(f"   Resolution: {width}x{height}")
    print(f"   FPS: {fps:.2f}")
    print(f"   Frame count: {frame_count}")
    print(f"   File size: {file_size / 1024 / 1024:.1f} MB")
    cap.release()

    # Initialize ball detector
    print("\n2. Initializing ball detector...")
    detector = BallDetector(confidence_threshold=0.3)  # Lower threshold for testing
    detector.load_model()
    print(f"   Model loaded on device: {detector.device}")

    # Test on entire video
    print(f"\n3. Detecting ball in entire video ({duration:.1f}s)...")
    start_time = 0.0
    end_time = duration

    def progress_callback(progress):
        print(f"   Progress: {progress:.1f}%", end="\r")

    detections = detector.detect_ball_in_video_segment(
        video_path,
        start_time=start_time,
        end_time=end_time,
        sample_fps=10.0,  # Sample at 10 FPS for speed
        progress_callback=progress_callback,
    )
    print()  # New line after progress

    # Summarize detections
    total_frames = len(detections)
    frames_with_ball = sum(1 for d in detections if d["detection"] is not None)

    print(f"\n4. Results:")
    print(f"   Frames analyzed: {total_frames}")
    print(f"   Frames with ball detected: {frames_with_ball}")
    print(f"   Detection rate: {frames_with_ball / total_frames * 100:.1f}%")

    # Show some detections
    if frames_with_ball > 0:
        print("\n5. Sample detections (first and last 5):")
        ball_detections = [d for d in detections if d["detection"] is not None]

        print("   First 5:")
        for det in ball_detections[:5]:
            d = det["detection"]
            print(f"     t={det['timestamp']:.2f}s: conf={d['confidence']:.2f}, "
                  f"center=({d['center'][0]:.0f}, {d['center'][1]:.0f})")

        if len(ball_detections) > 10:
            print("   ...")
            print("   Last 5:")
            for det in ball_detections[-5:]:
                d = det["detection"]
                print(f"     t={det['timestamp']:.2f}s: conf={d['confidence']:.2f}, "
                      f"center=({d['center'][0]:.0f}, {d['center'][1]:.0f})")

    # Track ball flight if we have detections
    if frames_with_ball >= 2:
        print("\n6. Tracking ball flight...")
        trajectory, confidence = detector.track_ball_flight(detections)
        print(f"   Trajectory points: {len(trajectory)}")
        print(f"   Overall confidence: {confidence:.2f}")

        # Check if ball is in motion
        is_moving = detector.detect_ball_in_motion(detections)
        print(f"   Ball in motion: {is_moving}")

    print("\n" + "=" * 50)
    print("Test complete!")


if __name__ == "__main__":
    main()
