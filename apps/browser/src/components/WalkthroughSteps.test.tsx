// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { WalkthroughSteps } from './WalkthroughSteps'

expect.extend(matchers)

describe('WalkthroughSteps', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders without crashing', () => {
    const { container } = render(<WalkthroughSteps />)
    expect(container.firstChild).not.toBeNull()
  })

  it('renders "Upload Video" step label', () => {
    render(<WalkthroughSteps />)
    expect(screen.getByRole('heading', { name: 'Upload Video' })).toBeInTheDocument()
  })

  it('renders "Mark Tracers" step label', () => {
    render(<WalkthroughSteps />)
    expect(screen.getByRole('heading', { name: 'Mark Tracers' })).toBeInTheDocument()
  })

  it('renders "Export Clips" step label', () => {
    render(<WalkthroughSteps />)
    expect(screen.getByRole('heading', { name: 'Export Clips' })).toBeInTheDocument()
  })

  it('renders step numbers 1, 2, 3', () => {
    render(<WalkthroughSteps />)
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders step descriptions', () => {
    render(<WalkthroughSteps />)
    expect(screen.getByText('Drop your golf video or select a file')).toBeInTheDocument()
    expect(screen.getByText('Click landing points and review shot tracers')).toBeInTheDocument()
    expect(screen.getByText('Download clips with tracers burned in')).toBeInTheDocument()
  })

  it('renders exactly 3 steps', () => {
    const { container } = render(<WalkthroughSteps />)
    const steps = container.querySelectorAll('.walkthrough-step')
    expect(steps).toHaveLength(3)
  })
})
