# GolfClip Product Walkthrough

This guide walks you through the complete flow of using GolfClip, from uploading a video to exporting clips with shot tracers.

> **Note:** To add screenshots to this guide, take screenshots at each step and save them in `docs/images/`. See [Adding Screenshots](#adding-screenshots) at the end.

---

## Table of Contents

1. [Step 1: Select Video](#step-1-select-video)
2. [Step 2: Processing](#step-2-processing)
3. [Step 3: Review Shots](#step-3-review-shots)
4. [Step 4: Export Clips](#step-4-export-clips)
5. [Adding Screenshots](#adding-screenshots)

---

## Step 1: Select Video

When you first open GolfClip, you'll see the about box explaining the project, followed by the video selection area.

### What You See

```
+-------------------------------------------------------------+
|  GolfClip                                      [New Video]  |
+-------------------------------------------------------------+
|                                                             |
|  +-----------------------------------------------------+   |
|  |  GolfClip is a vibe-coded golf video editing        |   |
|  |  platform to address two pain points:               |   |
|  |  1. Editing long videos into short clips            |   |
|  |  2. Adding animated tracers to golf clips           |   |
|  +-----------------------------------------------------+   |
|                                                             |
|                    +-------------------+                    |
|                    |                   |                    |
|                    |  Drop video       |  <-- DROP ZONE     |
|                    |     here or       |      Click here or |
|                    |                   |      drag a video  |
|                    +-------------------+                    |
|                                                             |
|                  +--------------------+                     |
|                  |  Select File       |  <-- CLICK THIS     |
|                  +--------------------+      BUTTON         |
|                                                             |
+-------------------------------------------------------------+
```

You can upload multiple videos at once — they'll be queued and processed sequentially.

### Actions

1. **Click "Select File"** button
2. Choose a video file from your computer (MP4, MOV, etc.)
3. Wait for upload to complete

### Expected Result

After selecting a file, you'll automatically move to the Processing screen.

---

## Step 2: Processing

The app automatically analyzes your video to detect golf shots.

### What You See

```
+-------------------------------------------------------------+
|  GolfClip                                      [New Video]  |
+-------------------------------------------------------------+
|                                                             |
|                    Processing Video...                      |
|                                                             |
|     +-----------------------------------------------+       |
|     |=======================                  | 65% |       |
|     +-----------------------------------------------+       |
|                                                             |
|              Detecting ball strikes...                      |
|                                                             |
|     Steps:                                                  |
|     [x] Extracting audio                                    |
|     [x] Analyzing transients                                |
|     [>] Detecting ball origin   <-- CURRENT STEP            |
|     [ ] Generating clips                                    |
|                                                             |
+-------------------------------------------------------------+
```

### What's Happening

1. **Audio extraction** - FFmpeg extracts audio track
2. **Transient analysis** - Detects ball strike sounds
3. **Ball origin detection** - Computer vision finds clubhead position
4. **Clip generation** - Creates clip boundaries with padding

### Expected Result

Processing typically takes 30-60 seconds. Once complete, you'll see the Review screen.

---

## Step 3: Review Shots

For each detected shot, you'll mark where the ball landed and review the generated tracer.

### What You See

```
+-------------------------------------------------------------+
|  GolfClip                                      [New Video]  |
+-------------------------------------------------------------+
|                                                             |
|  Review Shot #1                              1 of 3         |
|                                                             |
|  +----------------+                    +------------------+ |
|  | No Golf Shot   | <-- SKIP          | Approve Shot     | |
|  +----------------+   (false positive) +------------------+ |
|                                                             |
|  +-----------------------------------------------------+   |
|  | Step 1 of 2: Mark Landing                           |   |
|  | Click where the ball landed                         |   |
|  +-----------------------------------------------------+   |
|                                                             |
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |                   VIDEO PLAYER                      |   |
|  |                                                     |   |
|  |         Click on video to mark landing point        |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
|                                                             |
|        |----+========================+-------|             |
|      START  |       TIMELINE        |   END                |
|      HANDLE          SCRUBBER         HANDLE               |
|                                                             |
|   [<<] [<] [> Play] [>] [>>]  <-- PLAYBACK CONTROLS        |
|                                                             |
|   [x] Show Tracer    [Mute]    [x] Auto-loop               |
|                                                             |
|         92%  High confidence detection                     |
|                                                             |
+-------------------------------------------------------------+
```

### Key Elements

| Element | Location | Purpose |
|---------|----------|---------|
| **No Golf Shot** | Top left | Mark as false positive, don't export |
| **Approve Shot** | Top right | Accept shot (enabled after tracer review) |
| **Step Indicator** | Below buttons | Shows current step (Mark Landing / Review Tracer) |
| **Video Player** | Center | Click to mark landing point |
| **Timeline Scrubber** | Below video | Drag handles to adjust clip boundaries |
| **Playback Controls** | Below timeline | Play, pause, step frame (FPS-aware) |
| **Mute / Auto-Loop** | Below controls | Toggle audio mute and clip looping |
| **Confidence Badge** | Bottom | Detection confidence (green/yellow/red) |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `<-` / `->` | Step one frame (FPS-aware) |
| `Shift+<-` / `Shift+->` | Jump 1 second |
| `Up` / `Down` | Previous / next shot |
| `[` / `]` | Set clip start/end |
| `I` | Set impact time to current position |
| `Enter` | Approve shot |
| `Esc` | No golf shot (skip) |

---

### Step 3.1: Mark Landing (Where Ball Landed)

The first step is marking where the ball landed. Clicking to mark landing implicitly confirms this is a golf shot.

```
+-------------------------------------------------------------+
|  +-----------------------------------------------------+   |
|  | Step 1 of 2: Mark Landing                           |   |
|  | Click where the ball landed                         |   |
|  +-----------------------------------------------------+   |
|                                                             |
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |                                                     |   |
|  |                           |  <-- CLICK HERE        |   |
|  |                           v      (where ball landed)|   |
|  |                                                     |   |
|  |                                                     |   |
|  |     [golfer]                                        |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
+-------------------------------------------------------------+
```

**Action:** Click on the video where the ball actually landed.

**Result:**
- A downward arrow marker appears at that location
- System automatically generates the trajectory
- Progress bar shows generation stages

---

### Step 3.2: Review Tracer

After clicking to mark landing, the system generates the trajectory and plays the video with the tracer overlay.

```
+-------------------------------------------------------------+
|  +-----------------------------------------------------+   |
|  | Step 2 of 2: Review Tracer                          |   |
|  | Does this tracer look right?                        |   |
|  +-----------------------------------------------------+   |
|                                                             |
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |                     +  (apex diamond)               |   |
|  |                  /                                  |   |
|  |               /    <-- RED TRACER LINE             |   |
|  |            /           (animates as video plays)    |   |
|  |          .                                          |   |
|  |        /                                            |   |
|  |      .                |  (landing arrow)            |   |
|  |    /                  v                             |   |
|  |   .                                                 |   |
|  |     [golfer]                                        |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
|                                                             |
|  +------------+  +--------------------+                    |
|  |   Accept   |  | Configure          |                    |
|  +------------+  +--------------------+                    |
|        ^                   ^                                |
|   Tracer looks         Adjust settings                     |
|   good, next shot      and regenerate                      |
|                                                             |
+-------------------------------------------------------------+
```

**Actions:**

- **Accept** - Tracer looks good, move to next shot
- **Configure** - Adjust trajectory settings:
  - Starting line: Left / Center / Right
  - Shot shape: Hook / Draw / Straight / Fade / Slice
  - Shot height: Low / Medium / High
  - Flight time: 1-10 seconds

---

### Step 3.3: Configure Trajectory (Optional)

If you click Configure, you can adjust the trajectory parameters:

```
+-------------------------------------------------------------+
|  +-----------------------------------------------------+   |
|  | Configure Trajectory                                |   |
|  +-----------------------------------------------------+   |
|                                                             |
|  Starting line:  [Left] [Center] [Right]  <-- 1. SELECT    |
|                         ^                                   |
|                    CLICK ONE                               |
|                                                             |
|  Shot shape:  [Hook] [Draw] [Straight] [Fade] [Slice]      |
|                             ^                               |
|                        CLICK ONE  <-- 2. SELECT            |
|                                                             |
|  Shot height:  [Low] [Medium] [High]  <-- 3. SELECT        |
|                       ^                                     |
|                  CLICK ONE                                 |
|                                                             |
|  Flight time: 3.0s  |------o------|  <-- 4. ADJUST         |
|                           ^                                 |
|                      DRAG SLIDER                           |
|                                                             |
|  +------------+  +-------------+                           |
|  |  Generate  |  | Start Over  |  <-- 5. CLICK GENERATE   |
|  +------------+  +-------------+                           |
|        ^                                                    |
|   CLICK THIS BUTTON                                        |
|                                                             |
+-------------------------------------------------------------+
```

**Actions:**
1. Select **Starting line** (Left/Center/Right)
2. Select **Shot shape** (Hook/Draw/Straight/Fade/Slice)
3. Select **Shot height** (Low/Medium/High)
4. Adjust **Flight time** slider (1-10 seconds)
5. Click **Generate** button

**Result:** A new trajectory is generated with your settings.

---

### Step 3.4: Preview the Tracer

Click **Play** to see the tracer animate:

```
+-------------------------------------------------------------+
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |                     +  (apex)                       |   |
|  |                  /                                  |   |
|  |               /    <-- RED TRACER LINE             |   |
|  |            /           (animates as video plays)    |   |
|  |          .                                          |   |
|  |        /                                            |   |
|  |      .                                              |   |
|  |    /                  v  (landing)                  |   |
|  |   .                                                 |   |
|  |     [golfer]                                        |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
|                                                             |
|   [<<] [<] [> Play] [>] [>>]  <-- CLICK PLAY TO SEE       |
|                                   ANIMATION                |
+-------------------------------------------------------------+
```

**Action:** Click **Play** to see the tracer animate!

The red line will progressively draw as the video plays, following realistic golf ball physics:
- Fast at the start (ball leaving clubface at 160+ mph)
- Slowing near the apex
- Steady descent

**Note:** After trajectory generation, the video automatically plays so you can see the tracer in action.

---

## Step 4: Export Clips

After reviewing all shots, your clips are ready to export.

### Accept the Shot

```
+-------------------------------------------------------------+
|                                                             |
|  Review Shot #1                              1 of 3         |
|                                                             |
|  +----------------+                    +------------------+ |
|  | No Golf Shot   |                    | Approve Shot     | |
|  +----------------+                    +------------------+ |
|                                              ^              |
|                                         CLICK THIS          |
|                                         (now enabled!)      |
|                                                             |
+-------------------------------------------------------------+
```

Click **Approve Shot** to accept the shot. Repeat for all shots.

### Export Screen

After the last shot, you'll see a summary with an export button:

```
+-------------------------------------------------------------+
|                                                             |
|     All shots have been reviewed!                          |
|                                                             |
|     Resolution: [Original v]  <-- SELECT RESOLUTION        |
|                                                             |
|     +----------------------------+                         |
|     | Export 3 Clips             |  <-- CLICK TO EXPORT    |
|     +----------------------------+                         |
|                                                             |
+-------------------------------------------------------------+
```

Resolution options: Original, 1080p (faster), 720p (fastest).

### Export Modal

After clicking Export:

```
+-------------------------------------------------------------+
|                                                             |
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |               Exporting Clips...                    |   |
|  |                                                     |   |
|  |    +-------------------------------------------+    |   |
|  |    |=======================             | 67%  |    |   |
|  |    +-------------------------------------------+    |   |
|  |                                                     |   |
|  |         Exporting clip 2 of 3 (Shot #2)             |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
|                                                             |
+-------------------------------------------------------------+
```

### Export Complete

```
+-------------------------------------------------------------+
|                                                             |
|  +-----------------------------------------------------+   |
|  |                                                     |   |
|  |                    [checkmark]                      |   |
|  |                                                     |   |
|  |             Export Complete!                        |   |
|  |                                                     |   |
|  |        3 of 3 clips exported successfully           |   |
|  |                                                     |   |
|  |   Saved to: /path/to/video_clips/                   |   |
|  |                                                     |   |
|  |              +------------+                         |   |
|  |              |    Done    |  <-- CLICK TO FINISH    |   |
|  |              +------------+                         |   |
|  |                                                     |   |
|  +-----------------------------------------------------+   |
|                                                             |
+-------------------------------------------------------------+
```

Clips are downloaded to your browser's Downloads folder:
- `shot_1.mp4`
- `shot_2.mp4`
- `shot_3.mp4`
- etc.

Shot tracers are automatically burned into the exported videos.

---

## Adding Screenshots

To add real screenshots to this guide:

### Step 1: Take Screenshots

1. Run the app (`npm run dev` for frontend, `uvicorn` for backend)
2. Load a test video
3. At each step, take a screenshot:
   - macOS: `Cmd + Shift + 4` then select area
   - Windows: `Win + Shift + S`

### Step 2: Save Screenshots

Save screenshots in `docs/images/` with these names:
- `01-select-video.png`
- `02-processing.png`
- `03-review-shot.png`
- `03a-mark-landing.png`
- `03b-review-tracer.png`
- `03c-configure.png`
- `03d-tracer-preview.png`
- `04-export.png`

### Step 3: Add Annotations

Use any image editor to add red arrows:
- **Preview (macOS)**: Markup tools -> Arrow
- **Paint 3D (Windows)**: Draw red lines with brush
- **Online**: [Photopea](https://www.photopea.com/) (free)

### Step 4: Update This Document

Replace ASCII art with images:

```markdown
![Select Video](images/01-select-video.png)
*Click the "Select File" button to upload your golf video.*
```

---

## Quick Reference

### Complete Flow

```
1. SELECT VIDEO
   +-> Click "Select File" -> Choose video (supports multi-video upload)

2. WAIT FOR PROCESSING
   +-> Automatic (30-60 seconds)

3. FOR EACH SHOT:
   +-> Step 1: Click landing (where ball went)
   |   +-> System auto-generates trajectory
   +-> Step 2: Review tracer
   |   +-> Accept (looks good) OR
   |   +-> Configure (adjust settings)
   +-> Click "Approve Shot" to accept

4. EXPORT
   +-> Select resolution (Original / 1080p / 720p)
   +-> Click "Export N Clips" button
   +-> Clips download to browser Downloads folder
```

### Review Flow Summary

| Step | Action | Result |
|------|--------|--------|
| Mark Landing | Click where ball landed | Trajectory auto-generates |
| Review Tracer | Accept or Configure | Move to next shot or adjust |
| Configure (optional) | Adjust settings + Generate | New trajectory created |

### Keyboard Shortcuts Cheat Sheet

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `<-` | Previous frame (FPS-aware) |
| `->` | Next frame (FPS-aware) |
| `Shift+<-` | Back 1 second |
| `Shift+->` | Forward 1 second |
| `Up` / `Down` | Previous / next shot |
| `[` | Set clip start |
| `]` | Set clip end |
| `I` | Set impact time |
| `Enter` | Approve shot |
| `Esc` | No golf shot (skip) |
