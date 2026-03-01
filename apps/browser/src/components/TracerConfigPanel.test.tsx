// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { TracerConfigPanel } from './TracerConfigPanel'
import type { TracerConfig } from '../stores/processingStore'
import type { TracerStyle } from '../types/tracer'

expect.extend(matchers)

const defaultConfig: TracerConfig = {
  height: 'medium',
  shape: 'straight',
  flightTime: 3.0,
}

const defaultStyle: TracerStyle = 'arc'

function renderPanel(overrides: Partial<Parameters<typeof TracerConfigPanel>[0]> = {}) {
  const props = {
    config: defaultConfig,
    onChange: vi.fn(),
    style: defaultStyle,
    onStyleChange: vi.fn(),
    onGenerate: vi.fn(),
    onMarkApex: vi.fn(),
    onMarkOrigin: vi.fn(),
    hasChanges: false,
    apexMarked: false,
    originMarked: false,
    isGenerating: false,
    isCollapsed: false,
    onToggleCollapse: vi.fn(),
    ...overrides,
  }
  return { ...render(<TracerConfigPanel {...props} />), props }
}

describe('TracerConfigPanel', () => {
  afterEach(() => {
    cleanup()
  })

  describe('collapsed state', () => {
    it('shows "Adjust Trajectory" label when collapsed', () => {
      renderPanel({ isCollapsed: true })
      expect(screen.getByText('Adjust Trajectory')).toBeInTheDocument()
    })

    it('hides controls when collapsed', () => {
      renderPanel({ isCollapsed: true })
      expect(screen.queryByText('Shot Height')).not.toBeInTheDocument()
    })

    it('calls onToggleCollapse when header is clicked', () => {
      const onToggleCollapse = vi.fn()
      renderPanel({ isCollapsed: true, onToggleCollapse })
      fireEvent.click(screen.getByRole('button', { name: /adjust trajectory/i }))
      expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    })
  })

  describe('height controls', () => {
    it('calls onChange with low height when Low button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'Low' }))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, height: 'low' })
    })

    it('calls onChange with medium height when Medium button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange, config: { ...defaultConfig, height: 'low' } })

      fireEvent.click(screen.getByRole('button', { name: 'Medium' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, height: 'medium' })
    })

    it('calls onChange with high height when High button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'High' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, height: 'high' })
    })
  })

  describe('shape controls', () => {
    it('calls onChange with hook shape when Hook button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'Hook' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, shape: 'hook' })
    })

    it('calls onChange with draw shape when Draw button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'Draw' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, shape: 'draw' })
    })

    it('calls onChange with fade shape when Fade button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'Fade' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, shape: 'fade' })
    })

    it('calls onChange with straight shape when Straight button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange, config: { ...defaultConfig, shape: 'hook' } })

      fireEvent.click(screen.getByRole('button', { name: 'Straight' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, shape: 'straight' })
    })

    it('calls onChange with slice shape when Slice button is clicked', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.click(screen.getByRole('button', { name: 'Slice' }))

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, shape: 'slice' })
    })
  })

  describe('flight time slider', () => {
    it('renders the flight time slider', () => {
      renderPanel()
      const slider = screen.getByRole('slider')
      expect(slider).toBeInTheDocument()
    })

    it('displays current flight time value', () => {
      renderPanel({ config: { ...defaultConfig, flightTime: 5.0 } })
      expect(screen.getByText('5.0s')).toBeInTheDocument()
    })

    it('calls onChange with updated flightTime when slider changes', () => {
      const onChange = vi.fn()
      renderPanel({ onChange })

      fireEvent.change(screen.getByRole('slider'), { target: { value: '7.5' } })

      expect(onChange).toHaveBeenCalledWith({ ...defaultConfig, flightTime: 7.5 })
    })
  })

  describe('generate button', () => {
    it('calls onGenerate when Generate button is clicked', () => {
      const onGenerate = vi.fn()
      renderPanel({ onGenerate })

      fireEvent.click(screen.getByRole('button', { name: /generate/i }))

      expect(onGenerate).toHaveBeenCalledTimes(1)
    })

    it('disables buttons while generating', () => {
      renderPanel({ isGenerating: true })
      expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled()
    })

    it('shows generateStatus message when provided', () => {
      renderPanel({ generateStatus: 'Trajectory generated successfully' })
      expect(screen.getByText('Trajectory generated successfully')).toBeInTheDocument()
    })
  })

  describe('marker buttons', () => {
    it('shows "Mark on Video" for origin when not marked', () => {
      renderPanel({ originMarked: false })
      const markButtons = screen.getAllByRole('button', { name: /mark on video/i })
      expect(markButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('shows "Re-mark Origin" when origin is already marked', () => {
      renderPanel({ originMarked: true })
      expect(screen.getByRole('button', { name: /re-mark origin/i })).toBeInTheDocument()
    })

    it('calls onMarkOrigin when origin button is clicked', () => {
      const onMarkOrigin = vi.fn()
      renderPanel({ onMarkOrigin })

      const markButtons = screen.getAllByRole('button', { name: /mark on video/i })
      fireEvent.click(markButtons[0])

      expect(onMarkOrigin).toHaveBeenCalledTimes(1)
    })

    it('calls onMarkApex when apex button is clicked', () => {
      const onMarkApex = vi.fn()
      renderPanel({ onMarkApex })

      const markButtons = screen.getAllByRole('button', { name: /mark on video/i })
      fireEvent.click(markButtons[markButtons.length - 1])

      expect(onMarkApex).toHaveBeenCalledTimes(1)
    })

    it('shows "Re-mark Apex" when apex is already marked', () => {
      renderPanel({ apexMarked: true })
      expect(screen.getByRole('button', { name: /re-mark apex/i })).toBeInTheDocument()
    })
  })
})
