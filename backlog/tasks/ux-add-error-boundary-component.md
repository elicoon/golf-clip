### Add Error Boundary to Prevent White Screen of Death
- **Project:** golf-clip
- **Status:** done
- **Priority:** high
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** React app has no error boundary. Runtime errors cause white screen with no user feedback. Error boundaries catch React component errors and display fallback UI, preventing total app crash and allowing users to recover (via "Try Again" button or reset).
- **Added:** 2026-02-16
- **Actual completion:** 2026-02-22
- **Updated:** 2026-02-23

#### Acceptance Criteria
- [x] ErrorBoundary component wraps App in index.tsx
- [x] Error state shows user-friendly message ("Something went wrong") with error details in dev mode only
- [x] "Reset" button clears error and reloads app
- [x] componentDidCatch logs error to console for debugging
- [x] Test verifies error boundary catches component errors and renders fallback UI

#### Next steps
1. Create src/components/ErrorBoundary.tsx with React.Component class (hooks don't support error boundaries)
2. Implement componentDidCatch and getDerivedStateFromError lifecycle methods
3. Wrap <App /> in ErrorBoundary in src/main.tsx
4. Add unit test that throws error in child component and verifies fallback renders
