/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import React from 'react'
import { ErrorBoundary } from './ErrorBoundary'

expect.extend(matchers)

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message')
  }
  return <div>Child content</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // Suppress React error boundary console output during tests
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders fallback UI when a child component throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(screen.queryByText('Child content')).not.toBeInTheDocument()
  })

  it('logs the error via componentDidCatch', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    // Logger outputs: [timestamp] [ERROR] [ErrorBoundary], message, context
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\] \[ErrorBoundary\]/),
      'Caught an error',
      expect.objectContaining({ error: 'Test error message', stack: expect.any(String), componentStack: expect.any(String) })
    )
  })

  it('shows error details in dev mode', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    // import.meta.env.DEV is true in vitest
    expect(screen.getByText(/Test error message/)).toBeInTheDocument()
  })

  it('calls window.location.reload when Reset is clicked', () => {
    const originalLocation = window.location
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadMock },
      writable: true,
      configurable: true,
    })

    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(reloadMock).toHaveBeenCalledOnce()

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    })
  })
})
