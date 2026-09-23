import { useEffect, useState, useCallback, useRef } from 'react'

interface UseAsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

interface UseAsyncOptions<T> {
  immediate?: boolean
  cancelPrevious?: boolean
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
}

/**
 * Hook for managing async operations with loading and error states
 * @param asyncFunction - Async function to execute
 * @param immediate - Whether to execute immediately (default: true)
 * @returns Object with data, loading, error, and execute/retry functions
 */
export function useAsync<T>(
  asyncFunction: (signal: AbortSignal) => Promise<T>,
  immediate = true,
  options?: UseAsyncOptions<T>
) {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  })
  const inFlight = useRef<Promise<T> | null>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const asyncFunctionRef = useRef(asyncFunction)
  const optionsRef = useRef(options)
  asyncFunctionRef.current = asyncFunction
  optionsRef.current = options

  const execute = useCallback(() => {
    if (inFlight.current) {
      if (!optionsRef.current?.cancelPrevious) return inFlight.current
      controller.current?.abort()
      inFlight.current = null
    }
    const requestController = new AbortController()
    controller.current = requestController
    if (mounted.current) setState({ data: null, loading: true, error: null })
    const request = Promise.resolve()
      .then(() => asyncFunctionRef.current(requestController.signal))
      .then((response) => {
        if (mounted.current && !requestController.signal.aborted) {
          setState({ data: response, loading: false, error: null })
          optionsRef.current?.onSuccess?.(response)
        }
        return response
      })
      .catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error))
        if (mounted.current && !requestController.signal.aborted) {
          setState({ data: null, loading: false, error: err })
          optionsRef.current?.onError?.(err)
        }
        throw err
      })
      .finally(() => {
        if (inFlight.current === request) inFlight.current = null
        if (controller.current === requestController) controller.current = null
      })
    inFlight.current = request
    return request
  }, [])

  const retry = useCallback(() => {
    void execute().catch(() => {})
  }, [execute])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      controller.current = null
      inFlight.current = null
    }
  }, [])

  useEffect(() => {
    if (immediate) void execute().catch(() => {})
  }, [execute, immediate])

  return {
    ...state,
    execute,
    retry,
  }
}
