/**
 * Format a numeric amount as Indian Rupees (₹) with en-IN locale grouping
 * and exactly 2 fractional digits. Accepts number, string, null or undefined.
 */
export function formatINR(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  const value = n != null && Number.isFinite(n) ? n : 0
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Format a compact amount (e.g. ₹1.2k) for tight UI such as dashboards.
 */
export function formatINRCompact(amount: number | string | null | undefined): string {
  const n = typeof amount === 'string' ? Number(amount) : amount
  const value = n != null && Number.isFinite(n) ? n : 0
  if (Math.abs(value) >= 1000) {
    return `₹${(value / 1000).toFixed(1)}k`
  }
  return `₹${Math.round(value)}`
}
