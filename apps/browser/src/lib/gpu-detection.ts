// apps/browser/src/lib/gpu-detection.ts
/**
 * GPU and hardware acceleration detection utilities.
 * Used to warn users when their browser configuration may result in degraded export quality.
 */

export interface GpuCapabilities {
  /** Whether hardware acceleration appears to be enabled and working */
  hardwareAccelerationEnabled: boolean
  /** Whether WebGL is available (indicates GPU access) */
  webglAvailable: boolean
  /** GPU renderer string if available */
  renderer: string | null
  /** GPU vendor string if available */
  vendor: string | null
  /** Whether this appears to be a software renderer (SwiftShader, ANGLE on Basic Render Driver, etc.) */
  isSoftwareRenderer: boolean
  /** Estimated video decode capability */
  estimatedDecodeCapability: 'hardware' | 'software' | 'unknown'
}

/**
 * Detect GPU capabilities and hardware acceleration status.
 * This is a best-effort detection - some configurations may not be accurately detected.
 */
export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
  const result: GpuCapabilities = {
    hardwareAccelerationEnabled: true,
    webglAvailable: false,
    renderer: null,
    vendor: null,
    isSoftwareRenderer: false,
    estimatedDecodeCapability: 'unknown',
  }

  // Try WebGL detection
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl')

    if (gl && gl instanceof WebGLRenderingContext) {
      result.webglAvailable = true

      // Get debug info extension for renderer/vendor strings
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
      if (debugInfo) {
        result.renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        result.vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
      }

      // Check for software rendering indicators
      const rendererLower = (result.renderer || '').toLowerCase()
      const vendorLower = (result.vendor || '').toLowerCase()

      const softwareIndicators = [
        'swiftshader',
        'software',
        'llvmpipe',
        'basic render driver',
        'microsoft basic',
        'mesa',
        'virtualbox',
        'vmware',
      ]

      result.isSoftwareRenderer = softwareIndicators.some(
        (indicator) => rendererLower.includes(indicator) || vendorLower.includes(indicator),
      )

      // Clean up
      const loseContext = gl.getExtension('WEBGL_lose_context')
      if (loseContext) {
        loseContext.loseContext()
      }
    }
  } catch {
    // WebGL not available
  }

  // Determine hardware acceleration status
  // If WebGL is not available or using software renderer, acceleration is likely disabled
  result.hardwareAccelerationEnabled = result.webglAvailable && !result.isSoftwareRenderer

  // Estimate decode capability based on GPU status
  if (result.hardwareAccelerationEnabled) {
    result.estimatedDecodeCapability = 'hardware'
  } else if (result.webglAvailable) {
    // WebGL available but software renderer - probably can still decode, just slower
    result.estimatedDecodeCapability = 'software'
  } else {
    result.estimatedDecodeCapability = 'software'
  }

  return result
}

export type ExportMethod = 'browser-accelerated' | 'cloud-processing' | 'offline-export'

export interface ExportOption {
  id: ExportMethod
  name: string
  description: string[]
  available: boolean
  recommended: boolean
  unavailableReason?: string
}

/**
 * Get available export options based on GPU capabilities.
 */
export function getExportOptions(capabilities: GpuCapabilities): ExportOption[] {
  const browserAcceleratedAvailable = capabilities.hardwareAccelerationEnabled

  return [
    {
      id: 'browser-accelerated',
      name: 'Browser Export',
      description: [
        '~1x realtime (10s clip = 10s export)',
        'Requires Chrome hardware acceleration',
      ],
      available: browserAcceleratedAvailable,
      recommended: browserAcceleratedAvailable,
      unavailableReason: browserAcceleratedAvailable
        ? undefined
        : 'Hardware acceleration is disabled in your browser',
    },
    {
      id: 'cloud-processing',
      name: 'Cloud Processing',
      description: ['~30s per clip + upload time', 'Works on any device'],
      available: false, // Not implemented yet
      recommended: false,
      unavailableReason: 'Coming soon',
    },
    {
      id: 'offline-export',
      name: 'Offline Export',
      description: ['~10-15x realtime (10s clip = 2-3 min)', 'May timeout on longer clips'],
      available: true, // FFmpeg fallback is always available
      recommended: !browserAcceleratedAvailable,
    },
  ]
}
