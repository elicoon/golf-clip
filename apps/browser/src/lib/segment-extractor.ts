/**
 * Video Segment Extractor
 *
 * Enables memory-efficient video processing by extracting only relevant segments
 * from large video files. Uses File.slice() for random access instead of loading
 * entire files into memory.
 */

/**
 * Estimate byte offset for a given timestamp.
 * Uses constant bitrate assumption (reasonable for most video codecs).
 *
 * @param fileSize - Total file size in bytes
 * @param totalDuration - Total video duration in seconds
 * @param timestamp - Target timestamp in seconds
 * @returns Estimated byte offset
 */
export function estimateByteOffset(
  fileSize: number,
  totalDuration: number,
  timestamp: number,
): number {
  // Account for headers (typically first ~1MB has metadata)
  const headerSize = Math.min(1_000_000, fileSize * 0.01)
  const contentSize = fileSize - headerSize

  // Clamp ratio between 0 and 1
  const ratio = Math.max(0, Math.min(1, timestamp / totalDuration))
  return Math.floor(headerSize + contentSize * ratio)
}

/**
 * Extract a video segment from a File object without loading entire file.
 * Uses File.slice() for random access.
 *
 * @param file - The video file
 * @param startTime - Segment start time in seconds
 * @param endTime - Segment end time in seconds
 * @param totalDuration - Total video duration in seconds
 * @returns Blob containing the extracted segment
 */
export async function extractSegment(
  file: File,
  startTime: number,
  endTime: number,
  totalDuration: number,
): Promise<Blob> {
  // Add buffer before and after for keyframe seeking
  const bufferSeconds = 2
  const bufferedStart = Math.max(0, startTime - bufferSeconds)
  const bufferedEnd = Math.min(totalDuration, endTime + bufferSeconds)

  const startByte = estimateByteOffset(file.size, totalDuration, bufferedStart)
  const endByte = estimateByteOffset(file.size, totalDuration, bufferedEnd)

  // Ensure we get at least some data
  const minBytes = 1_000_000 // 1MB minimum
  const actualEndByte = Math.max(endByte, startByte + minBytes)

  // Use File.slice() for efficient random access
  const segment = file.slice(startByte, Math.min(actualEndByte, file.size))

  return segment
}

/**
 * Estimate video bitrate from file size and duration.
 *
 * @param fileSize - Total file size in bytes
 * @param duration - Total duration in seconds
 * @returns Estimated bitrate in bits per second
 */
export function estimateBitrate(fileSize: number, duration: number): number {
  if (duration <= 0) return 0
  // Assume ~90% of file is video data (rest is audio, metadata)
  const videoBits = fileSize * 8 * 0.9
  return videoBits / duration
}

/**
 * Get video duration using browser's built-in video element.
 *
 * @param file - The video file
 * @returns Promise resolving to duration in seconds
 */
export function getVideoDuration(file: File | Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(video.src)
      reject(new Error('Timeout loading video metadata'))
    }, 10000)

    video.onloadedmetadata = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }

    video.onerror = () => {
      clearTimeout(timeout)
      URL.revokeObjectURL(video.src)
      reject(new Error('Failed to load video metadata'))
    }

    video.src = URL.createObjectURL(file)
  })
}
