/**
 * Extract a human-readable message from an unknown error.
 * Handles axios errors (err.response.data.message) and native Error objects.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { message?: string; error?: string } } }).response
    const msg = res?.data?.message || res?.data?.error
    if (msg) return msg
  }
  if (err instanceof Error) return err.message
  return fallback
}

/**
 * Extract the raw error code/detail from an unknown error (e.g. server
 * `error` field) for conditional branching. Returns undefined if not present.
 */
export function getErrorDetail(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { error?: string; message?: string } } }).response
    return res?.data?.error || res?.data?.message
  }
  if (err instanceof Error) return err.message
  return undefined
}