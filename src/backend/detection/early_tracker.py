# src/backend/detection/early_tracker.py
"""Early ball tracking for the first 0.5 seconds after impact.

Uses layered detection:
1. Physics-guided search cones
2. Color family matching
3. Multi-frame validation

Designed to minimize false negatives - prefers finding something over finding nothing.
"""

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger

from backend.detection.color_family import (
    ColorFamily,
    ColorTemplate,
    compute_color_match_score,
    extract_color_template,
)
from backend.detection.search_expansion import (
    SearchExpansionStrategy,
    calculate_refined_search_corridor,
)


@dataclass
class DetectionCandidate:
    """A candidate ball detection in a single frame."""
    frame_idx: int
    x: float
    y: float
    color_score: float
    motion_score: float
    physics_score: float = 0.0
    combined_score: float = 0.0
    radius: float = 10.0


@dataclass
class EarlyDetection:
    """A validated ball detection in the early flight window."""
    timestamp: float  # Seconds from video start
    x: float  # X position in pixels
    y: float  # Y position in pixels
    confidence: float  # Combined confidence score
    color_score: float
    motion_score: float
    physics_score: float


@dataclass
class ValidatedTrack:
    """A validated sequence of ball detections."""
    detections: List[DetectionCandidate]
    confidence: float
    velocity: Tuple[float, float] = (0.0, 0.0)


# Movement constraints
MIN_MOVEMENT = 10  # Minimum pixels per frame
MAX_MOVEMENT = 200  # Maximum pixels per frame
MIN_UPWARD_RATIO = 0.5  # At least 50% of movement should be upward
MAX_DIRECTION_CHANGE = math.radians(25)  # 25 degrees max per frame


def find_best_continuation(
    prev: DetectionCandidate,
    candidates: List[DetectionCandidate],
    track_history: List[DetectionCandidate],
) -> Optional[DetectionCandidate]:
    """
    Find the candidate most likely to be the same ball.

    Key insight: Ball moves FAST. Don't constrain distance, constrain DIRECTION.
    """
    if not candidates:
        return None

    # Calculate expected direction from track history
    if len(track_history) >= 2:
        recent_dx = track_history[-1].x - track_history[-2].x
        recent_dy = track_history[-1].y - track_history[-2].y
        expected_direction = math.atan2(recent_dy, recent_dx)
        has_expected_direction = True
    else:
        expected_direction = -math.pi / 2  # Straight up
        has_expected_direction = False

    best_candidate = None
    best_score = 0.0

    for candidate in candidates:
        dx = candidate.x - prev.x
        dy = candidate.y - prev.y
        distance = math.sqrt(dx**2 + dy**2)

        # Distance sanity check (very permissive)
        if distance < MIN_MOVEMENT or distance > MAX_MOVEMENT:
            continue

        # Must be moving upward (dy < 0 in screen coords)
        if dy >= 0:
            continue

        # Check upward ratio
        upward_component = abs(dy)
        horizontal_component = abs(dx)
        total = upward_component + horizontal_component
        upward_ratio = upward_component / total if total > 0 else 0

        if upward_ratio < MIN_UPWARD_RATIO:
            continue

        # Calculate actual direction
        actual_direction = math.atan2(dy, dx)

        # Direction consistency score
        if has_expected_direction:
            direction_diff = abs(actual_direction - expected_direction)
            direction_diff = min(direction_diff, 2 * math.pi - direction_diff)
            direction_score = max(0.0, 1.0 - direction_diff / (math.pi / 6))
        else:
            direction_diff = abs(actual_direction - (-math.pi / 2))
            direction_score = max(0.0, 1.0 - direction_diff / (math.pi / 3))

        # Combined score
        color_score = candidate.color_score
        combined_score = 0.6 * direction_score + 0.4 * color_score

        if combined_score > best_score:
            best_score = combined_score
            best_candidate = candidate

    return best_candidate if best_score > 0.3 else None


def validate_track_velocity(track: List[DetectionCandidate]) -> bool:
    """
    Validate that velocity changes are physically plausible.
    """
    if len(track) < 3:
        return True

    velocities = []
    directions = []

    for i in range(1, len(track)):
        dx = track[i].x - track[i - 1].x
        dy = track[i].y - track[i - 1].y

        velocity = math.sqrt(dx**2 + dy**2)
        direction = math.atan2(dy, dx)

        velocities.append(velocity)
        directions.append(direction)

    # Check 1: Ball shouldn't speed up repeatedly
    velocity_increases = 0
    for i in range(1, len(velocities)):
        if velocities[i] > velocities[i - 1] * 1.3:
            velocity_increases += 1

    if velocity_increases > len(velocities) // 2:
        return False

    # Check 2: Direction should be consistent
    for i in range(1, len(directions)):
        direction_change = abs(directions[i] - directions[i - 1])
        direction_change = min(direction_change, 2 * math.pi - direction_change)

        if direction_change > MAX_DIRECTION_CHANGE:
            return False

    return True


class EarlyBallTracker:
    """
    Detects ball in the first 0.5 seconds after impact.
    """

    DETECTION_WINDOW_SEC = 0.5
    MIN_REQUIRED_DETECTIONS = 5
    DIFF_THRESHOLD = 15
    MIN_CONTOUR_AREA = 5
    MAX_CONTOUR_AREA = 500

    def __init__(
        self,
        video_path: Path,
        origin_x: float,
        origin_y: float,
        strike_time: float,
        frame_width: int,
        frame_height: int,
        fps: float = 60.0,
    ):
        self.video_path = video_path
        self.origin_x = origin_x
        self.origin_y = origin_y
        self.strike_time = strike_time
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.fps = fps

        self.color_template: Optional[ColorTemplate] = None
        self.validated_track: Optional[ValidatedTrack] = None

    def detect(
        self,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> List[EarlyDetection]:
        """Run detection pipeline without constraints."""
        return self.detect_with_constraints(
            apex=None,
            landing=None,
            shot_shape="straight",
            starting_line="center",
            shot_height="medium",
            flight_time=3.0,
            progress_callback=progress_callback,
        )

    def detect_with_constraints(
        self,
        apex: Optional[Tuple[float, float]],
        landing: Optional[Tuple[float, float]],
        shot_shape: str,
        starting_line: str,
        shot_height: str,
        flight_time: float,
        progress_callback: Optional[Callable[[int, str], None]] = None,
    ) -> List[EarlyDetection]:
        """Run detection with user-provided constraints."""
        def emit_progress(percent: int, message: str):
            if progress_callback:
                progress_callback(percent, message)

        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {self.video_path}")
            return []

        try:
            emit_progress(5, "Extracting ball color template...")
            self.color_template = self._extract_color_template(cap)

            emit_progress(15, "Running detection passes...")

            expansion = SearchExpansionStrategy(
                origin=(self.origin_x / self.frame_width,
                        self.origin_y / self.frame_height),
                frame_width=self.frame_width,
                frame_height=self.frame_height,
            )

            best_detections: List[EarlyDetection] = []
            best_confidence = 0.0
            expansion_level_used = 0

            for level in range(4):
                level_name = SearchExpansionStrategy.EXPANSION_LEVELS[level].name
                emit_progress(20 + level * 15, f"Detection pass {level + 1}/4 ({level_name})...")

                candidates_by_frame = self._detect_all_frames(
                    cap=cap,
                    expansion=expansion,
                    level=level,
                    apex=apex,
                    landing=landing,
                    shot_shape=shot_shape,
                    starting_line=starting_line,
                    shot_height=shot_height,
                    flight_time=flight_time,
                )

                tracks = self._validate_tracks(candidates_by_frame)

                if tracks:
                    best_track = max(tracks, key=lambda t: t.confidence)
                    detections = self._track_to_detections(best_track)

                    if len(detections) >= self.MIN_REQUIRED_DETECTIONS:
                        self.validated_track = best_track
                        expansion_level_used = level
                        emit_progress(90, f"Found {len(detections)} detections")
                        return detections

                    if best_track.confidence > best_confidence:
                        best_detections = detections
                        best_confidence = best_track.confidence
                        expansion_level_used = level

            emit_progress(95, "Finalizing results...")
            return best_detections

        finally:
            cap.release()

    def _extract_color_template(self, cap: cv2.VideoCapture) -> Optional[ColorTemplate]:
        """Extract ball color from frame 0.5s before strike."""
        template_time = self.strike_time - 0.5
        if template_time < 0:
            template_time = 0

        frame_idx = int(template_time * self.fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)

        ret, frame = cap.read()
        if not ret:
            logger.warning("Could not read template frame")
            return None

        return extract_color_template(
            frame,
            int(self.origin_x),
            int(self.origin_y),
        )

    def _detect_all_frames(
        self,
        cap: cv2.VideoCapture,
        expansion: SearchExpansionStrategy,
        level: int,
        apex: Optional[Tuple[float, float]],
        landing: Optional[Tuple[float, float]],
        shot_shape: str,
        starting_line: str,
        shot_height: str,
        flight_time: float,
    ) -> Dict[int, List[DetectionCandidate]]:
        """Detect candidates in all frames at given expansion level."""
        candidates_by_frame: Dict[int, List[DetectionCandidate]] = {}

        start_frame = int(self.strike_time * self.fps)
        end_frame = int((self.strike_time + self.DETECTION_WINDOW_SEC) * self.fps)

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        prev_gray = None

        for frame_idx in range(start_frame, end_frame):
            ret, frame = cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            elapsed = (frame_idx - start_frame) / self.fps
            rel_frame = frame_idx - start_frame

            if landing:
                base_region = calculate_refined_search_corridor(
                    origin=(self.origin_x / self.frame_width,
                            self.origin_y / self.frame_height),
                    apex=apex,
                    landing=landing,
                    shot_shape=shot_shape,
                    starting_line=starting_line,
                    shot_height=shot_height,
                    elapsed_sec=elapsed,
                    total_flight_time=flight_time,
                    frame_width=self.frame_width,
                    frame_height=self.frame_height,
                )
            else:
                base_region = self._get_default_search_region(elapsed)

            search_region = expansion.get_search_region(level, elapsed, base_region)

            frame_candidates = self._detect_in_frame(
                gray, hsv, prev_gray, search_region, elapsed, rel_frame
            )

            if frame_candidates:
                candidates_by_frame[rel_frame] = frame_candidates

            prev_gray = gray.copy()

        return candidates_by_frame

    def _get_default_search_region(self, elapsed: float) -> Tuple[int, int, int, int]:
        """Get default cone-based search region."""
        half_width = int(40 + elapsed * 120)
        height_above = int(50 + elapsed * 500)

        return (
            max(0, int(self.origin_x) - half_width),
            max(0, int(self.origin_y) - height_above),
            min(self.frame_width, int(self.origin_x) + half_width),
            min(self.frame_height, int(self.origin_y) + 50),
        )

    def _detect_in_frame(
        self,
        gray: np.ndarray,
        hsv: np.ndarray,
        prev_gray: Optional[np.ndarray],
        search_region: Tuple[int, int, int, int],
        elapsed: float,
        frame_idx: int,
    ) -> List[DetectionCandidate]:
        """Detect ball candidates in a single frame."""
        candidates = []
        x1, y1, x2, y2 = search_region

        if prev_gray is not None:
            diff = cv2.absdiff(prev_gray, gray)
            _, thresh = cv2.threshold(diff, self.DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)

            mask = np.zeros_like(thresh)
            mask[y1:y2, x1:x2] = 255
            thresh = cv2.bitwise_and(thresh, mask)

            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            for contour in contours:
                area = cv2.contourArea(contour)
                if self.MIN_CONTOUR_AREA <= area <= self.MAX_CONTOUR_AREA:
                    M = cv2.moments(contour)
                    if M["m00"] > 0:
                        cx = M["m10"] / M["m00"]
                        cy = M["m01"] / M["m00"]

                        color_score = 0.5
                        if self.color_template:
                            pixel_hsv = hsv[int(cy), int(cx)]
                            color_score = compute_color_match_score(
                                tuple(pixel_hsv),
                                self.color_template,
                                elapsed,
                            )

                        motion_score = min(1.0, area / 100)

                        candidates.append(DetectionCandidate(
                            frame_idx=frame_idx,
                            x=cx,
                            y=cy,
                            color_score=color_score,
                            motion_score=motion_score,
                        ))

        return candidates

    def _validate_tracks(
        self,
        candidates_by_frame: Dict[int, List[DetectionCandidate]],
    ) -> List[ValidatedTrack]:
        """Validate and link detections into tracks."""
        tracks = []

        for start_frame in sorted(candidates_by_frame.keys()):
            for start_candidate in candidates_by_frame[start_frame]:
                track = [start_candidate]

                for next_frame in range(start_frame + 1, start_frame + 20):
                    if next_frame not in candidates_by_frame:
                        continue

                    best_match = find_best_continuation(
                        track[-1],
                        candidates_by_frame[next_frame],
                        track,
                    )

                    if best_match:
                        track.append(best_match)

                if len(track) >= 3 and validate_track_velocity(track):
                    confidence = self._compute_track_confidence(track)
                    if confidence > 0.3:
                        tracks.append(ValidatedTrack(
                            detections=track,
                            confidence=confidence,
                        ))

        return self._select_best_tracks(tracks)

    def _compute_track_confidence(self, track: List[DetectionCandidate]) -> float:
        """Compute confidence score for a track."""
        scores = []

        length_score = min(1.0, len(track) / 10.0)
        scores.append(length_score * 0.3)

        directions = []
        for i in range(1, len(track)):
            dy = track[i].y - track[i - 1].y
            directions.append(dy < 0)

        direction_score = sum(directions) / len(directions) if directions else 0
        scores.append(direction_score * 0.3)

        avg_color = np.mean([d.color_score for d in track])
        scores.append(avg_color * 0.4)

        return sum(scores)

    def _select_best_tracks(self, tracks: List[ValidatedTrack]) -> List[ValidatedTrack]:
        """Select non-overlapping tracks with best confidence."""
        if not tracks:
            return []

        tracks.sort(key=lambda t: t.confidence, reverse=True)

        selected = []
        used_frames = set()

        for track in tracks:
            track_frames = {d.frame_idx for d in track.detections}
            if not track_frames.intersection(used_frames):
                selected.append(track)
                used_frames.update(track_frames)

        return selected

    def _track_to_detections(self, track: ValidatedTrack) -> List[EarlyDetection]:
        """Convert validated track to list of EarlyDetection objects."""
        detections = []

        for det in track.detections:
            timestamp = self.strike_time + (det.frame_idx / self.fps)
            detections.append(EarlyDetection(
                timestamp=timestamp,
                x=det.x,
                y=det.y,
                confidence=det.color_score * 0.5 + det.motion_score * 0.5,
                color_score=det.color_score,
                motion_score=det.motion_score,
                physics_score=det.physics_score,
            ))

        return detections
