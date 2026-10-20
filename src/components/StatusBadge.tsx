import { UIStatus, STATE_LABELS } from '../lib/types'

/** Dot colors per status */
const DOT: Record<UIStatus, string> = {
  [UIStatus.Created]:                'var(--subtle)',
  [UIStatus.InProgress]:             'var(--info)',
  [UIStatus.DeadlineMissed]:         'var(--warning)',
  [UIStatus.RefundEligible]:         'var(--danger)',
  [UIStatus.UnderReview]:            'var(--info)',
  [UIStatus.AutoApproveEligible]:    'var(--success)',
  [UIStatus.Disputed]:               'var(--danger)',
  [UIStatus.DisputeTimeoutEligible]: 'var(--warning)',
  [UIStatus.Settled]:                'var(--success)',
  [UIStatus.Cancelled]:              'var(--subtle)',
}

const BG: Record<UIStatus, string> = {
  [UIStatus.Created]:                'var(--surface-muted)',
  [UIStatus.InProgress]:             'var(--info-bg)',
  [UIStatus.DeadlineMissed]:         'var(--warning-bg)',
  [UIStatus.RefundEligible]:         'var(--danger-bg)',
  [UIStatus.UnderReview]:            'var(--info-bg)',
  [UIStatus.AutoApproveEligible]:    'var(--success-bg)',
  [UIStatus.Disputed]:               'var(--danger-bg)',
  [UIStatus.DisputeTimeoutEligible]: 'var(--warning-bg)',
  [UIStatus.Settled]:                'var(--success-bg)',
  [UIStatus.Cancelled]:              'var(--surface-muted)',
}

const COLOR: Record<UIStatus, string> = {
  [UIStatus.Created]:                'var(--muted)',
  [UIStatus.InProgress]:             'var(--info)',
  [UIStatus.DeadlineMissed]:         'var(--warning)',
  [UIStatus.RefundEligible]:         'var(--danger)',
  [UIStatus.UnderReview]:            'var(--info)',
  [UIStatus.AutoApproveEligible]:    'var(--success)',
  [UIStatus.Disputed]:               'var(--danger)',
  [UIStatus.DisputeTimeoutEligible]: 'var(--warning)',
  [UIStatus.Settled]:                'var(--success)',
  [UIStatus.Cancelled]:              'var(--subtle)',
}

export function StatusBadge({ status }: { status: UIStatus }) {
  const { label } = STATE_LABELS[status]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap tabnum"
      style={{ background: BG[status], color: COLOR[status] }}>
      <span className="size-1.5 rounded-full shrink-0" style={{ background: DOT[status] }} />
      {label}
    </span>
  )
}
