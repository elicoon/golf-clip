#!/usr/bin/env bash
# Generate a small synthetic test video for CI E2E tests.
# The app needs a valid video file for upload — content doesn't matter
# for testing UI layout, zoom/pan, and export flow structure.
set -euo pipefail

OUTPUT_DIR="$(git rev-parse --show-toplevel)/test-videos"
OUTPUT_FILE="$OUTPUT_DIR/IMG_0991.mov"

if [ -f "$OUTPUT_FILE" ]; then
  echo "Test video already exists at $OUTPUT_FILE"
  exit 0
fi

mkdir -p "$OUTPUT_DIR"

# Generate a 3-second 720p video with text overlay and audio track.
# Uses libx264 for broad compatibility, MOV container to match expected filename.
ffmpeg -y \
  -f lavfi -i "color=c=green:size=1280x720:duration=3:rate=30,drawtext=text='Golf Test':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -c:v libx264 -preset ultrafast -crf 23 \
  -c:a aac -b:a 128k \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "$OUTPUT_FILE"

echo "Generated test video: $OUTPUT_FILE ($(du -h "$OUTPUT_FILE" | cut -f1))"
