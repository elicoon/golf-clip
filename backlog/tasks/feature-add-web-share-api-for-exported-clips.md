### Add Web Share API Button for Exported Clip Sharing
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** After exporting a clip, users currently download the MP4 to their Downloads folder and must manually open a messaging app to share it. The Web Share API (`navigator.share()`) enables a native "Share" button that lets users send the exported clip directly to any app (iMessage, WhatsApp, social media) without leaving the browser. This closes the loop from detection → export → share and is the key growth mechanism for a SaaS product. Falls back gracefully on unsupported browsers (desktop Firefox) by hiding the button.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] "Share" button appears next to the download button after a clip is exported
- [ ] Clicking "Share" invokes `navigator.share()` with the exported MP4 file and a title like "Check out this golf shot!"
- [ ] Share button is only rendered when `navigator.canShare` returns true for file sharing
- [ ] On unsupported browsers, the share button is hidden (download remains the only option)
- [ ] Share action works on mobile Chrome and Safari (primary target platforms)

#### Next steps
1. Locate the export completion UI in `apps/browser/src/components/` (where the download button is rendered)
2. Add a `navigator.canShare` feature check to conditionally render a "Share" button
3. Implement the share handler using `navigator.share({ files: [clipFile], title: '...', text: '...' })`
4. Style the share button consistently with the existing download button
5. Test on mobile Chrome (Android) and Safari (iOS) — verify the native share sheet opens with the MP4 attached
