// apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts
import { TrajectoryPoint } from './canvas-compositor'

/**
 * Convert trajectory points to FFmpeg drawline filter string.
 *
 * Each segment appears at its start timestamp and stays visible,
 * creating a "growing" tracer effect as the video plays.
 *
 * @param trajectory - Array of trajectory points with normalized coords (0-1)
 * @param width - Video width in pixels
 * @param height - Video height in pixels
 * @param clipStart - Start time of clip in seconds (for relative timing)
 * @returns FFmpeg filter string, or empty string if trajectory too short
 */
export function trajectoryToFFmpegFilter(
  trajectory: TrajectoryPoint[],
  width: number,
  height: number,
  clipStart: number
): string {
  if (trajectory.length < 2) {
    return ''
  }

  // Sort by timestamp to ensure correct order
  const sorted = [...trajectory].sort((a, b) => a.timestamp - b.timestamp)
  const filters: string[] = []

  // Generate a drawline filter for each segment between adjacent points
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]

    // Convert normalized coords (0-1) to pixel coordinates
    const x1 = Math.round(p1.x * width)
    const y1 = Math.round(p1.y * height)
    const x2 = Math.round(p2.x * width)
    const y2 = Math.round(p2.y * height)

    // Time relative to clip start (FFmpeg filter time starts at 0)
    const t = p1.timestamp - clipStart

    // Use gte(t,T) so line appears at time T and stays visible
    // Color: red, Thickness: 4 (hardcoded for POC)
    filters.push(
      `drawline=x1=${x1}:y1=${y1}:x2=${x2}:y2=${y2}:color=red:thickness=4:enable='gte(t\\,${t.toFixed(3)})'`
    )
  }

  return filters.join(',')
}
