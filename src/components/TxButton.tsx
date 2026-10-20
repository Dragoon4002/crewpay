import { Loader2 } from 'lucide-react'

interface TxButtonProps {
  label: string
  pendingLabel?: string
  confirmingLabel?: string
  onClick: () => void | Promise<void>
  disabled?: boolean
  isPending?: boolean
  isConfirming?: boolean
  variant?: 'cta' | 'primary' | 'secondary' | 'danger' | 'ghost'
  className?: string
  fullWidth?: boolean
}

export function TxButton({
  label,
  pendingLabel = 'Confirm in wallet…',
  confirmingLabel = 'Confirming…',
  onClick,
  disabled,
  isPending,
  isConfirming,
  variant = 'primary',
  className = '',
  fullWidth = true,
}: TxButtonProps) {
  const busy = isPending || isConfirming

  const base = `inline-flex items-center justify-center gap-2 rounded-full py-3 px-6 text-sm font-bold
    transition-default cursor-pointer
    focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
    disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.97]`

  type VariantStyle = { className: string; style: React.CSSProperties }
  const variantMap: Record<string, VariantStyle> = {
    cta:       { className: 'text-white hover:opacity-90', style: { background: 'var(--primary)' } },
    primary:   { className: 'text-white hover:opacity-90', style: { background: 'var(--primary)' } },
    secondary: { className: 'text-white hover:opacity-90', style: { background: 'var(--primary)' } },
    danger:    { className: 'text-white hover:opacity-90', style: { background: 'var(--danger)' } },
    ghost:     {
      className: 'hover:bg-[var(--surface-muted)]',
      style: { border: '1.5px solid var(--border-strong)', color: 'var(--ink)', background: 'var(--surface)' },
    },
  }

  const { className: variantCls, style: variantStyle } = variantMap[variant] ?? variantMap.primary

  return (
    <button
      disabled={disabled || busy}
      onClick={() => { void onClick() }}
      className={`${base} ${variantCls} ${fullWidth ? 'w-full' : ''} ${className}`}
      style={variantStyle}
    >
      {isPending ? (
        <><Loader2 className="size-4 animate-spin" />{pendingLabel}</>
      ) : isConfirming ? (
        <><Loader2 className="size-4 animate-spin" />{confirmingLabel}</>
      ) : label}
    </button>
  )
}
