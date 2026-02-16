### Add Favicon to Prevent 404 Console Error
- **Project:** golf-clip
- **Status:** done
- **Priority:** low
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing (UT v1, issue #18) noted a 404 error in console for missing favicon.ico. Every page load triggers this 404. A simple golf-themed favicon (golf ball, flag, or the letter G) would resolve the error and give the app a polished browser tab appearance. Vite serves static assets from the `public/` directory.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] A favicon.ico (or favicon.svg) file exists in `apps/browser/public/`
- [ ] The favicon appears in the browser tab when loading the app
- [ ] No 404 error for favicon in browser console
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. Create a simple SVG favicon (e.g., a green circle with "G" text, or a golf ball icon) and save as `apps/browser/public/favicon.svg`
2. Add a `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` to `apps/browser/index.html`
3. Verify the 404 is gone by loading the app in a browser
