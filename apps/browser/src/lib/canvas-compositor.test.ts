// apps/browser/src/lib/canvas-compositor.test.ts
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'

// Mock ImageData class for non-browser environment
class MockImageData {
  width: number
  height: number
  data: Uint8ClampedArray

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

// Create a mock 2D context with all necessary methods
function createMockContext(width: number, height: number): CanvasRenderingContext2D {
  const imageData = new MockImageData(width, height)
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => imageData),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    shadowColor: '',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D
}

// Mock OffscreenCanvas
class MockOffscreenCanvas {
  width: number
  height: number
  private mockCtx: CanvasRenderingContext2D

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.mockCtx = createMockContext(width, height)
  }

  getContext(type: string): CanvasRenderingContext2D | null {
    if (type === '2d') {
      return this.mockCtx
    }
    return null
  }
}

// Mock HTMLCanvasElement-like object
class MockCanvas {
  width = 100
  height = 100
}

beforeAll(() => {
  // @ts-expect-error - polyfilling OffscreenCanvas for tests
  globalThis.OffscreenCanvas = MockOffscreenCanvas
  // @ts-expect-error - polyfilling ImageData for tests
  globalThis.ImageData = MockImageData
})

describe('CanvasCompositor', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('should composite video frame with tracer overlay', async () => {
    const { CanvasCompositor } = await import('./canvas-compositor')

    // Create mock video frame
    const videoCanvas = new MockCanvas() as unknown as HTMLCanvasElement

    const compositor = new CanvasCompositor(100, 100)

    // Draw tracer at 50% progress
    const frame = compositor.compositeFrame(videoCanvas, {
      trajectory: [
        { x: 0.1, y: 0.9, timestamp: 0 },
        { x: 0.5, y: 0.2, timestamp: 1 },
        { x: 0.9, y: 0.8, timestamp: 2 },
      ],
      currentTime: 1.0,
      startTime: 0,
      endTime: 2,
      tracerStyle: { color: '#ff0000', lineWidth: 3 },
    })

    expect(frame).toBeInstanceOf(ImageData)
    expect(frame.width).toBe(100)
    expect(frame.height).toBe(100)
  })

  it('should apply glow effect when enabled', async () => {
    const { CanvasCompositor } = await import('./canvas-compositor')
    const compositor = new CanvasCompositor(100, 100)

    // Create mock video frame
    const videoCanvas = new MockCanvas() as unknown as HTMLCanvasElement

    const frame = compositor.compositeFrame(videoCanvas, {
      trajectory: [
        { x: 0.1, y: 0.9, timestamp: 0 },
        { x: 0.9, y: 0.1, timestamp: 1 },
      ],
      currentTime: 0.5,
      startTime: 0,
      endTime: 1,
      tracerStyle: {
        color: '#ff0000',
        lineWidth: 3,
        glowEnabled: true,
        glowColor: '#ff6666',
        glowRadius: 8,
      },
    })

    expect(frame).toBeInstanceOf(ImageData)
  })
})
