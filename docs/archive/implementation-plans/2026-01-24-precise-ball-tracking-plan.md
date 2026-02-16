# Precise Ball Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Track the actual golf ball frame-by-frame for more accurate trajectories, keeping the origin point unchanged.

**Architecture:** Multi-stage detection pipeline: extract ball template from first frames → match at multiple scales as ball shrinks → use Kalman filter for prediction → score candidates → assemble into trajectory. Falls back to physics-based generation when detection fails.

**Tech Stack:** OpenCV (template matching, optical flow), NumPy (Kalman filter), existing tracker.py infrastructure

---

## Current State

The current `tracker.py` detects ~6 ball positions in the first 100ms using motion differencing, then generates a synthetic parabolic arc. We want to track the actual ball throughout its flight.

**Working well (DO NOT CHANGE):**
- Ball origin detection via shaft + clubhead (origin.py)
- Physics-based trajectory generation (trajectory_physics.py)

**Test video:** `/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov`
- Shot 1: strike_time=18.25s, origin=(1579, 1814)

---

## Task 1: Ball Template Extractor

**Files:**
- Create: `src/backend/detection/ball_template.py`
- Create: `src/backend/tests/test_ball_template.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_ball_template.py
"""Tests for ball template extraction."""

import numpy as np
import cv2
import pytest

from backend.detection.ball_template import BallTemplateExtractor, BallTemplate


class TestBallTemplateExtractor:
    """Tests for BallTemplateExtractor."""

    def test_circularity_perfect_circle(self):
        """Circularity of a perfect circle should be close to 1.0."""
        extractor = BallTemplateExtractor()
        # Create a perfect circle contour
        contour = np.array([
            [[50 + int(20 * np.cos(a)), 50 + int(20 * np.sin(a))]]
            for a in np.linspace(0, 2 * np.pi, 36)
        ], dtype=np.int32)
        circularity = extractor._calculate_circularity(contour)
        assert 0.9 < circularity <= 1.0, f"Expected ~1.0, got {circularity}"

    def test_brightness_filter_rejects_dark(self):
        """Dark blobs should be rejected."""
        extractor = BallTemplateExtractor(min_brightness=120)
        # A candidate with low brightness should be filtered
        candidates = [
            {"x": 100, "y": 100, "radius": 10, "brightness": 80, "circularity": 0.9},
            {"x": 200, "y": 200, "radius": 10, "brightness": 200, "circularity": 0.9},
        ]
        filtered = [c for c in candidates if c["brightness"] >= extractor.min_brightness]
        assert len(filtered) == 1
        assert filtered[0]["brightness"] == 200

    def test_extract_template_returns_ball_template(self):
        """Template extraction should return a BallTemplate with correct fields."""
        # Create synthetic frames with a white circle
        frame1 = np.zeros((200, 200, 3), dtype=np.uint8)
        frame2 = np.zeros((200, 200, 3), dtype=np.uint8)
        cv2.circle(frame1, (100, 100), 10, (255, 255, 255), -1)
        cv2.circle(frame2, (105, 95), 10, (255, 255, 255), -1)  # Moved

        extractor = BallTemplateExtractor()
        template = extractor._extract_from_frames(
            [frame1, frame2],
            origin_x=100,
            origin_y=100,
            max_distance=50,
        )

        assert template is not None
        assert isinstance(template, BallTemplate)
        assert template.radius > 0
        assert template.brightness > 100
        assert template.image is not None
        assert template.mask is not None
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_ball_template.py -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'backend.detection.ball_template'"

**Step 3: Write the implementation**

```python
# src/backend/detection/ball_template.py
"""Ball template extraction for tracking.

Extracts a template of the golf ball from the first few frames after impact
when the ball is most visible. This template is used by the multi-scale
matcher for subsequent tracking.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


@dataclass
class BallTemplate:
    """Extracted ball template for matching."""

    image: np.ndarray  # Grayscale template (cropped ball region)
    mask: np.ndarray  # Circular mask for matching
    center: Tuple[int, int]  # Center position in original frame
    radius: int  # Estimated ball radius in pixels
    brightness: float  # Average brightness (0-255)
    frame_index: int  # Which frame this was extracted from
    confidence: float  # How confident we are this is the ball


class BallTemplateExtractor:
    """Extract ball template from early frames for tracking.

    Strategy:
    1. Use motion differencing to find moving objects in first 6 frames
    2. Filter by brightness (golf ball is white)
    3. Filter by size (golf ball is small, ~10-30px diameter at start)
    4. Filter by shape (should be roughly circular)
    5. Extract best candidate as template
    """

    # Size constraints (at typical 4K resolution)
    MIN_RADIUS = 4  # Minimum ball radius in pixels
    MAX_RADIUS = 25  # Maximum ball radius in pixels

    # Brightness constraint
    MIN_BRIGHTNESS = 120  # Golf balls are white

    # Shape constraint
    MIN_CIRCULARITY = 0.6  # Must be roughly circular

    # Motion detection
    DIFF_THRESHOLD = 20  # Brightness difference threshold

    def __init__(
        self,
        min_radius: int = MIN_RADIUS,
        max_radius: int = MAX_RADIUS,
        min_brightness: float = MIN_BRIGHTNESS,
        min_circularity: float = MIN_CIRCULARITY,
    ):
        """Initialize the template extractor.

        Args:
            min_radius: Minimum expected ball radius
            max_radius: Maximum expected ball radius
            min_brightness: Minimum brightness for ball candidate
            min_circularity: Minimum circularity (1.0 = perfect circle)
        """
        self.min_radius = min_radius
        self.max_radius = max_radius
        self.min_brightness = min_brightness
        self.min_circularity = min_circularity

    def extract_template(
        self,
        video_path: str,
        origin_x: float,
        origin_y: float,
        strike_time: float,
        search_frames: int = 6,
    ) -> Optional[BallTemplate]:
        """Extract ball template from early frames after strike.

        Args:
            video_path: Path to video file
            origin_x: Ball origin X in pixels
            origin_y: Ball origin Y in pixels
            strike_time: When the ball was struck (seconds)
            search_frames: How many frames to search

        Returns:
            BallTemplate if found, None otherwise
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0:
                logger.error("Invalid FPS")
                return None

            start_frame = int(strike_time * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

            frames = []
            for _ in range(search_frames + 1):
                ret, frame = cap.read()
                if not ret:
                    break
                frames.append(frame)

            if len(frames) < 2:
                logger.warning("Not enough frames for template extraction")
                return None

            return self._extract_from_frames(
                frames,
                origin_x=origin_x,
                origin_y=origin_y,
                max_distance=200,
            )
        finally:
            cap.release()

    def _extract_from_frames(
        self,
        frames: List[np.ndarray],
        origin_x: float,
        origin_y: float,
        max_distance: float,
    ) -> Optional[BallTemplate]:
        """Extract template from a list of frames.

        Args:
            frames: List of BGR frames
            origin_x, origin_y: Ball origin position
            max_distance: Maximum distance from origin to search

        Returns:
            BallTemplate or None
        """
        best_candidate = None
        best_score = 0.0
        best_frame_idx = 0

        for i in range(1, len(frames)):
            prev_gray = cv2.cvtColor(frames[i - 1], cv2.COLOR_BGR2GRAY)
            curr_gray = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY)

            candidates = self._find_ball_candidates(
                prev_gray, curr_gray, origin_x, origin_y, max_distance
            )

            for cand in candidates:
                # Score based on brightness, circularity, and distance from origin
                brightness_score = min(cand["brightness"] / 255.0, 1.0)
                circularity_score = cand["circularity"]
                dist = np.sqrt(
                    (cand["x"] - origin_x) ** 2 + (cand["y"] - origin_y) ** 2
                )
                # Prefer candidates that are above origin (ball goes up)
                vertical_score = 1.0 if cand["y"] < origin_y else 0.5
                distance_score = max(0, 1.0 - dist / max_distance)

                score = (
                    brightness_score * 0.3
                    + circularity_score * 0.3
                    + vertical_score * 0.2
                    + distance_score * 0.2
                )

                if score > best_score:
                    best_score = score
                    best_candidate = cand
                    best_candidate["frame"] = curr_gray
                    best_frame_idx = i

        if best_candidate is None or best_score < 0.5:
            logger.warning(f"No suitable ball candidate found (best score: {best_score:.2f})")
            return None

        return self._create_template(best_candidate, best_frame_idx)

    def _find_ball_candidates(
        self,
        prev_gray: np.ndarray,
        curr_gray: np.ndarray,
        origin_x: float,
        origin_y: float,
        max_distance: float,
    ) -> List[dict]:
        """Find ball candidates using motion differencing.

        Args:
            prev_gray: Previous frame (grayscale)
            curr_gray: Current frame (grayscale)
            origin_x, origin_y: Ball origin position
            max_distance: Maximum distance from origin to search

        Returns:
            List of candidate dicts with x, y, radius, brightness, circularity
        """
        # Create search mask around origin
        h, w = prev_gray.shape
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (int(origin_x), int(origin_y)), int(max_distance), 255, -1)

        # Frame differencing
        diff = cv2.absdiff(prev_gray, curr_gray)
        diff_masked = cv2.bitwise_and(diff, diff, mask=mask)

        # Threshold
        _, thresh = cv2.threshold(diff_masked, self.DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)

        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        # Find contours
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < np.pi * self.min_radius**2 or area > np.pi * self.max_radius**2:
                continue

            # Calculate circularity
            circularity = self._calculate_circularity(contour)
            if circularity < self.min_circularity:
                continue

            # Get center and radius
            (cx, cy), radius = cv2.minEnclosingCircle(contour)
            if radius < self.min_radius or radius > self.max_radius:
                continue

            # Check brightness at this location
            contour_mask = np.zeros_like(curr_gray)
            cv2.drawContours(contour_mask, [contour], -1, 255, -1)
            brightness = cv2.mean(curr_gray, mask=contour_mask)[0]

            if brightness < self.min_brightness:
                continue

            candidates.append({
                "x": cx,
                "y": cy,
                "radius": radius,
                "brightness": brightness,
                "circularity": circularity,
                "contour": contour,
            })

        return candidates

    def _calculate_circularity(self, contour: np.ndarray) -> float:
        """Calculate how circular a contour is (1.0 = perfect circle)."""
        area = cv2.contourArea(contour)
        perimeter = cv2.arcLength(contour, True)
        if perimeter == 0:
            return 0.0
        return 4 * np.pi * area / (perimeter * perimeter)

    def _create_template(self, candidate: dict, frame_idx: int) -> BallTemplate:
        """Create BallTemplate from a candidate detection.

        Args:
            candidate: Detection candidate dict with frame
            frame_idx: Which frame this was from

        Returns:
            BallTemplate
        """
        frame = candidate["frame"]
        cx, cy = int(candidate["x"]), int(candidate["y"])
        radius = int(candidate["radius"])
        padding = 5

        # Extract region around ball
        h, w = frame.shape
        x1 = max(0, cx - radius - padding)
        y1 = max(0, cy - radius - padding)
        x2 = min(w, cx + radius + padding)
        y2 = min(h, cy + radius + padding)

        template_image = frame[y1:y2, x1:x2].copy()

        # Create circular mask
        mask_size = template_image.shape[:2]
        mask = np.zeros(mask_size, dtype=np.uint8)
        mask_cx = template_image.shape[1] // 2
        mask_cy = template_image.shape[0] // 2
        cv2.circle(mask, (mask_cx, mask_cy), radius + 2, 255, -1)

        return BallTemplate(
            image=template_image,
            mask=mask,
            center=(cx, cy),
            radius=radius,
            brightness=candidate["brightness"],
            frame_index=frame_idx,
            confidence=candidate.get("score", 0.7),
        )
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_ball_template.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/ball_template.py src/backend/tests/test_ball_template.py
git commit -m "feat: add ball template extraction for tracking"
```

---

## Task 2: Multi-Scale Template Matcher

**Files:**
- Create: `src/backend/detection/scale_matcher.py`
- Create: `src/backend/tests/test_scale_matcher.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_scale_matcher.py
"""Tests for multi-scale template matching."""

import numpy as np
import cv2
import pytest

from backend.detection.scale_matcher import MultiScaleMatcher, ScaleMatch


class TestMultiScaleMatcher:
    """Tests for MultiScaleMatcher."""

    def test_scale_pyramid_creation(self):
        """Pyramid should have correct number of scales."""
        matcher = MultiScaleMatcher(num_scales=5)
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        matcher.prepare_template(template)
        assert len(matcher._scale_pyramid) == 5

    def test_perfect_match_high_score(self):
        """Identical template should have score close to 1.0."""
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        frame = np.zeros((100, 100), dtype=np.uint8)
        frame[40:61, 40:61] = template

        matcher = MultiScaleMatcher(min_correlation=0.5)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) > 0
        assert matches[0].score > 0.9

    def test_scaled_match(self):
        """Should find ball at different scale."""
        # Create template (larger ball)
        template = np.zeros((31, 31), dtype=np.uint8)
        cv2.circle(template, (15, 15), 12, 255, -1)

        # Create frame with smaller ball
        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 80), 8, 255, -1)

        matcher = MultiScaleMatcher(min_scale=0.4, max_scale=1.2, min_correlation=0.5)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) > 0
        best = matches[0]
        assert 90 < best.x < 110, f"X position off: {best.x}"
        assert 70 < best.y < 90, f"Y position off: {best.y}"
        assert best.scale < 1.0, f"Scale should be < 1.0: {best.scale}"

    def test_no_match_below_threshold(self):
        """Should not return matches below threshold."""
        template = np.zeros((21, 21), dtype=np.uint8)
        cv2.circle(template, (10, 10), 8, 255, -1)

        # Frame with no ball
        frame = np.zeros((100, 100), dtype=np.uint8)

        matcher = MultiScaleMatcher(min_correlation=0.7)
        matcher.prepare_template(template)
        matches = matcher.match_full_frame(frame)

        assert len(matches) == 0
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_scale_matcher.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# src/backend/detection/scale_matcher.py
"""Multi-scale template matching for ball detection.

Matches the ball template at multiple scales to find the ball as it
appears smaller in the distance. Uses normalized cross-correlation.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


@dataclass
class ScaleMatch:
    """Result of multi-scale template matching."""

    x: float  # Center X in pixels
    y: float  # Center Y in pixels
    scale: float  # Scale factor (1.0 = original size)
    score: float  # Match correlation score (0-1)
    radius: float  # Apparent radius at this scale


class MultiScaleMatcher:
    """Match ball template at multiple scales.

    As the ball travels away from the camera, it appears smaller.
    This matcher searches at multiple scales to find the ball.
    """

    MIN_SCALE = 0.3  # Ball can shrink to 30% when far away
    MAX_SCALE = 1.5  # Ball might be slightly larger if closer
    NUM_SCALES = 8  # Number of scales to try
    MIN_CORRELATION = 0.6  # Minimum correlation score

    def __init__(
        self,
        min_scale: float = MIN_SCALE,
        max_scale: float = MAX_SCALE,
        num_scales: int = NUM_SCALES,
        min_correlation: float = MIN_CORRELATION,
    ):
        """Initialize the multi-scale matcher.

        Args:
            min_scale: Minimum scale factor
            max_scale: Maximum scale factor
            num_scales: Number of scale levels
            min_correlation: Minimum correlation threshold
        """
        self.min_scale = min_scale
        self.max_scale = max_scale
        self.num_scales = num_scales
        self.min_correlation = min_correlation
        self._scale_pyramid: List[Tuple[np.ndarray, Optional[np.ndarray], float]] = []
        self._original_radius = 0

    def prepare_template(
        self,
        template_image: np.ndarray,
        template_mask: Optional[np.ndarray] = None,
    ) -> None:
        """Prepare scale pyramid from template.

        Args:
            template_image: Grayscale template image
            template_mask: Optional circular mask
        """
        self._original_radius = min(template_image.shape) // 2
        self._scale_pyramid = self._create_scale_pyramid(template_image, template_mask)
        logger.debug(f"Created scale pyramid with {len(self._scale_pyramid)} levels")

    def match_in_region(
        self,
        frame_gray: np.ndarray,
        search_region: Tuple[int, int, int, int],
        expected_scale: Optional[float] = None,
    ) -> List[ScaleMatch]:
        """Find template matches in a region of the frame.

        Args:
            frame_gray: Grayscale frame to search
            search_region: (x1, y1, x2, y2) region to search
            expected_scale: If known, prioritize nearby scales

        Returns:
            List of ScaleMatch sorted by score (best first)
        """
        x1, y1, x2, y2 = search_region
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(frame_gray.shape[1], x2), min(frame_gray.shape[0], y2)

        region = frame_gray[y1:y2, x1:x2]
        if region.size == 0:
            return []

        matches = self._match_in_image(region, expected_scale)

        # Offset matches to frame coordinates
        for m in matches:
            m.x += x1
            m.y += y1

        return matches

    def match_full_frame(
        self,
        frame_gray: np.ndarray,
        exclude_region: Optional[Tuple[int, int, int, int]] = None,
    ) -> List[ScaleMatch]:
        """Find template matches in full frame.

        Args:
            frame_gray: Grayscale frame
            exclude_region: Optional region to exclude

        Returns:
            List of ScaleMatch sorted by score
        """
        return self._match_in_image(frame_gray)

    def _match_in_image(
        self,
        image: np.ndarray,
        expected_scale: Optional[float] = None,
    ) -> List[ScaleMatch]:
        """Match template at all scales in image."""
        if not self._scale_pyramid:
            logger.warning("Template not prepared")
            return []

        all_matches = []

        for template, mask, scale in self._scale_pyramid:
            if template.shape[0] > image.shape[0] or template.shape[1] > image.shape[1]:
                continue

            # Perform template matching
            if mask is not None:
                result = cv2.matchTemplate(image, template, cv2.TM_CCORR_NORMED, mask=mask)
            else:
                result = cv2.matchTemplate(image, template, cv2.TM_CCOEFF_NORMED)

            # Find peaks above threshold
            locations = np.where(result >= self.min_correlation)
            for y, x in zip(*locations):
                score = float(result[y, x])

                # Adjust for expected scale if provided
                if expected_scale is not None:
                    scale_diff = abs(scale - expected_scale)
                    score *= max(0.5, 1.0 - scale_diff)

                cx = x + template.shape[1] // 2
                cy = y + template.shape[0] // 2
                radius = self._original_radius * scale

                all_matches.append(ScaleMatch(
                    x=float(cx),
                    y=float(cy),
                    scale=scale,
                    score=score,
                    radius=radius,
                ))

        # Non-maximum suppression
        matches = self._nms(all_matches, distance_threshold=15)

        # Sort by score
        matches.sort(key=lambda m: m.score, reverse=True)

        return matches

    def _create_scale_pyramid(
        self,
        template: np.ndarray,
        mask: Optional[np.ndarray],
    ) -> List[Tuple[np.ndarray, Optional[np.ndarray], float]]:
        """Create pyramid of scaled templates."""
        pyramid = []

        # Logarithmically spaced scales
        scales = np.geomspace(self.min_scale, self.max_scale, self.num_scales)

        for scale in scales:
            new_size = (
                max(3, int(template.shape[1] * scale)),
                max(3, int(template.shape[0] * scale)),
            )

            scaled_template = cv2.resize(template, new_size, interpolation=cv2.INTER_AREA)

            scaled_mask = None
            if mask is not None:
                scaled_mask = cv2.resize(mask, new_size, interpolation=cv2.INTER_AREA)

            pyramid.append((scaled_template, scaled_mask, scale))

        return pyramid

    def _nms(
        self,
        matches: List[ScaleMatch],
        distance_threshold: float,
    ) -> List[ScaleMatch]:
        """Non-maximum suppression to remove overlapping detections."""
        if not matches:
            return []

        # Sort by score descending
        matches = sorted(matches, key=lambda m: m.score, reverse=True)

        keep = []
        for match in matches:
            # Check if this match overlaps with any kept match
            is_duplicate = False
            for kept in keep:
                dist = np.sqrt((match.x - kept.x) ** 2 + (match.y - kept.y) ** 2)
                if dist < distance_threshold:
                    is_duplicate = True
                    break

            if not is_duplicate:
                keep.append(match)

        return keep
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_scale_matcher.py -v`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/scale_matcher.py src/backend/tests/test_scale_matcher.py
git commit -m "feat: add multi-scale template matcher for ball tracking"
```

---

## Task 3: Kalman Filter Predictor

**Files:**
- Create: `src/backend/detection/kalman_tracker.py`
- Create: `src/backend/tests/test_kalman_tracker.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_kalman_tracker.py
"""Tests for Kalman filter ball predictor."""

import numpy as np
import pytest

from backend.detection.kalman_tracker import BallKalmanFilter, KalmanPrediction, KalmanState


class TestBallKalmanFilter:
    """Tests for BallKalmanFilter."""

    def test_initialization(self):
        """Initial state should match input."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=5, vy=-15)

        state = kf.get_state()
        assert state is not None
        assert abs(state.x - 500) < 0.1
        assert abs(state.y - 800) < 0.1

    def test_prediction_follows_motion(self):
        """Prediction should follow physics model."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=10, vy=-20)

        pred = kf.predict()

        # Should have moved right (positive vx) and up (negative vy, so y decreases)
        assert pred.x > 500
        assert pred.y < 800

    def test_measurement_update_moves_state(self):
        """Update should move state toward measurement."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800)

        kf.predict()
        state = kf.update(measured_x=510, measured_y=790)

        # State should be close to measurement
        assert abs(state.x - 510) < 20
        assert abs(state.y - 790) < 20

    def test_plausibility_rejects_outliers(self):
        """Far measurements should be rejected."""
        kf = BallKalmanFilter(fps=60.0)
        kf.initialize(x=500, y=800, vx=5, vy=-10)

        kf.predict()

        # Close measurement should be plausible
        assert kf.is_measurement_plausible(510, 790) is True

        # Far measurement should not be plausible
        assert kf.is_measurement_plausible(800, 500) is False

    def test_gravity_effect(self):
        """Ball should accelerate downward over time."""
        kf = BallKalmanFilter(fps=60.0, gravity_pixels_per_s2=500)
        kf.initialize(x=500, y=500, vx=0, vy=0)

        # Simulate several frames
        positions = []
        for _ in range(30):
            pred = kf.predict()
            kf.update_no_measurement()
            positions.append(pred.y)

        # Y should be increasing (ball falling down in screen coords)
        # Check that later positions are larger (lower on screen)
        assert positions[-1] > positions[0]
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_kalman_tracker.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# src/backend/detection/kalman_tracker.py
"""Kalman filter for golf ball tracking with physics model.

Uses a constant-acceleration model appropriate for projectile motion.
Provides prediction, update, and plausibility checking.
"""

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
from loguru import logger


@dataclass
class KalmanState:
    """Current state of the Kalman filter."""

    x: float  # Position X
    y: float  # Position Y
    vx: float  # Velocity X
    vy: float  # Velocity Y
    ax: float  # Acceleration X
    ay: float  # Acceleration Y (gravity)
    covariance: np.ndarray  # State covariance matrix


@dataclass
class KalmanPrediction:
    """Predicted state for next frame."""

    x: float
    y: float
    vx: float
    vy: float
    uncertainty_x: float  # Standard deviation of x prediction
    uncertainty_y: float  # Standard deviation of y prediction
    search_radius: float  # Recommended search radius


class BallKalmanFilter:
    """Kalman filter for golf ball tracking with physics model.

    State vector: [x, y, vx, vy, ax, ay]

    The filter helps:
    1. Smooth noisy detections
    2. Predict position when detection fails
    3. Reject false positives far from prediction
    """

    # Process noise (how much motion can vary)
    POSITION_NOISE = 2.0
    VELOCITY_NOISE = 5.0
    ACCELERATION_NOISE = 0.5

    # Measurement noise
    MEASUREMENT_NOISE = 5.0

    def __init__(
        self,
        fps: float = 60.0,
        gravity_pixels_per_s2: float = 500.0,
    ):
        """Initialize the Kalman filter.

        Args:
            fps: Video frame rate
            gravity_pixels_per_s2: Gravity in pixels/s²
        """
        self.fps = fps
        self.dt = 1.0 / fps
        self.gravity = gravity_pixels_per_s2 * self.dt * self.dt

        # State vector: [x, y, vx, vy, ax, ay]
        self._state = None
        self._P = None  # Covariance matrix
        self._initialized = False

        # State transition matrix
        dt = self.dt
        self._F = np.array([
            [1, 0, dt, 0, 0.5*dt*dt, 0],
            [0, 1, 0, dt, 0, 0.5*dt*dt],
            [0, 0, 1, 0, dt, 0],
            [0, 0, 0, 1, 0, dt],
            [0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 1],
        ], dtype=np.float64)

        # Measurement matrix (we only observe position)
        self._H = np.array([
            [1, 0, 0, 0, 0, 0],
            [0, 1, 0, 0, 0, 0],
        ], dtype=np.float64)

        # Process noise covariance
        self._Q = np.diag([
            self.POSITION_NOISE**2,
            self.POSITION_NOISE**2,
            self.VELOCITY_NOISE**2,
            self.VELOCITY_NOISE**2,
            self.ACCELERATION_NOISE**2,
            self.ACCELERATION_NOISE**2,
        ])

        # Measurement noise covariance
        self._R = np.diag([
            self.MEASUREMENT_NOISE**2,
            self.MEASUREMENT_NOISE**2,
        ])

    def initialize(
        self,
        x: float,
        y: float,
        vx: float = 0.0,
        vy: float = 0.0,
    ) -> None:
        """Initialize filter with known position and optional velocity.

        Args:
            x, y: Initial position in pixels
            vx, vy: Initial velocity in pixels/frame
        """
        # State: [x, y, vx, vy, ax, ay]
        # ay is set to gravity (positive = downward in screen coords)
        self._state = np.array([x, y, vx, vy, 0.0, self.gravity], dtype=np.float64)

        # Initial covariance - high uncertainty for velocity
        self._P = np.diag([
            10.0**2,  # x position
            10.0**2,  # y position
            50.0**2,  # vx (high uncertainty)
            50.0**2,  # vy
            1.0**2,   # ax
            1.0**2,   # ay
        ])

        self._initialized = True
        logger.debug(f"Kalman filter initialized at ({x:.1f}, {y:.1f})")

    def predict(self) -> KalmanPrediction:
        """Predict next state without measurement.

        Returns:
            KalmanPrediction with expected position and search radius
        """
        if not self._initialized:
            raise RuntimeError("Kalman filter not initialized")

        # Predict state: x' = F * x
        self._state = self._F @ self._state

        # Predict covariance: P' = F * P * F^T + Q
        self._P = self._F @ self._P @ self._F.T + self._Q

        # Extract uncertainties
        uncertainty_x = np.sqrt(self._P[0, 0])
        uncertainty_y = np.sqrt(self._P[1, 1])
        search_radius = 3.0 * max(uncertainty_x, uncertainty_y)

        return KalmanPrediction(
            x=float(self._state[0]),
            y=float(self._state[1]),
            vx=float(self._state[2]),
            vy=float(self._state[3]),
            uncertainty_x=float(uncertainty_x),
            uncertainty_y=float(uncertainty_y),
            search_radius=float(search_radius),
        )

    def update(
        self,
        measured_x: float,
        measured_y: float,
        measurement_confidence: float = 1.0,
    ) -> KalmanState:
        """Update filter with new measurement.

        Args:
            measured_x, measured_y: Measured ball position
            measurement_confidence: 0-1, lower = more uncertainty

        Returns:
            Updated KalmanState
        """
        if not self._initialized:
            raise RuntimeError("Kalman filter not initialized")

        # Adjust measurement noise based on confidence
        R = self._R.copy()
        if measurement_confidence < 1.0:
            R = R / max(measurement_confidence, 0.1)

        # Measurement vector
        z = np.array([measured_x, measured_y], dtype=np.float64)

        # Innovation (measurement residual)
        y = z - self._H @ self._state

        # Innovation covariance
        S = self._H @ self._P @ self._H.T + R

        # Kalman gain
        K = self._P @ self._H.T @ np.linalg.inv(S)

        # Update state
        self._state = self._state + K @ y

        # Update covariance
        I = np.eye(6)
        self._P = (I - K @ self._H) @ self._P

        return self.get_state()

    def update_no_measurement(self) -> KalmanState:
        """Update when no measurement available.

        Just uses prediction, increases uncertainty.

        Returns:
            Updated KalmanState (prediction only)
        """
        # Covariance already updated in predict(), just return state
        return self.get_state()

    def get_state(self) -> Optional[KalmanState]:
        """Get current state estimate.

        Returns:
            Current KalmanState or None if not initialized
        """
        if not self._initialized:
            return None

        return KalmanState(
            x=float(self._state[0]),
            y=float(self._state[1]),
            vx=float(self._state[2]),
            vy=float(self._state[3]),
            ax=float(self._state[4]),
            ay=float(self._state[5]),
            covariance=self._P.copy(),
        )

    def is_measurement_plausible(
        self,
        measured_x: float,
        measured_y: float,
        sigma_threshold: float = 3.0,
    ) -> bool:
        """Check if a measurement is plausible given current prediction.

        Uses Mahalanobis distance to check if measurement is within
        expected range.

        Args:
            measured_x, measured_y: Candidate measurement
            sigma_threshold: How many standard deviations is acceptable

        Returns:
            True if measurement is plausible
        """
        if not self._initialized:
            return True  # Can't check, accept anything

        # Predicted measurement
        z_pred = self._H @ self._state

        # Measurement
        z = np.array([measured_x, measured_y], dtype=np.float64)

        # Innovation covariance
        S = self._H @ self._P @ self._H.T + self._R

        # Mahalanobis distance
        diff = z - z_pred
        try:
            mahal = np.sqrt(diff @ np.linalg.inv(S) @ diff)
        except np.linalg.LinAlgError:
            # Fallback to Euclidean
            mahal = np.sqrt(np.sum(diff**2)) / self.MEASUREMENT_NOISE

        return mahal <= sigma_threshold

    def get_search_region(
        self,
        sigma_multiplier: float = 3.0,
    ) -> Tuple[int, int, int, int]:
        """Get rectangular search region for next detection.

        Args:
            sigma_multiplier: How many standard deviations to include

        Returns:
            (x1, y1, x2, y2) search region in pixels
        """
        if not self._initialized:
            return (0, 0, 1000, 1000)

        x = self._state[0]
        y = self._state[1]
        sigma_x = np.sqrt(self._P[0, 0]) * sigma_multiplier
        sigma_y = np.sqrt(self._P[1, 1]) * sigma_multiplier

        return (
            int(x - sigma_x),
            int(y - sigma_y),
            int(x + sigma_x),
            int(y + sigma_y),
        )
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_kalman_tracker.py -v`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/kalman_tracker.py src/backend/tests/test_kalman_tracker.py
git commit -m "feat: add Kalman filter predictor for ball tracking"
```

---

## Task 4: Detection Scorer

**Files:**
- Create: `src/backend/detection/detection_scorer.py`
- Create: `src/backend/tests/test_detection_scorer.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_detection_scorer.py
"""Tests for detection scorer."""

import pytest

from backend.detection.detection_scorer import DetectionScorer, DetectionCandidate, ScoredDetection


class TestDetectionScorer:
    """Tests for DetectionScorer."""

    def test_brightness_scoring_prefers_white(self):
        """Brighter candidates should score higher."""
        scorer = DetectionScorer()

        bright = DetectionCandidate(
            x=100, y=100, radius=10, brightness=220,
            template_score=0.7, motion_score=0.7, source="template"
        )
        dark = DetectionCandidate(
            x=100, y=100, radius=10, brightness=80,
            template_score=0.7, motion_score=0.7, source="template"
        )

        scored = scorer.score_candidates([bright, dark])
        assert scored[0].x == bright.x  # Bright should be first

    def test_prediction_agreement(self):
        """Candidates near prediction should score higher."""
        scorer = DetectionScorer()

        near = DetectionCandidate(
            x=105, y=98, radius=10, brightness=200,
            template_score=0.7, motion_score=0.7, source="template"
        )
        far = DetectionCandidate(
            x=200, y=200, radius=10, brightness=200,
            template_score=0.7, motion_score=0.7, source="template"
        )

        scored = scorer.score_candidates(
            [near, far],
            predicted_x=100,
            predicted_y=100,
            prediction_uncertainty=30,
        )
        assert scored[0].x == near.x  # Near should be first

    def test_best_selection(self):
        """Should select highest scoring candidate."""
        scorer = DetectionScorer()

        candidates = [
            DetectionCandidate(x=100, y=100, radius=10, brightness=200,
                               template_score=0.9, motion_score=0.8, source="template"),
            DetectionCandidate(x=150, y=150, radius=10, brightness=180,
                               template_score=0.6, motion_score=0.5, source="motion"),
        ]

        scored = scorer.score_candidates(candidates)
        best = scorer.select_best(scored)

        assert best is not None
        assert best.x == 100

    def test_threshold_enforcement(self):
        """Should return None if no candidate passes threshold."""
        scorer = DetectionScorer(min_confidence=0.9)

        candidates = [
            DetectionCandidate(x=100, y=100, radius=10, brightness=100,
                               template_score=0.3, motion_score=0.3, source="template"),
        ]

        scored = scorer.score_candidates(candidates)
        best = scorer.select_best(scored)

        assert best is None
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_detection_scorer.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# src/backend/detection/detection_scorer.py
"""Detection candidate scoring and selection.

Scores detection candidates based on multiple criteria and selects the best one.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
from loguru import logger


@dataclass
class DetectionCandidate:
    """A potential ball detection to be scored."""

    x: float  # Center X
    y: float  # Center Y
    radius: float  # Apparent radius
    brightness: float  # Average brightness (0-255)
    template_score: float  # Template match score (0-1)
    motion_score: float  # Motion consistency score (0-1)
    source: str  # "template", "motion", "flow"


@dataclass
class ScoredDetection:
    """A scored detection with final confidence."""

    x: float
    y: float
    radius: float
    confidence: float  # Final combined confidence (0-1)
    scores: Dict[str, float]  # Individual score components
    is_selected: bool  # Whether this is the selected detection


class DetectionScorer:
    """Score and select best detection from candidates.

    Combines multiple scoring criteria:
    1. Template match quality
    2. Motion consistency with previous frames
    3. Brightness (golf ball is white)
    4. Position agreement with Kalman prediction
    5. Size consistency (ball shouldn't suddenly change size)
    """

    WEIGHT_TEMPLATE = 0.25
    WEIGHT_MOTION = 0.20
    WEIGHT_BRIGHTNESS = 0.15
    WEIGHT_PREDICTION = 0.25
    WEIGHT_SIZE = 0.15

    MIN_CONFIDENCE = 0.4
    MIN_BRIGHTNESS = 100

    def __init__(
        self,
        weight_template: float = WEIGHT_TEMPLATE,
        weight_motion: float = WEIGHT_MOTION,
        weight_brightness: float = WEIGHT_BRIGHTNESS,
        weight_prediction: float = WEIGHT_PREDICTION,
        weight_size: float = WEIGHT_SIZE,
        min_confidence: float = MIN_CONFIDENCE,
    ):
        """Initialize the scorer with custom weights."""
        self.weights = {
            "template": weight_template,
            "motion": weight_motion,
            "brightness": weight_brightness,
            "prediction": weight_prediction,
            "size": weight_size,
        }
        self.min_confidence = min_confidence
        self._last_radius = None
        self._last_position = None

    def score_candidates(
        self,
        candidates: List[DetectionCandidate],
        predicted_x: Optional[float] = None,
        predicted_y: Optional[float] = None,
        prediction_uncertainty: float = 50.0,
        expected_radius: Optional[float] = None,
    ) -> List[ScoredDetection]:
        """Score all candidates and return sorted results.

        Args:
            candidates: List of detection candidates
            predicted_x, predicted_y: Kalman filter prediction
            prediction_uncertainty: Standard deviation of prediction
            expected_radius: Expected ball radius at this distance

        Returns:
            List of ScoredDetection sorted by confidence (best first)
        """
        scored = []

        for cand in candidates:
            scores = {}

            # Template score
            scores["template"] = cand.template_score

            # Motion score
            scores["motion"] = cand.motion_score

            # Brightness score
            scores["brightness"] = self._score_brightness(cand.brightness)

            # Prediction agreement score
            if predicted_x is not None and predicted_y is not None:
                scores["prediction"] = self._score_prediction_agreement(
                    cand.x, cand.y, predicted_x, predicted_y, prediction_uncertainty
                )
            else:
                scores["prediction"] = 0.5  # Neutral

            # Size consistency score
            scores["size"] = self._score_size_consistency(cand.radius, expected_radius)

            # Weighted combination
            total = 0.0
            for key, score in scores.items():
                total += score * self.weights.get(key, 0)

            confidence = min(1.0, max(0.0, total))

            scored.append(ScoredDetection(
                x=cand.x,
                y=cand.y,
                radius=cand.radius,
                confidence=confidence,
                scores=scores,
                is_selected=False,
            ))

        # Sort by confidence
        scored.sort(key=lambda s: s.confidence, reverse=True)

        # Mark best as selected if above threshold
        if scored and scored[0].confidence >= self.min_confidence:
            scored[0].is_selected = True

        return scored

    def select_best(
        self,
        scored_detections: List[ScoredDetection],
    ) -> Optional[ScoredDetection]:
        """Select the best detection from scored list.

        Args:
            scored_detections: Pre-scored detections

        Returns:
            Best detection, or None if none pass threshold
        """
        if not scored_detections:
            return None

        best = scored_detections[0]
        if best.confidence >= self.min_confidence:
            return best
        return None

    def update_tracking_state(
        self,
        selected: Optional[ScoredDetection],
    ) -> None:
        """Update internal state after selection."""
        if selected:
            self._last_radius = selected.radius
            self._last_position = (selected.x, selected.y)

    def _score_brightness(self, brightness: float) -> float:
        """Score based on brightness (golf ball is white)."""
        if brightness < self.MIN_BRIGHTNESS:
            return 0.2

        # Sigmoid-like scoring, peaks around 200-220
        target = 200.0
        sigma = 50.0
        score = np.exp(-((brightness - target) ** 2) / (2 * sigma ** 2))
        return float(max(0.3, score))

    def _score_prediction_agreement(
        self,
        x: float,
        y: float,
        predicted_x: float,
        predicted_y: float,
        uncertainty: float,
    ) -> float:
        """Score based on distance from prediction."""
        dist = np.sqrt((x - predicted_x) ** 2 + (y - predicted_y) ** 2)

        # Gaussian falloff based on uncertainty
        score = np.exp(-(dist ** 2) / (2 * uncertainty ** 2))
        return float(score)

    def _score_size_consistency(
        self,
        radius: float,
        expected_radius: Optional[float],
    ) -> float:
        """Score based on size consistency."""
        if expected_radius is None and self._last_radius is None:
            return 0.5  # No reference, neutral score

        ref_radius = expected_radius or self._last_radius

        # Ball should gradually shrink, not suddenly change
        ratio = radius / ref_radius if ref_radius > 0 else 1.0

        # Allow 20% variation, penalize more
        if 0.8 <= ratio <= 1.2:
            return 1.0
        elif 0.6 <= ratio <= 1.4:
            return 0.7
        else:
            return 0.3
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_detection_scorer.py -v`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/detection_scorer.py src/backend/tests/test_detection_scorer.py
git commit -m "feat: add detection scorer for ball tracking"
```

---

## Task 5: Trajectory Assembler

**Files:**
- Create: `src/backend/detection/trajectory_assembler.py`
- Create: `src/backend/tests/test_trajectory_assembler.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_trajectory_assembler.py
"""Tests for trajectory assembler."""

import pytest

from backend.detection.trajectory_assembler import TrajectoryAssembler


class TestTrajectoryAssembler:
    """Tests for TrajectoryAssembler."""

    def test_add_detection(self):
        """Should accumulate detections."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)

        assert len(assembler._detections) == 2

    def test_gap_interpolation(self):
        """Small gaps should be filled."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)
        assembler.add_no_detection(2)  # Gap
        assembler.add_no_detection(3)  # Gap
        assembler.add_detection(4, 975, 740, 0.8)
        assembler.add_detection(5, 980, 720, 0.85)

        trajectory = assembler.assemble(strike_time=18.25)

        assert trajectory is not None
        assert len(trajectory.points) >= 6
        assert trajectory.gap_count >= 1

    def test_apex_detection(self):
        """Should find correct apex index."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        # Create a parabolic trajectory
        # In screen coords, lower y = higher on screen
        assembler.add_detection(0, 960, 900, 0.9)  # Start low
        assembler.add_detection(1, 962, 800, 0.9)
        assembler.add_detection(2, 964, 700, 0.9)
        assembler.add_detection(3, 966, 650, 0.9)  # Apex (highest = lowest y)
        assembler.add_detection(4, 968, 700, 0.9)
        assembler.add_detection(5, 970, 800, 0.9)

        trajectory = assembler.assemble(strike_time=0.0)

        assert trajectory is not None
        assert trajectory.apex_index == 3

    def test_insufficient_detections(self):
        """Should return None if too few detections."""
        assembler = TrajectoryAssembler(frame_width=1920, frame_height=1080, fps=60.0)

        assembler.add_detection(0, 960, 800, 0.9)
        assembler.add_detection(1, 965, 780, 0.85)

        trajectory = assembler.assemble(strike_time=0.0)

        assert trajectory is None  # Needs at least 6 points
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_trajectory_assembler.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# src/backend/detection/trajectory_assembler.py
"""Trajectory assembly from frame detections.

Assembles individual frame detections into a coherent trajectory.
Handles gaps, interpolation, and trajectory validation.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np
from loguru import logger


@dataclass
class TrajectoryPoint:
    """A point in the assembled trajectory."""

    timestamp: float
    x: float  # Normalized 0-1
    y: float  # Normalized 0-1
    confidence: float  # Detection confidence
    interpolated: bool  # True if this point was interpolated
    velocity: Optional[Tuple[float, float]] = None


@dataclass
class AssembledTrajectory:
    """Complete assembled trajectory."""

    points: List[TrajectoryPoint]
    start_time: float
    end_time: float
    avg_confidence: float
    gap_count: int
    total_distance: float
    apex_index: int
    method: str


class TrajectoryAssembler:
    """Assemble frame detections into a trajectory.

    Handles:
    1. Converting pixel detections to normalized coordinates
    2. Filling small gaps with interpolation
    3. Finding apex point
    4. Smoothing noisy detections
    """

    MAX_GAP_FRAMES = 5
    MIN_POINTS_FOR_TRAJ = 6
    SMOOTHING_WINDOW = 3

    def __init__(
        self,
        frame_width: int,
        frame_height: int,
        fps: float,
    ):
        """Initialize the assembler.

        Args:
            frame_width: Video frame width
            frame_height: Video frame height
            fps: Video frame rate
        """
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.fps = fps
        self._detections: List[Optional[dict]] = []
        self._frame_indices: List[int] = []

    def add_detection(
        self,
        frame_index: int,
        x_pixels: float,
        y_pixels: float,
        confidence: float,
    ) -> None:
        """Add a detection from a frame."""
        self._detections.append({
            "frame_index": frame_index,
            "x": x_pixels / self.frame_width,
            "y": y_pixels / self.frame_height,
            "confidence": confidence,
        })
        self._frame_indices.append(frame_index)

    def add_no_detection(self, frame_index: int) -> None:
        """Record that no detection was found for this frame."""
        self._detections.append(None)
        self._frame_indices.append(frame_index)

    def assemble(
        self,
        strike_time: float,
    ) -> Optional[AssembledTrajectory]:
        """Assemble detections into trajectory.

        Args:
            strike_time: When the ball was struck (seconds)

        Returns:
            AssembledTrajectory or None if insufficient detections
        """
        # Count valid detections
        valid_detections = [d for d in self._detections if d is not None]
        if len(valid_detections) < self.MIN_POINTS_FOR_TRAJ:
            logger.warning(f"Only {len(valid_detections)} detections, need {self.MIN_POINTS_FOR_TRAJ}")
            return None

        # Build points list with gaps
        points: List[Optional[TrajectoryPoint]] = []
        gap_count = 0

        for i, det in enumerate(self._detections):
            frame_idx = self._frame_indices[i]
            timestamp = strike_time + frame_idx / self.fps

            if det is not None:
                points.append(TrajectoryPoint(
                    timestamp=timestamp,
                    x=det["x"],
                    y=det["y"],
                    confidence=det["confidence"],
                    interpolated=False,
                ))
            else:
                points.append(None)

        # Interpolate gaps
        filled_points = self._interpolate_gaps(points)
        gap_count = sum(1 for p in filled_points if p.interpolated)

        # Smooth trajectory
        smoothed_points = self._smooth_trajectory(filled_points)

        # Find apex
        apex_index = self._find_apex(smoothed_points)

        # Calculate metrics
        avg_confidence = sum(p.confidence for p in smoothed_points) / len(smoothed_points)
        total_distance = self._calculate_distance(smoothed_points)

        return AssembledTrajectory(
            points=smoothed_points,
            start_time=smoothed_points[0].timestamp,
            end_time=smoothed_points[-1].timestamp,
            avg_confidence=avg_confidence,
            gap_count=gap_count,
            total_distance=total_distance,
            apex_index=apex_index,
            method="detection",
        )

    def _interpolate_gaps(
        self,
        points: List[Optional[TrajectoryPoint]],
    ) -> List[TrajectoryPoint]:
        """Fill gaps with interpolated points."""
        result = []
        i = 0

        while i < len(points):
            if points[i] is not None:
                result.append(points[i])
                i += 1
            else:
                # Find start and end of gap
                gap_start = i
                while i < len(points) and points[i] is None:
                    i += 1

                gap_length = i - gap_start

                if gap_length > self.MAX_GAP_FRAMES:
                    # Gap too large, skip
                    logger.debug(f"Gap of {gap_length} frames too large to interpolate")
                    continue

                # Find surrounding points
                if gap_start > 0 and i < len(points) and result and points[i] is not None:
                    p1 = result[-1]
                    p2 = points[i]

                    # Linear interpolation
                    for j in range(gap_length):
                        t = (j + 1) / (gap_length + 1)
                        interp_point = TrajectoryPoint(
                            timestamp=p1.timestamp + t * (p2.timestamp - p1.timestamp),
                            x=p1.x + t * (p2.x - p1.x),
                            y=p1.y + t * (p2.y - p1.y),
                            confidence=0.5,  # Lower confidence for interpolated
                            interpolated=True,
                        )
                        result.append(interp_point)

        return result

    def _smooth_trajectory(
        self,
        points: List[TrajectoryPoint],
    ) -> List[TrajectoryPoint]:
        """Apply smoothing to reduce noise."""
        if len(points) < self.SMOOTHING_WINDOW:
            return points

        smoothed = []
        half_window = self.SMOOTHING_WINDOW // 2

        for i in range(len(points)):
            # Get window bounds
            start = max(0, i - half_window)
            end = min(len(points), i + half_window + 1)

            # Average positions
            window = points[start:end]
            avg_x = sum(p.x for p in window) / len(window)
            avg_y = sum(p.y for p in window) / len(window)

            # Keep original timestamp and confidence
            smoothed.append(TrajectoryPoint(
                timestamp=points[i].timestamp,
                x=avg_x,
                y=avg_y,
                confidence=points[i].confidence,
                interpolated=points[i].interpolated,
            ))

        return smoothed

    def _find_apex(self, points: List[TrajectoryPoint]) -> int:
        """Find the apex (highest point) of the trajectory."""
        if not points:
            return 0

        # In screen coords, lower y = higher on screen
        min_y = float("inf")
        apex_idx = 0

        for i, p in enumerate(points):
            if p.y < min_y:
                min_y = p.y
                apex_idx = i

        return apex_idx

    def _calculate_distance(self, points: List[TrajectoryPoint]) -> float:
        """Calculate total path length."""
        if len(points) < 2:
            return 0.0

        total = 0.0
        for i in range(1, len(points)):
            dx = points[i].x - points[i - 1].x
            dy = points[i].y - points[i - 1].y
            total += np.sqrt(dx ** 2 + dy ** 2)

        return total
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_trajectory_assembler.py -v`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/trajectory_assembler.py src/backend/tests/test_trajectory_assembler.py
git commit -m "feat: add trajectory assembler for ball tracking"
```

---

## Task 6: Optical Flow Tracker

**Files:**
- Create: `src/backend/detection/flow_tracker.py`
- Create: `src/backend/tests/test_flow_tracker.py`

**Step 1: Write the failing test**

```python
# src/backend/tests/test_flow_tracker.py
"""Tests for optical flow tracker."""

import numpy as np
import cv2
import pytest

from backend.detection.flow_tracker import OpticalFlowTracker


class TestOpticalFlowTracker:
    """Tests for OpticalFlowTracker."""

    def test_initialization(self):
        """Should initialize with features at ball position."""
        tracker = OpticalFlowTracker()

        # Create frame with a white circle
        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 100), 10, 255, -1)

        success = tracker.initialize(frame, center=(100, 100), radius=10)
        assert success is True

    def test_motion_tracking(self):
        """Should track motion between frames."""
        tracker = OpticalFlowTracker()

        # Frame 1: ball at (100, 100)
        frame1 = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame1, (100, 100), 10, 255, -1)

        # Frame 2: ball at (110, 90)
        frame2 = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame2, (110, 90), 10, 255, -1)

        tracker.initialize(frame1, center=(100, 100), radius=10)
        result = tracker.track(frame2)

        assert result is not None
        # Ball position should be approximately (110, 90)
        if result.ball_position:
            assert 100 < result.ball_position[0] < 120
            assert 80 < result.ball_position[1] < 100

    def test_reset(self):
        """Reset should clear state."""
        tracker = OpticalFlowTracker()

        frame = np.zeros((200, 200), dtype=np.uint8)
        cv2.circle(frame, (100, 100), 10, 255, -1)

        tracker.initialize(frame, center=(100, 100), radius=10)
        tracker.reset()

        assert tracker._prev_gray is None
        assert tracker._prev_points is None
```

**Step 2: Run test to verify it fails**

Run: `cd src/backend && python -m pytest tests/test_flow_tracker.py -v`
Expected: FAIL with "ModuleNotFoundError"

**Step 3: Write the implementation**

```python
# src/backend/detection/flow_tracker.py
"""Optical flow tracking for golf ball motion.

Uses sparse Lucas-Kanade optical flow to track ball motion between frames.
"""

from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np
from loguru import logger


@dataclass
class FlowVector:
    """Motion vector for a tracked point."""

    x: float  # Current X position
    y: float  # Current Y position
    dx: float  # X velocity (pixels/frame)
    dy: float  # Y velocity (pixels/frame)
    confidence: float  # Tracking quality (0-1)


@dataclass
class FlowResult:
    """Result of optical flow tracking for one frame."""

    vectors: List[FlowVector]
    mean_velocity: Tuple[float, float]
    dominant_velocity: Tuple[float, float]
    ball_position: Optional[Tuple[float, float]]
    confidence: float


class OpticalFlowTracker:
    """Track ball motion using sparse optical flow.

    Uses Lucas-Kanade optical flow on feature points within
    a region around the expected ball position.
    """

    MAX_CORNERS = 20
    QUALITY_LEVEL = 0.1
    MIN_DISTANCE = 5
    WIN_SIZE = (15, 15)
    MAX_LEVEL = 2
    MIN_MOTION = 2.0
    MOTION_ANGLE_TOL = 30

    def __init__(
        self,
        max_corners: int = MAX_CORNERS,
        quality_level: float = QUALITY_LEVEL,
        min_distance: float = MIN_DISTANCE,
    ):
        """Initialize the optical flow tracker."""
        self.max_corners = max_corners
        self.quality_level = quality_level
        self.min_distance = min_distance
        self._prev_gray = None
        self._prev_points = None

    def reset(self) -> None:
        """Reset tracker state for new tracking session."""
        self._prev_gray = None
        self._prev_points = None

    def initialize(
        self,
        frame_gray: np.ndarray,
        center: Tuple[float, float],
        radius: float,
    ) -> bool:
        """Initialize tracking at a known ball position.

        Args:
            frame_gray: Grayscale frame
            center: Ball center (x, y) in pixels
            radius: Ball radius in pixels

        Returns:
            True if initialization successful
        """
        # Create mask around ball position
        mask = np.zeros(frame_gray.shape, dtype=np.uint8)
        cv2.circle(mask, (int(center[0]), int(center[1])), int(radius + 10), 255, -1)

        # Find good features to track in ball region
        points = cv2.goodFeaturesToTrack(
            frame_gray,
            maxCorners=self.max_corners,
            qualityLevel=self.quality_level,
            minDistance=self.min_distance,
            mask=mask,
        )

        if points is None or len(points) < 3:
            logger.debug("Could not find enough features for tracking")
            return False

        self._prev_gray = frame_gray.copy()
        self._prev_points = points.reshape(-1, 1, 2).astype(np.float32)

        logger.debug(f"Initialized tracking with {len(points)} features")
        return True

    def track(
        self,
        frame_gray: np.ndarray,
        search_region: Optional[Tuple[int, int, int, int]] = None,
    ) -> Optional[FlowResult]:
        """Track features to this frame.

        Args:
            frame_gray: Current frame (grayscale)
            search_region: Optional region to limit feature detection

        Returns:
            FlowResult with motion vectors, or None if tracking failed
        """
        if self._prev_gray is None or self._prev_points is None:
            return None

        # Calculate optical flow
        lk_params = {
            "winSize": self.WIN_SIZE,
            "maxLevel": self.MAX_LEVEL,
            "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03),
        }

        curr_points, status, _ = cv2.calcOpticalFlowPyrLK(
            self._prev_gray, frame_gray, self._prev_points, None, **lk_params
        )

        if curr_points is None:
            return None

        # Filter by status
        good_old = self._prev_points[status == 1].reshape(-1, 2)
        good_new = curr_points[status == 1].reshape(-1, 2)

        if len(good_new) < 2:
            return None

        # Calculate motion vectors
        vectors = []
        for old, new in zip(good_old, good_new):
            dx = new[0] - old[0]
            dy = new[1] - old[1]
            motion = np.sqrt(dx**2 + dy**2)

            # Only consider significant motion
            if motion >= self.MIN_MOTION:
                vectors.append(FlowVector(
                    x=float(new[0]),
                    y=float(new[1]),
                    dx=float(dx),
                    dy=float(dy),
                    confidence=min(1.0, motion / 20.0),
                ))

        if not vectors:
            return None

        # Filter for consistent motion
        consistent = self._filter_consistent_motion(vectors)

        # Calculate mean and dominant velocity
        if consistent:
            mean_dx = sum(v.dx for v in consistent) / len(consistent)
            mean_dy = sum(v.dy for v in consistent) / len(consistent)
            mean_velocity = (mean_dx, mean_dy)
        else:
            mean_velocity = (0.0, 0.0)

        # Estimate ball position
        ball_position = self._estimate_ball_position(consistent)

        # Update state for next frame
        self._prev_gray = frame_gray.copy()
        if len(good_new) > 0:
            self._prev_points = good_new.reshape(-1, 1, 2).astype(np.float32)

        confidence = len(consistent) / max(len(vectors), 1)

        return FlowResult(
            vectors=vectors,
            mean_velocity=mean_velocity,
            dominant_velocity=mean_velocity,
            ball_position=ball_position,
            confidence=confidence,
        )

    def _filter_consistent_motion(
        self,
        vectors: List[FlowVector],
    ) -> List[FlowVector]:
        """Filter to keep only vectors with consistent direction."""
        if len(vectors) < 2:
            return vectors

        # Calculate angles
        angles = []
        for v in vectors:
            angle = np.degrees(np.arctan2(v.dy, v.dx))
            angles.append(angle)

        # Find median angle
        median_angle = np.median(angles)

        # Filter to keep vectors within tolerance
        consistent = []
        for v, angle in zip(vectors, angles):
            diff = abs(angle - median_angle)
            if diff > 180:
                diff = 360 - diff
            if diff <= self.MOTION_ANGLE_TOL:
                consistent.append(v)

        return consistent

    def _estimate_ball_position(
        self,
        consistent_vectors: List[FlowVector],
    ) -> Optional[Tuple[float, float]]:
        """Estimate ball center from consistent motion vectors."""
        if not consistent_vectors:
            return None

        # Centroid of consistently moving points
        cx = sum(v.x for v in consistent_vectors) / len(consistent_vectors)
        cy = sum(v.y for v in consistent_vectors) / len(consistent_vectors)

        return (cx, cy)
```

**Step 4: Run test to verify it passes**

Run: `cd src/backend && python -m pytest tests/test_flow_tracker.py -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/backend/detection/flow_tracker.py src/backend/tests/test_flow_tracker.py
git commit -m "feat: add optical flow tracker for ball motion"
```

---

## Task 7: Enhanced Tracker Integration

**Files:**
- Modify: `src/backend/detection/tracker.py` (add new method after line 512)

**Step 1: Add imports at top of tracker.py**

```python
# Add these imports at the top of tracker.py after existing imports
from backend.detection.ball_template import BallTemplateExtractor
from backend.detection.scale_matcher import MultiScaleMatcher
from backend.detection.flow_tracker import OpticalFlowTracker
from backend.detection.kalman_tracker import BallKalmanFilter
from backend.detection.detection_scorer import DetectionScorer, DetectionCandidate
from backend.detection.trajectory_assembler import TrajectoryAssembler
```

**Step 2: Add track_precise_trajectory method after track_full_trajectory (after line 512)**

```python
    def track_precise_trajectory(
        self,
        video_path: Path,
        origin: OriginDetection,
        strike_time: float,
        max_flight_duration: float = 5.0,
    ) -> Optional[dict]:
        """Track ball with enhanced precision using all detection methods.

        Uses the full detection pipeline:
        1. Extract ball template from first frames
        2. Track using multi-scale template matching
        3. Use optical flow for motion estimation
        4. Kalman filter for prediction and smoothing
        5. Score and select best detections
        6. Assemble into final trajectory

        Falls back to physics-based trajectory if detection fails.

        Args:
            video_path: Path to video file
            origin: Ball origin detection (from origin.py)
            strike_time: When ball was struck (seconds)
            max_flight_duration: Maximum time to track

        Returns:
            Dict with trajectory data in standard format, or None
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            logger.error(f"Could not open video: {video_path}")
            return None

        try:
            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if fps <= 0:
                logger.error("Invalid FPS")
                return None

            # Step 1: Extract template
            template_extractor = BallTemplateExtractor()
            template = template_extractor.extract_template(
                str(video_path), origin.x, origin.y, strike_time
            )

            if template is None:
                logger.warning("Template extraction failed, using physics fallback")
                return self.track_full_trajectory(
                    video_path,
                    (origin.x / frame_width, origin.y / frame_height),
                    strike_time,
                    frame_width,
                    frame_height,
                )

            logger.info(f"Template extracted: radius={template.radius}px, brightness={template.brightness:.0f}")

            # Step 2: Initialize components
            scale_matcher = MultiScaleMatcher()
            scale_matcher.prepare_template(template.image, template.mask)

            flow_tracker = OpticalFlowTracker()

            kalman = BallKalmanFilter(fps=fps)
            # Initialize with template position and estimated initial velocity
            # Ball moves up initially (negative vy in screen coords)
            kalman.initialize(
                float(template.center[0]),
                float(template.center[1]),
                vx=0.0,
                vy=-15.0,  # Initial upward velocity
            )

            scorer = DetectionScorer()

            assembler = TrajectoryAssembler(frame_width, frame_height, fps)

            # Step 3: Track frame by frame
            start_frame = int(strike_time * fps) + template.frame_index
            end_frame = int((strike_time + max_flight_duration) * fps)
            end_frame = min(end_frame, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))

            cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            prev_gray = None
            expected_scale = 1.0
            detections_found = 0

            for frame_idx in range(start_frame, end_frame):
                ret, frame = cap.read()
                if not ret:
                    break

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                rel_frame = frame_idx - start_frame

                # Get Kalman prediction
                prediction = kalman.predict()
                search_region = kalman.get_search_region(sigma_multiplier=4.0)

                # Clamp search region to frame
                x1, y1, x2, y2 = search_region
                x1 = max(0, x1)
                y1 = max(0, y1)
                x2 = min(frame_width, x2)
                y2 = min(frame_height, y2)

                # Collect candidates from different methods
                candidates = []

                # Template matching candidates
                try:
                    matches = scale_matcher.match_in_region(
                        gray, (x1, y1, x2, y2), expected_scale
                    )
                    for match in matches[:3]:
                        # Get brightness at match location
                        mx, my = int(match.x), int(match.y)
                        if 0 <= mx < frame_width and 0 <= my < frame_height:
                            brightness = float(gray[my, mx])
                        else:
                            brightness = 150.0

                        candidates.append(DetectionCandidate(
                            x=match.x,
                            y=match.y,
                            radius=match.radius,
                            brightness=brightness,
                            template_score=match.score,
                            motion_score=0.5,
                            source="template",
                        ))
                except Exception as e:
                    logger.debug(f"Template matching error: {e}")

                # Optical flow candidates
                if prev_gray is not None:
                    try:
                        # Initialize flow tracker on first good detection
                        if detections_found > 0 and flow_tracker._prev_gray is None:
                            state = kalman.get_state()
                            if state:
                                flow_tracker.initialize(
                                    prev_gray,
                                    center=(state.x, state.y),
                                    radius=template.radius,
                                )

                        flow_result = flow_tracker.track(gray)
                        if flow_result and flow_result.ball_position:
                            fx, fy = flow_result.ball_position
                            if x1 <= fx <= x2 and y1 <= fy <= y2:
                                candidates.append(DetectionCandidate(
                                    x=fx,
                                    y=fy,
                                    radius=template.radius * expected_scale,
                                    brightness=200.0,
                                    template_score=0.5,
                                    motion_score=flow_result.confidence,
                                    source="flow",
                                ))
                    except Exception as e:
                        logger.debug(f"Flow tracking error: {e}")

                # Score and select
                best = None
                if candidates:
                    scored = scorer.score_candidates(
                        candidates,
                        predicted_x=prediction.x,
                        predicted_y=prediction.y,
                        prediction_uncertainty=prediction.search_radius,
                        expected_radius=template.radius * expected_scale,
                    )
                    best = scorer.select_best(scored)

                if best and kalman.is_measurement_plausible(best.x, best.y):
                    # Update Kalman with measurement
                    kalman.update(best.x, best.y, best.confidence)
                    assembler.add_detection(rel_frame, best.x, best.y, best.confidence)
                    detections_found += 1

                    # Update expected scale (ball shrinks as it goes away)
                    if template.radius > 0:
                        expected_scale = best.radius / template.radius
                        expected_scale = max(0.3, min(1.2, expected_scale))
                else:
                    # No valid detection
                    kalman.update_no_measurement()
                    assembler.add_no_detection(rel_frame)

                prev_gray = gray.copy()

            logger.info(f"Precise tracking found {detections_found} detections")

            # Step 4: Assemble trajectory
            trajectory = assembler.assemble(strike_time)

            if trajectory and len(trajectory.points) >= 6:
                # Convert to standard format
                points = [
                    {
                        "timestamp": p.timestamp,
                        "x": p.x,
                        "y": p.y,
                        "confidence": p.confidence,
                        "interpolated": p.interpolated,
                    }
                    for p in trajectory.points
                ]

                apex_pt = trajectory.points[trajectory.apex_index]

                logger.info(
                    f"Precise trajectory assembled: {len(points)} points, "
                    f"gaps={trajectory.gap_count}, confidence={trajectory.avg_confidence:.2f}"
                )

                return {
                    "points": points,
                    "apex_point": {
                        "timestamp": apex_pt.timestamp,
                        "x": apex_pt.x,
                        "y": apex_pt.y,
                    },
                    "landing_point": {
                        "timestamp": points[-1]["timestamp"],
                        "x": points[-1]["x"],
                        "y": points[-1]["y"],
                    },
                    "confidence": trajectory.avg_confidence,
                    "method": "precise_tracking",
                    "shot_shape": "straight",
                    "gap_count": trajectory.gap_count,
                }
            else:
                # Fall back to physics
                logger.info(f"Only {detections_found} detections, using physics fallback")
                return self.track_full_trajectory(
                    video_path,
                    (origin.x / frame_width, origin.y / frame_height),
                    strike_time,
                    frame_width,
                    frame_height,
                )

        finally:
            cap.release()
```

**Step 3: Run tests to verify integration works**

Run: `cd src/backend && python -m pytest tests/ -v -k "test_"  --ignore=tests/test_ball_tracking.py`
Expected: All existing tests PASS

**Step 4: Test the new method manually**

Run:
```bash
cd src/backend && python -c "
from backend.detection.tracker import ConstrainedBallTracker
from backend.detection.origin import BallOriginDetector
from pathlib import Path

origin_detector = BallOriginDetector()
tracker = ConstrainedBallTracker(origin_detector)

origin = origin_detector.detect_origin(
    Path('/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov'),
    18.25
)
print(f'Origin: ({origin.x:.0f}, {origin.y:.0f})')

trajectory = tracker.track_precise_trajectory(
    Path('/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov'),
    origin,
    strike_time=18.25,
    max_flight_duration=2.0,
)

if trajectory:
    print(f'Method: {trajectory[\"method\"]}')
    print(f'Points: {len(trajectory[\"points\"])}')
    print(f'Confidence: {trajectory[\"confidence\"]:.2f}')
    print(f'Gaps: {trajectory.get(\"gap_count\", 0)}')
else:
    print('Tracking failed')
"
```

**Step 5: Commit**

```bash
git add src/backend/detection/tracker.py
git commit -m "feat: integrate precise ball tracking into tracker"
```

---

## Task 8: Pipeline Integration

**Files:**
- Modify: `src/backend/detection/pipeline.py:263-320`

**Step 1: Update the tracking section in detect_shots method**

Find the section starting around line 263 where `origin.confidence >= 0.2` and replace with:

```python
                        if origin.confidence >= 0.5:
                            # Try precise tracking first (best quality)
                            precise_trajectory = self.constrained_tracker.track_precise_trajectory(
                                video_path=self.video_path,
                                origin=origin,
                                strike_time=strike_time,
                                max_flight_duration=4.0,
                            )

                            if precise_trajectory:
                                trajectory_points = precise_trajectory.get("points", [])
                                visual_features = precise_trajectory
                                logger.info(
                                    f"Precise tracking for strike at {strike_time:.2f}s: "
                                    f"method={precise_trajectory.get('method')}, "
                                    f"{len(trajectory_points)} points, "
                                    f"gaps={precise_trajectory.get('gap_count', 0)}, "
                                    f"confidence={precise_trajectory.get('confidence', 0):.2f}"
                                )

                        elif origin.confidence >= 0.2:
                            # Lower confidence - use physics-based trajectory
```

**Step 2: Run pipeline tests**

Run: `cd src/backend && python -m pytest tests/test_integration.py -v`
Expected: PASS

**Step 3: Commit**

```bash
git add src/backend/detection/pipeline.py
git commit -m "feat: use precise ball tracking in detection pipeline"
```

---

## Task 9: Run All Tests

**Files:**
- Test all modules

**Step 1: Run full test suite**

Run: `cd src/backend && python -m pytest tests/ -v`
Expected: All tests PASS

**Step 2: Run linting**

Run: `cd src/backend && python -m ruff check .`
Expected: No critical errors

---

## Task 10: End-to-End Verification

**Step 1: Test complete pipeline on test video**

```bash
cd src && python -c "
import asyncio
from backend.detection.pipeline import ShotDetectionPipeline
from pathlib import Path

async def test():
    pipeline = ShotDetectionPipeline(
        Path('/Users/ecoon/Desktop/golf-clip test videos/IMG_0991.mov')
    )

    shots = await pipeline.detect_shots(
        progress_callback=lambda step, prog: None,
        job_id='test-precise-tracking'
    )

    for shot in shots:
        print(f'Shot {shot.id} at {shot.strike_time:.2f}s, confidence={shot.confidence:.2f}')

asyncio.run(test())
"
```

---

## Summary

Plan complete and saved to `docs/plans/2026-01-24-precise-ball-tracking-plan.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
