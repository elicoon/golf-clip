import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

interface TrajectoryPoint {
  x: number // 0-1 normalized
  y: number // 0-1 normalized
  timestamp: number
}

interface ExportOptions {
  videoBlob: Blob
  trajectory: TrajectoryPoint[]
  startTime: number
  endTime: number
  videoWidth: number
  videoHeight: number
  tracerColor?: string
  tracerWidth?: number
}

export async function exportClipWithTracer(ffmpeg: FFmpeg, options: ExportOptions): Promise<Blob> {
  const {
    videoBlob,
    trajectory,
    startTime,
    endTime,
    videoWidth,
    videoHeight,
    tracerColor = 'yellow',
    tracerWidth = 3,
  } = options

  const inputName = 'input.mp4'
  const outputName = 'output.mp4'

  try {
    // Write input video
    await ffmpeg.writeFile(inputName, await fetchFile(videoBlob))

    // Generate drawtext filter for trajectory (simple approach)
    // For MVP, we'll burn in a simple line overlay
    const duration = endTime - startTime

    // Build FFmpeg filter for trajectory line
    // This is simplified - a full implementation would use canvas compositing
    const filterComplex = buildTrajectoryFilter(
      trajectory,
      tracerColor,
      tracerWidth,
      videoWidth,
      videoHeight,
    )

    // Export with overlay
    const exitCode = await ffmpeg.exec([
      '-i',
      inputName,
      '-ss',
      startTime.toString(),
      '-t',
      duration.toString(),
      '-vf',
      filterComplex,
      '-c:a',
      'copy',
      outputName,
    ])

    if (exitCode !== 0) {
      throw new Error(`FFmpeg export failed with exit code ${exitCode}`)
    }

    const data = await ffmpeg.readFile(outputName)

    if (!(data instanceof Uint8Array)) {
      throw new Error('Unexpected FFmpeg output format')
    }

    return new Blob([data.buffer as ArrayBuffer], { type: 'video/mp4' })
  } finally {
    // Cleanup even on error
    try {
      await ffmpeg.deleteFile(inputName)
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile(outputName)
    } catch {
      /* ignore */
    }
  }
}

function buildTrajectoryFilter(
  trajectory: TrajectoryPoint[],
  color: string,
  width: number,
  videoWidth: number,
  videoHeight: number,
): string {
  // For MVP: draw circles at key points
  // Full implementation would interpolate and draw smooth curves

  if (trajectory.length < 2) return 'null'

  const drawCommands: string[] = []

  for (let i = 0; i < trajectory.length - 1; i++) {
    const p1 = trajectory[i]

    // Draw line segment (using drawbox as approximation)
    // FFmpeg's drawtext filter is limited; canvas compositing is better
    drawCommands.push(
      `drawbox=x=${Math.floor(p1.x * videoWidth)}:y=${Math.floor(p1.y * videoHeight)}:w=${width}:h=${width}:color=${color}:t=fill`,
    )
  }

  return drawCommands.join(',')
}

/**
 * Alternative: Export using Canvas compositing (higher quality)
 */
export async function exportWithCanvasCompositing(
  _videoBlob: Blob,
  _trajectoryCanvas: HTMLCanvasElement,
  _startTime: number,
  _endTime: number,
): Promise<Blob> {
  // This approach renders frame-by-frame with canvas overlay
  // More complex but produces better quality tracers

  // For MVP, we'll use the simpler FFmpeg approach above
  // This is a placeholder for future enhancement

  throw new Error('Canvas compositing not yet implemented')
}
