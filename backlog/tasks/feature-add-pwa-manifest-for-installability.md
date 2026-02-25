### Add PWA Manifest and Service Worker for App Installability
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** GolfClip processes everything client-side with no backend dependency, making it a natural Progressive Web App candidate. Adding a PWA manifest enables "Add to Home Screen" on mobile and "Install" in desktop browsers. This increases user retention since installed apps get their own window, icon, and OS integration. Vite has built-in PWA plugin support via vite-plugin-pwa. A minimal service worker that precaches the app shell is sufficient — FFmpeg WASM loads from CDN on demand and does not need to be cached.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `manifest.json` exists with app name, icons (192px + 512px), theme color, and display: standalone
- [ ] Service worker precaches the Vite-built app shell (HTML, JS, CSS assets)
- [ ] Chrome DevTools > Application > Manifest shows valid installable PWA
- [ ] "Install" prompt appears in Chrome desktop and "Add to Home Screen" on mobile Safari/Chrome
- [ ] App loads and shows the landing page when opened offline (video processing still requires online for FFmpeg CDN)

#### Next steps
1. Install `vite-plugin-pwa` as a devDependency
2. Configure the plugin in `vite.config.ts` with manifest fields (name: "GolfClip", short_name: "GolfClip", theme_color, background_color, display: "standalone")
3. Create app icons at 192x192 and 512x512 (can use existing logo/favicon scaled)
4. Add `registerSW` option to auto-register the service worker
5. Build and test locally — verify Chrome shows install button and Lighthouse PWA audit passes
6. Verify offline shell loads (the drop zone page should render; actual video processing requires CDN)
