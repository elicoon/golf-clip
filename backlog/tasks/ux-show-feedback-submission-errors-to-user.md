### Show Feedback Submission Errors to User Instead of Silent Console Logs
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** feedback-service.ts logs Supabase errors to console.error() but never notifies the user. During user testing, every shot approval/rejection triggered a Supabase connection error in the console with zero user-visible indication. Users believe their feedback was saved when it wasn't. Fix: return error state from feedback functions and display a non-blocking toast/banner in ClipReview when submission fails.
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] When feedback submission fails, a visible error message appears in the UI (toast, banner, or inline warning)
- [ ] The error message is non-blocking (user can continue reviewing shots)
- [ ] The error message includes actionable text (e.g., "Feedback couldn't be saved — check your connection")
- [ ] When feedback submission succeeds, no error is shown
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. Modify `submitShotFeedback()` and `submitTracerFeedback()` in `feedback-service.ts` to return `{ success: boolean, error?: string }` instead of void
2. In `ClipReview.tsx`, check the return value and display an inline error banner when `success` is false
3. Add a test that verifies the error message renders when feedback submission fails (mock Supabase to reject)
