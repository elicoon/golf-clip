import { describe, it, expect } from 'vitest'
import { trajectoryToFFmpegFilter } from './trajectory-to-ffmpeg-filter'

describe('trajectoryToFFmpegFilter', () => {
  it('returns empty string for trajectory with less than 2 points', () => {
    expect(trajectoryToFFmpegFilter([], 1920, 1080, 0)).toBe('')
    expect(trajectoryToFFmpegFilter([{ x: 0.5, y: 0.5, timestamp: 1 }], 1920, 1080, 0)).toBe('')
  })

  it('generates single drawline filter for 2 points', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 1.0 },
      { x: 0.5, y: 0.2, timestamp: 2.0 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // x1 = 0.1 * 1920 = 192, y1 = 0.8 * 1080 = 864
    // x2 = 0.5 * 1920 = 960, y2 = 0.2 * 1080 = 216
    expect(result).toBe(
      "drawline=x1=192:y1=864:x2=960:y2=216:color=red:thickness=4:enable='gte(t\\,1.000)'"
    )
  })

  it('generates multiple drawline filters joined by commas for multiple points', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 1.0 },
      { x: 0.3, y: 0.5, timestamp: 1.5 },
      { x: 0.5, y: 0.2, timestamp: 2.0 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // Should have 2 segments (3 points = 2 line segments)
    // Split on ",drawline" to separate filters (not just comma, which appears in enable expression)
    const parts = result.split(/,(?=drawline)/)
    expect(parts).toHaveLength(2)

    // First segment: point 0 to point 1
    expect(parts[0]).toContain('x1=192')
    expect(parts[0]).toContain('y1=864')
    expect(parts[0]).toContain('x2=576')  // 0.3 * 1920 = 576
    expect(parts[0]).toContain('y2=540')  // 0.5 * 1080 = 540
    expect(parts[0]).toContain("enable='gte(t\\,1.000)'")

    // Second segment: point 1 to point 2
    expect(parts[1]).toContain('x1=576')
    expect(parts[1]).toContain('y1=540')
    expect(parts[1]).toContain('x2=960')  // 0.5 * 1920 = 960
    expect(parts[1]).toContain('y2=216')  // 0.2 * 1080 = 216
    expect(parts[1]).toContain("enable='gte(t\\,1.500)'")
  })

  it('adjusts timestamps relative to clipStart', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 10.5 },
      { x: 0.5, y: 0.2, timestamp: 11.5 },
    ]
    const clipStart = 10.0
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, clipStart)

    // Timestamp should be 10.5 - 10.0 = 0.5
    expect(result).toContain("enable='gte(t\\,0.500)'")
  })

  it('sorts trajectory points by timestamp', () => {
    // Points are out of order
    const trajectory = [
      { x: 0.5, y: 0.2, timestamp: 2.0 },
      { x: 0.1, y: 0.8, timestamp: 1.0 },
      { x: 0.3, y: 0.5, timestamp: 1.5 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // Split on ",drawline" to separate filters (not just comma, which appears in enable expression)
    const parts = result.split(/,(?=drawline)/)
    // First segment should use timestamp 1.0 (earliest)
    expect(parts[0]).toContain("enable='gte(t\\,1.000)'")
    // Second segment should use timestamp 1.5
    expect(parts[1]).toContain("enable='gte(t\\,1.500)'")
  })

  it('rounds pixel coordinates to integers', () => {
    const trajectory = [
      { x: 0.333, y: 0.666, timestamp: 0 },
      { x: 0.777, y: 0.111, timestamp: 1 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // 0.333 * 1920 = 639.36 -> 639
    // 0.666 * 1080 = 719.28 -> 719
    // 0.777 * 1920 = 1491.84 -> 1492
    // 0.111 * 1080 = 119.88 -> 120
    expect(result).toContain('x1=639')
    expect(result).toContain('y1=719')
    expect(result).toContain('x2=1492')
    expect(result).toContain('y2=120')
  })

  it('works with 4K resolution (3840x2160)', () => {
    const trajectory = [
      { x: 0.5, y: 0.5, timestamp: 0 },
      { x: 1.0, y: 1.0, timestamp: 1 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 3840, 2160, 0)

    // 0.5 * 3840 = 1920, 0.5 * 2160 = 1080
    // 1.0 * 3840 = 3840, 1.0 * 2160 = 2160
    expect(result).toContain('x1=1920')
    expect(result).toContain('y1=1080')
    expect(result).toContain('x2=3840')
    expect(result).toContain('y2=2160')
  })

  it('handles negative relative timestamps when clipStart is after trajectory start', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 5.0 },
      { x: 0.5, y: 0.2, timestamp: 6.0 },
    ]
    const clipStart = 5.5  // Clip starts after first point
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, clipStart)

    // Timestamp should be 5.0 - 5.5 = -0.5
    expect(result).toContain("enable='gte(t\\,-0.500)'")
  })
})
