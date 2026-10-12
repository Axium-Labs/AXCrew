const scale = 1_000_000n

/** Convert display dollars to the integer micro-USD protocol without rounding. */
export function dollarsToMicrousd(text: string): number | null {
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const amount = BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'))
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}

export function microusdToDollars(amount: number): string {
  // Invalid legacy values must block writes rather than change a saved limit.
  if (!Number.isInteger(amount) || amount < 0) return '—'
  const value = BigInt(amount)
  const fraction = String(value % scale).padStart(6, '0').replace(/0+$/, '')
  return `${value / scale}${fraction ? `.${fraction}` : ''}`
}
