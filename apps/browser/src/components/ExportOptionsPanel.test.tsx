// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { ExportOptionsPanel } from './ExportOptionsPanel'
import type { GpuCapabilities, ExportOption } from '../lib/gpu-detection'

expect.extend(matchers)

const mockCapabilities: GpuCapabilities = {
  hardwareAccelerationEnabled: true,
  webglAvailable: true,
  renderer: 'NVIDIA GeForce RTX 3080',
  vendor: 'NVIDIA',
  isSoftwareRenderer: false,
  estimatedDecodeCapability: 'hardware',
}

const mockOptions: ExportOption[] = [
  {
    id: 'browser-accelerated',
    name: 'Browser Export',
    description: ['Fast export', 'Requires hardware acceleration'],
    available: true,
    recommended: true,
  },
  {
    id: 'offline-export',
    name: 'Offline Export',
    description: ['No cloud required'],
    available: false,
    recommended: false,
    unavailableReason: 'Requires desktop app',
  },
]

vi.mock('../lib/gpu-detection', () => ({
  detectGpuCapabilities: vi.fn(),
  getExportOptions: vi.fn(),
}))

import * as gpuDetection from '../lib/gpu-detection'

describe('ExportOptionsPanel', () => {
  const onExport = vi.fn()
  const onResolutionChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gpuDetection.detectGpuCapabilities).mockResolvedValue(mockCapabilities)
    vi.mocked(gpuDetection.getExportOptions).mockReturnValue(mockOptions)
  })

  afterEach(() => {
    cleanup()
  })

  it('shows loading state before GPU detection completes', () => {
    vi.mocked(gpuDetection.detectGpuCapabilities).mockReturnValue(new Promise(() => {}))

    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    expect(screen.getByText(/checking system capabilities/i)).toBeInTheDocument()
  })

  it('renders export options after GPU detection resolves', async () => {
    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Browser Export')).toBeInTheDocument()
    })

    expect(screen.getByText('Offline Export')).toBeInTheDocument()
  })

  it('auto-selects the recommended available option', async () => {
    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Recommended')).toBeInTheDocument()
    })
  })

  it('calls onExport with the selected method when Export is clicked', async () => {
    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /export/i }))

    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledWith('browser-accelerated')
  })

  it('calls onResolutionChange with correct value when resolution select changes', async () => {
    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1080p' } })

    expect(onResolutionChange).toHaveBeenCalledWith('1080p')
  })

  it('shows hardware acceleration warning when disabled', async () => {
    vi.mocked(gpuDetection.detectGpuCapabilities).mockResolvedValue({
      ...mockCapabilities,
      hardwareAccelerationEnabled: false,
    })

    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/hardware acceleration is disabled/i)).toBeInTheDocument()
    })
  })

  it('marks unavailable options with Unavailable badge', async () => {
    render(
      <ExportOptionsPanel
        onExport={onExport}
        exportResolution="original"
        onResolutionChange={onResolutionChange}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeInTheDocument()
    })
  })
})
