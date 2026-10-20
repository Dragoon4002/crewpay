import { formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from './contract'

/** Format a raw USDC bigint as "$1,234.56" */
export function formatUsdc(raw: bigint): string {
  const n = Number(formatUnits(raw, USDC_DECIMALS))
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

/** Parse a user-entered USDC string to raw bigint. Throws on invalid input. */
export function parseUsdc(value: string): bigint {
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned || isNaN(Number(cleaned))) throw new Error('Invalid USDC amount')
  return parseUnits(cleaned, USDC_DECIMALS)
}

/** Shorten an address for display: 0x1234…abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Format seconds duration as "14d", "3h", "45m" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d${h > 0 ? ` ${h}h` : ''}`
  if (h > 0) return `${h}h${m > 0 ? ` ${m}m` : ''}`
  return `${m}m`
}

/** Countdown to a Unix timestamp (seconds). Returns "Expired" if past. */
export function countdown(ts: bigint): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = Number(ts) - now
  if (diff <= 0) return 'Expired'
  return formatDuration(diff) + ' left'
}

/** Format a Unix timestamp as "Oct 18, 14:32" */
export function formatTs(ts: bigint): string {
  if (ts === 0n) return '—'
  return new Date(Number(ts) * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

/** bps → "50.00%" */
export function bpsToPercent(bps: bigint): string {
  return (Number(bps) / 100).toFixed(2) + '%'
}

/** Parse user-entered percent string "50" → 5000n bps. Rounds. */
export function percentToBps(pct: string): bigint {
  const n = parseFloat(pct)
  if (isNaN(n)) return 0n
  return BigInt(Math.round(n * 100))
}

/** Friendly error message extraction */
export function parseOnchainError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err)
  const lower = msg.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Transaction cancelled.'
  if (lower.includes('insufficient')) return 'Insufficient balance.'
  if (lower.includes('notclient')) return 'Only the client can do that.'
  if (lower.includes('notlead')) return 'Only the lead can do that.'
  if (lower.includes('invalidstate')) return 'Action not allowed in the current state.'
  if (lower.includes('notsettleable')) return 'Settlement conditions not met yet.'
  if (lower.includes('deadlinepassed')) return 'Delivery deadline has passed.'
  if (lower.includes('reviewwindowexpired')) return 'Review window has closed.'
  if (lower.includes('reverted')) return 'Transaction reverted — check contract state.'
  return 'Transaction failed. Please try again.'
}
