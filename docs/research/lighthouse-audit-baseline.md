# Lighthouse Audit Baseline — golfclip.elicoon.com

**Date:** 2026-02-25
**Lighthouse Version:** 13.0.3
**Device Emulation:** Moto G Power (mobile)
**URL:** https://golfclip.elicoon.com

## Category Scores

| Category | Score |
|----------|-------|
| **Performance** | 99 |
| **Accessibility** | 94 |
| **Best Practices** | 100 |
| **SEO** | 90 |

## Core Web Vitals

| Metric | Value | Rating |
|--------|-------|--------|
| Largest Contentful Paint (LCP) | 1.7 s | Good |
| Total Blocking Time (TBT) | 0 ms | Good |
| Cumulative Layout Shift (CLS) | 0 | Good |
| First Contentful Paint (FCP) | 1.7 s | Good |
| Speed Index | 2.7 s | Good |
| Time to Interactive (TTI) | 1.7 s | Good |

## Resource Summary

| Resource Type | Requests | Transfer Size |
|---------------|----------|---------------|
| **Total** | 4 | 139.5 KiB |
| JavaScript | 1 | 127.3 KiB |
| CSS | 1 | 10.7 KiB |
| HTML Document | 1 | 0.7 KiB |
| Other (favicon) | 1 | 0.7 KiB |
| Third-party | 0 | 0 KiB |

The app ships a single JS bundle (`index-DWwsCosB.js`, 127.3 KiB gzipped) and one CSS file. No fonts, images, or third-party resources are loaded on the landing page. FFmpeg WASM (~31 MB) loads on demand only when processing video, so it does not affect initial page load.

## Actionable Findings

### 1. Unused JavaScript — 91.3 KiB (72% of bundle)

**Audit:** `unused-javascript` | **Score:** 0 (fail) | **Est. savings:** 450 ms

The single JS bundle (`index-DWwsCosB.js`, 127.3 KiB total) has 91.3 KiB of unused code on the landing page — 72% of the bundle. This is the app's only performance opportunity flagged by Lighthouse.

**Root cause:** The entire app (video processing, shot detection, clip export, canvas rendering) ships in one bundle. Only the landing/upload page code is needed initially.

**Recommended fix:** Code-split with React.lazy + dynamic imports. Split along page boundaries:
- Landing/upload page (immediate)
- Video processing pipeline (load after upload)
- Shot review + canvas overlay (load after processing)
- Clip export (load on export action)

**Impact:** Would reduce initial JS to ~35 KiB, improving FCP and LCP on slow connections.

### 2. Color Contrast — 4 elements below WCAG AA threshold

**Audit:** `color-contrast` | **Score:** 0 (fail)

Four text elements use `#666666` on dark backgrounds, producing contrast ratios below the required 4.5:1:

| Element | Foreground | Background | Ratio | Required |
|---------|-----------|------------|-------|----------|
| Walkthrough step descriptions (3 elements) | `#666666` | `#0f0f0f` | 3.33:1 | 4.5:1 |
| About box disclaimer | `#666666` | `#1a1a1a` | 3.03:1 | 4.5:1 |

**Recommended fix:** Change `#666666` to `#999999` (contrast 6.32:1 on `#0f0f0f`) or `#8a8a8a` (contrast 4.87:1, closer to current look). Both meet WCAG AA.

**Impact:** Would bring Accessibility score from 94 to ~100.

### 3. Missing Meta Description — SEO impact

**Audit:** `meta-description` | **Score:** 0 (fail)

The page has no `<meta name="description">` tag. Search engines may show auto-generated snippets, reducing click-through rate.

**Recommended fix:** Add to `index.html`:
```html
<meta name="description" content="Upload golf videos and automatically detect shots, review tracers, and export clips — all in the browser, no upload required.">
```

**Impact:** Would bring SEO score from 90 to ~100.

**Cross-reference:** Backlog item `feature-add-open-graph-meta-tags` covers this — adding OG tags includes adding a meta description.

### 4. Heading Order — Skips from H1 to H3

**Audit:** `heading-order` | **Score:** 0 (fail)

The walkthrough steps use `<h3>` elements without an intervening `<h2>`, which breaks the document outline for screen readers.

**Recommended fix:** Either change `<h3>` tags to `<h2>` in the walkthrough section, or add a visually-hidden `<h2>` section heading before the steps.

### 5. Accessible Name Mismatch on Dropzone

**Audit:** `label-content-name-mismatch` | **Score:** 0 (fail)

The dropzone has `aria-label="Drop zone for video files"` but its visible text content is different ("Drop your golf video here..."). Screen readers may announce a different name than what sighted users see.

**Recommended fix:** Either remove the explicit `aria-label` (let the visible text serve as the name) or update it to match the visible text.

## Cross-Reference: Backlog Items

| Backlog Item | Lighthouse Finding Addressed |
|---|---|
| `feature-add-pwa-manifest-for-installability` | No PWA manifest or service worker detected. Adding these enables offline shell loading and installability. Lighthouse no longer has a standalone PWA category, but these improve user experience. |
| `feature-add-open-graph-meta-tags` | Directly fixes **Finding #3** (missing meta description) and improves social sharing previews. |

## Summary

The site performs exceptionally well — 99 Performance with all Core Web Vitals in the "good" range and only 139.5 KiB total page weight. The main areas for improvement are:

1. **Code splitting** (72% unused JS) — the biggest optimization opportunity
2. **Color contrast** (4 elements) — straightforward CSS fix for accessibility
3. **Meta description** (missing) — already covered by OG tags backlog item
4. **Heading order + accessible names** — small HTML fixes for screen reader users
