import { useEffect, useState, useCallback } from 'react'

interface UseAsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

interface UseAsyncOptions<T> {
  immediate?: boolean
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
  asyncFunction: () => Promise<T>,
  immediate = true,
  options?: UseAsyncOptions<T>
) {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  })

  const execute = useCallback(async () => {
    setState({ data: null, loading: true, error: null })
    try {
      const response = await asyncFunction()
      setState({ data: response, loading: false, error: null })
      options?.onSuccess?.(response)
      return response
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      setState({ data: null, loading: false, error: err })
      options?.onError?.(err)
      throw err
    }
  }, [asyncFunction, options])

  const retry = useCallback(() => {
    execute()
  }, [execute])

  useEffect(() => {
    if (immediate) {
      execute()
    }
  }, [execute, immediate])

  return {
    ...state,
    execute,
    retry,
  }
}
