import { ReactNode, Component, ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, retry: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  retry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        this.props.fallback?.(this.state.error, this.retry) || (
          <div className="flex items-center justify-center min-h-96 p-4">
            <div className="text-center max-w-md">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-danger-50 dark:bg-danger-500/10 mb-4">
                <AlertTriangle className="w-8 h-8 text-danger-500" />
              </div>
              <h2 className="text-xl font-bold text-surface-900 dark:text-white mb-2">
                Something went wrong
              </h2>
              <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 line-clamp-3">
                {this.state.error.message}
              </p>
              <button
                onClick={this.retry}
                className="btn btn-primary btn-sm inline-flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
            </div>
          </div>
        )
      )
    }

    return this.props.children
  }
}
