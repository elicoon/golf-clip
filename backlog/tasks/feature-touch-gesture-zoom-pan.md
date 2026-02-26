### Add Touch Gesture Support for Video Zoom and Pan
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** medium
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The video zoom/pan feature in ClipReview uses keyboard controls (+/-/0) and mouse drag exclusively. Mobile users (golfers on the course) cannot pinch-to-zoom or touch-drag to place the ball origin. This is distinct from the mobile viewport E2E dispatch (gc-mobile-viewport-e2e), which tests layout only. Touch gesture support requires adding touchstart/touchmove/touchend handlers and a pinch-gesture recognizer to the video container. Critical for real mobile usability.
- **Added:** 2026-02-26
- **Updated:** 2026-02-26

#### Acceptance Criteria
- [ ] Pinch gesture on the video element zooms in/out (min 1x, max 4x) matching the keyboard +/- behavior
- [ ] Single-finger drag on the video element pans the view when zoomed in, same as mouse drag
- [ ] Double-tap on the video element resets zoom to 1x (equivalent to pressing 0)
- [ ] Touch events do not interfere with the click-to-place-ball-origin action
- [ ] Existing mouse and keyboard controls continue to work unchanged after the change

#### Next steps
1. Read `apps/browser/src/components/ClipReview.tsx` to understand current mouse drag and keyboard zoom implementation
2. Add `onTouchStart`/`onTouchMove`/`onTouchEnd` handlers to the video container div, implementing pinch-to-zoom via two-finger distance delta and single-finger pan
3. Add double-tap detection (two taps < 300ms apart) to reset zoom
4. Add a Vitest test for the touch event handlers using `fireEvent.touchStart` / `fireEvent.touchMove`
5. Verify manually in Chrome DevTools device toolbar that pinch/pan work without breaking click-to-place
