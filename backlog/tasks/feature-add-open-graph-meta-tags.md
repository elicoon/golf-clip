### Add Open Graph Meta Tags and SEO-Friendly Page Title
- **Project:** golf-clip
- **Status:** not started
- **Priority:** medium
- **Type:** feature
- **Scope:** small
- **Planned completion:** none
- **Blockers:** none
- **Notes:** The current `index.html` has minimal meta tags (charset, viewport, favicon) and a generic title "GolfClip - Browser". As a public SaaS at golfclip.elicoon.com, sharing the URL on social media, Slack, or iMessage produces no preview — just a bare link. Adding Open Graph tags (og:title, og:description, og:image, og:url) and a Twitter card will make shared links display a rich preview, directly supporting user acquisition.
- **Added:** 2026-02-24
- **Updated:** 2026-02-24

#### Acceptance Criteria
- [ ] `index.html` includes `og:title`, `og:description`, `og:image`, `og:url`, and `og:type` meta tags
- [ ] `index.html` includes `twitter:card`, `twitter:title`, `twitter:description` meta tags
- [ ] Page title updated from "GolfClip - Browser" to "GolfClip — AI Golf Shot Detection & Clip Export"
- [ ] `meta name="description"` tag added with a concise product description
- [ ] Social preview image (1200x630px) created and placed in `public/` directory
- [ ] Preview verified using a social media debugger (e.g., opengraph.xyz or Twitter Card Validator)

#### Next steps
1. Update `<title>` in `apps/browser/index.html` to "GolfClip — AI Golf Shot Detection & Clip Export"
2. Add `<meta name="description">` with product summary
3. Add Open Graph meta tags (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`)
4. Add Twitter Card meta tags (`twitter:card` as `summary_large_image`, `twitter:title`, `twitter:description`)
5. Create a 1200x630 social preview image (screenshot of app with branding) and save to `public/og-image.png`
6. Test with opengraph.xyz after deployment
