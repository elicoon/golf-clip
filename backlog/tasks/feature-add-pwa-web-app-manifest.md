### Add PWA Web App Manifest for Installability
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** GolfClip is positioned as a SaaS product and has a compelling on-course use case — golfers reviewing shots between holes. Adding a web app manifest with icons, theme color, and display mode enables Chrome/Safari "Add to Home Screen" so users get a native app experience without an App Store. No external services needed — pure static file addition.
- **Added:** 2026-02-26
- **Updated:** 2026-02-26

#### Acceptance Criteria
- [ ] `/public/manifest.json` exists with name, short_name, start_url, display: standalone, theme_color, background_color, and icons array
- [ ] At least one icon at 192×192 and one at 512×512 (PNG, linked in manifest)
- [ ] `<link rel="manifest">` and `<meta name="theme-color">` are present in `index.html`
- [ ] Chrome DevTools Lighthouse "Installable" audit passes (no manifest errors)
- [ ] App can be added to home screen on Chrome for Android (tested in DevTools mobile emulation)

#### Next steps
1. Create `apps/browser/public/manifest.json` with display: standalone, golf-themed theme color, and icons entries
2. Generate or add icon assets at 192×192 and 512×512 under `apps/browser/public/icons/`
3. Add `<link rel="manifest" href="/manifest.json">` and `<meta name="theme-color">` to `apps/browser/index.html`
4. Run Lighthouse audit to verify Installable section passes
