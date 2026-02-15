### Add Value Proposition Text to Landing Page
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** Both user testing sessions noted the landing page has no description of what the app does. Users see a file upload zone but don't understand the value proposition. A 1-2 sentence tagline above the dropzone would set expectations and reduce confusion. The README already has good copy: "AI-powered golf shot detection and clip export tool."
- **Added:** 2026-02-14
- **Updated:** 2026-02-14

#### Acceptance Criteria
- [ ] Landing page (VideoDropzone view) displays a headline and 1-2 sentence description above the upload zone explaining what the app does
- [ ] Text is concise (under 30 words) and non-technical
- [ ] Text is visible without scrolling on desktop and mobile viewports
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In `VideoDropzone.tsx` (or the parent view in `App.tsx`), add a heading and subtitle above the dropzone component
2. Use existing CSS variables for styling consistency (e.g., `--color-text-primary`, `--font-size-lg`)
3. Suggested copy: "GolfClip" heading + "Upload a golf video to automatically detect shots and export clips with shot tracer overlay."
