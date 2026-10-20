/** Mirror of the Solidity enums — keep in sync with MilestoneEscrow.sol */

export enum MilestoneState {
  Created = 0,
  InProgress = 1,
  UnderReview = 2,
  Disputed = 3,
  Settled = 4,
  Cancelled = 5,
}

export enum MilestoneOutcome {
  None = 0,
  Approved = 1,
  AutoApproved = 2,
  ClientConceded = 3,
  LeadConceded = 4,
  SplitSettlement = 5,
  Refunded = 6,
  DisputeTimeout = 7,
}

export enum UIStatus {
  Created = 0,
  InProgress = 1,
  DeadlineMissed = 2,
  RefundEligible = 3,
  UnderReview = 4,
  AutoApproveEligible = 5,
  Disputed = 6,
  DisputeTimeoutEligible = 7,
  Settled = 8,
  Cancelled = 9,
}

export type Role = 'lead' | 'client' | 'payee' | 'none'

export interface MilestoneCore {
  id: bigint
  lead: `0x${string}`
  client: `0x${string}`
  amount: bigint
  deliveryWindow: bigint
  gracePeriod: bigint
  reviewWindow: bigint
  disputeWindow: bigint
  deadline: bigint
  submittedAt: bigint
  disputedAt: bigint
  state: MilestoneState
  outcome: MilestoneOutcome
}

export interface MilestoneExtra {
  payees: readonly `0x${string}`[]
  bps: readonly bigint[]
  pendingExtensionDeadline: bigint
  pendingSplitProposer: `0x${string}`
  pendingSplitRefundBps: bigint
}

export interface MilestoneFull extends MilestoneCore, MilestoneExtra {
  uiStatus: UIStatus
  relevantDeadline: bigint
}

/** State label → display strings */
export const STATE_LABELS: Record<UIStatus, { label: string; color: string }> = {
  [UIStatus.Created]:               { label: 'Awaiting funds',     color: 'text-[var(--muted)]'  },
  [UIStatus.InProgress]:            { label: 'In progress',        color: 'text-[var(--accent-hover)]' },
  [UIStatus.DeadlineMissed]:        { label: 'Deadline missed',    color: 'text-[var(--warning)]' },
  [UIStatus.RefundEligible]:        { label: 'Refund eligible',    color: 'text-[var(--danger)]'  },
  [UIStatus.UnderReview]:           { label: 'Under review',       color: 'text-[var(--accent-hover)]' },
  [UIStatus.AutoApproveEligible]:   { label: 'Auto-approve ready', color: 'text-[var(--success)]' },
  [UIStatus.Disputed]:              { label: 'Disputed',           color: 'text-[var(--danger)]'  },
  [UIStatus.DisputeTimeoutEligible]:{ label: 'Timeout eligible',   color: 'text-[var(--warning)]' },
  [UIStatus.Settled]:               { label: 'Settled',            color: 'text-[var(--success)]' },
  [UIStatus.Cancelled]:             { label: 'Cancelled',          color: 'text-[var(--subtle)]'  },
}

export const OUTCOME_LABELS: Record<MilestoneOutcome, string> = {
  [MilestoneOutcome.None]:            'Pending',
  [MilestoneOutcome.Approved]:        'Approved by client',
  [MilestoneOutcome.AutoApproved]:    'Auto-approved',
  [MilestoneOutcome.ClientConceded]:  'Client conceded',
  [MilestoneOutcome.LeadConceded]:    'Lead conceded',
  [MilestoneOutcome.SplitSettlement]: 'Negotiated split',
  [MilestoneOutcome.Refunded]:        'Refunded',
  [MilestoneOutcome.DisputeTimeout]:  'Dispute timeout',
}
