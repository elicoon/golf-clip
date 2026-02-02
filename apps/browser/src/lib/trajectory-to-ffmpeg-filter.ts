// apps/browser/src/lib/trajectory-to-ffmpeg-filter.ts
import { TrajectoryPoint } from './canvas-compositor'

/**
 * Convert trajectory points to FFmpeg drawbox filter string.
 *
 * Uses drawbox instead of drawline because drawline is not available
 * in FFmpeg WASM builds. Each segment is rendered as a thin filled box
 * that appears at its start timestamp and stays visible, creating a
 * "growing" tracer effect as the video plays.
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

  // Line thickness for the tracer (POC hardcoded)
  const thickness = 4

  // Generate a drawbox filter for each segment between adjacent points
  // drawbox draws filled rectangles - we use thin boxes to simulate lines
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

    // Calculate box dimensions to simulate a line segment
    // Box goes from min to max coords, with thickness
    const minX = Math.min(x1, x2)
    const minY = Math.min(y1, y2)
    const boxW = Math.max(Math.abs(x2 - x1), thickness)
    const boxH = Math.max(Math.abs(y2 - y1), thickness)

    // Use gte(t,T) so box appears at time T and stays visible
    // Color: red, t=fill means filled box
    filters.push(
      `drawbox=x=${minX}:y=${minY}:w=${boxW}:h=${boxH}:color=red:t=fill:enable='gte(t\\,${t.toFixed(3)})'`
    )
  }

  return filters.join(',')
}
