import { describe, it, expect } from 'vitest'
import { trajectoryToFFmpegFilter } from './trajectory-to-ffmpeg-filter'

describe('trajectoryToFFmpegFilter', () => {
  it('returns empty string for trajectory with less than 2 points', () => {
    expect(trajectoryToFFmpegFilter([], 1920, 1080, 0)).toBe('')
    expect(trajectoryToFFmpegFilter([{ x: 0.5, y: 0.5, timestamp: 1 }], 1920, 1080, 0)).toBe('')
  })

  it('generates single drawbox filter for 2 points', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 1.0 },
      { x: 0.5, y: 0.2, timestamp: 2.0 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // x1 = 0.1 * 1920 = 192, y1 = 0.8 * 1080 = 864
    // x2 = 0.5 * 1920 = 960, y2 = 0.2 * 1080 = 216
    // minX = 192, minY = 216
    // boxW = |960 - 192| = 768, boxH = |864 - 216| = 648
    expect(result).toContain('drawbox=')
    expect(result).toContain('x=192')
    expect(result).toContain('y=216')
    expect(result).toContain('w=768')
    expect(result).toContain('h=648')
    expect(result).toContain('color=red')
    expect(result).toContain('t=fill')
    expect(result).toContain("enable='gte(t\\,1.000)'")
  })

  it('generates multiple drawbox filters joined by commas for multiple points', () => {
    const trajectory = [
      { x: 0.1, y: 0.8, timestamp: 1.0 },
      { x: 0.3, y: 0.5, timestamp: 1.5 },
      { x: 0.5, y: 0.2, timestamp: 2.0 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // Should have 2 segments (3 points = 2 box segments)
    // Split on ",drawbox" to separate filters
    const parts = result.split(/,(?=drawbox)/)
    expect(parts).toHaveLength(2)

    // First segment: point 0 to point 1
    // x1=192, y1=864, x2=576, y2=540
    // minX=192, minY=540, w=384, h=324
    expect(parts[0]).toContain('x=192')
    expect(parts[0]).toContain('y=540')
    expect(parts[0]).toContain("enable='gte(t\\,1.000)'")

    // Second segment: point 1 to point 2
    // x1=576, y1=540, x2=960, y2=216
    // minX=576, minY=216, w=384, h=324
    expect(parts[1]).toContain('x=576')
    expect(parts[1]).toContain('y=216')
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

    // Split on ",drawbox" to separate filters
    const parts = result.split(/,(?=drawbox)/)
    // First segment should use timestamp 1.0 (earliest)
    expect(parts[0]).toContain("enable='gte(t\\,1.000)'")
    // Second segment should use timestamp 1.5
    expect(parts[1]).toContain("enable='gte(t\\,1.500)'")
  })

  it('uses minimum thickness when segment is very short', () => {
    // Vertical line (same x coordinates)
    const trajectory = [
      { x: 0.5, y: 0.1, timestamp: 0 },
      { x: 0.5, y: 0.2, timestamp: 1 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 1920, 1080, 0)

    // x difference is 0, so width should be thickness (4)
    expect(result).toContain('w=4')
    // y difference is 0.1 * 1080 = 108
    expect(result).toContain('h=108')
  })

  it('works with 4K resolution (3840x2160)', () => {
    const trajectory = [
      { x: 0.25, y: 0.75, timestamp: 0 },
      { x: 0.75, y: 0.25, timestamp: 1 },
    ]
    const result = trajectoryToFFmpegFilter(trajectory, 3840, 2160, 0)

    // 0.25 * 3840 = 960, 0.75 * 2160 = 1620
    // 0.75 * 3840 = 2880, 0.25 * 2160 = 540
    // minX=960, minY=540, w=1920, h=1080
    expect(result).toContain('x=960')
    expect(result).toContain('y=540')
    expect(result).toContain('w=1920')
    expect(result).toContain('h=1080')
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
