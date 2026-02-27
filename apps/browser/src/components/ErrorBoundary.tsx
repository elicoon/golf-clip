import React from 'react'
import { createLogger } from '../lib/logger'

const log = createLogger('ErrorBoundary')

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error('Caught an error', { error: error.message, stack: error.stack, componentStack: errorInfo.componentStack })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred. You can try resetting the app.</p>
          {import.meta.env.DEV && this.state.error && (
            <pre className="error-boundary-details">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
          <button className="btn btn-primary" onClick={this.handleReset}>
            Reset
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
