### Reject Invalid File Types with User-Facing Error Message
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** bug-fix
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** User testing (UT v1, issue #2) found that uploading a non-video file (e.g., .txt) silently fails — nothing happens, no error message. The VideoDropzone should validate file types on selection and display an inline error when an unsupported format is chosen. The HTML `accept` attribute on the file input may already filter in the file picker, but drag-and-drop bypasses this.
- **Added:** 2026-02-16
- **Updated:** 2026-02-16

#### Acceptance Criteria
- [ ] Dropping or selecting a non-video file (e.g., .txt, .pdf, .png) shows an inline error message below the dropzone (e.g., "Unsupported file type. Please select a video file (MP4, MOV, WebM).")
- [ ] Error message auto-dismisses after 5 seconds or when a valid file is selected
- [ ] Valid video files (MP4, MOV, WebM) continue to work as before
- [ ] Existing test suite passes (`npm run test` in apps/browser)

#### Next steps
1. In `VideoDropzone.tsx`, add a file type validation check in the `onDrop` / `onChange` handler before calling the upload function
2. Add state for `fileError` with a dismissal timer
3. Render the error message below the dropzone area using existing error styling patterns
