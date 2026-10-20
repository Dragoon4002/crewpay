/**
 * Bottom sheet (mobile) / centered modal (desktop) for destructive confirms.
 * Shows the outcome in plain-English USDC numbers before the user commits.
 */
import { X } from 'lucide-react'
import { useEffect } from 'react'

interface Props {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  confirmVariant?: 'danger' | 'primary' | 'cta'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ open, title, description, confirmLabel, confirmVariant = 'danger', onConfirm, onCancel }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const confirmStyle: React.CSSProperties = confirmVariant === 'danger'
    ? { background: 'var(--danger)' }
    : confirmVariant === 'cta'
    ? { background: 'var(--accent)' }
    : { background: 'var(--primary)' }

  return (
    <div className="sheet-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="sheet-panel" style={{ background: 'var(--surface)' }}>
        <div className="sheet-handle" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
          <button onClick={onCancel}
            className="rounded-full p-1.5 transition-default hover:bg-[var(--surface-muted)]">
            <X className="size-4" style={{ color: 'var(--muted)' }} />
          </button>
        </div>
        <div className="mb-6 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>{description}</div>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 rounded-full border py-3 text-sm font-bold transition-default hover:bg-[var(--surface-muted)]"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-2)' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 rounded-full py-3 text-sm font-bold text-white transition-default hover:opacity-90"
            style={confirmStyle}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
