import { useReadContract, useReadContracts } from 'wagmi'
import { MILESTONE_ESCROW_ABI, getContractAddress } from '../lib/contract'
import type { MilestoneFull } from '../lib/types'
import { MilestoneState, MilestoneOutcome, UIStatus } from '../lib/types'

const ADDR_ZERO = '0x0000000000000000000000000000000000000000' as const

function parseState(v: number): MilestoneState {
  return v
}
function parseOutcome(v: number): MilestoneOutcome {
  return v
}
function parseUIStatus(v: number): UIStatus {
  return v
}

export function useMilestone(
  chainId: number | undefined,
  id: bigint | undefined,
): { data: MilestoneFull | undefined; isLoading: boolean; refetch: () => Promise<unknown> } {
  const address = getContractAddress(chainId)
  const enabled = !!address && id !== undefined && chainId !== undefined

  const base = {
    address: address ?? ADDR_ZERO,
    abi: MILESTONE_ESCROW_ABI,
    chainId,
  } as const

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: 'getMilestone',      args: [id ?? 0n] },
      { ...base, functionName: 'getMilestoneExtra', args: [id ?? 0n] },
      { ...base, functionName: 'status',            args: [id ?? 0n] },
    ],
    query: { enabled },
  })

  if (!data || !data[0].result || !data[1].result || !data[2].result) {
    return { data: undefined, isLoading, refetch }
  }

  const [lead, client, amount, deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
         deadline, submittedAt, disputedAt, stateRaw, outcomeRaw] = data[0].result as readonly [
    `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint,
    bigint, bigint, bigint, number, number
  ]

  const [payees, bps, pendingExtensionDeadline, pendingSplitProposer, pendingSplitRefundBps] =
    data[1].result as readonly [`0x${string}`[], bigint[], bigint, `0x${string}`, bigint]

  const [uiStatusRaw, relevantDeadline] = data[2].result as readonly [number, bigint]

  const full: MilestoneFull = {
    id: id!,
    lead, client, amount,
    deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
    deadline, submittedAt, disputedAt,
    state: parseState(stateRaw),
    outcome: parseOutcome(outcomeRaw),
    payees, bps,
    pendingExtensionDeadline,
    pendingSplitProposer,
    pendingSplitRefundBps,
    uiStatus: parseUIStatus(uiStatusRaw),
    relevantDeadline,
  }

  return { data: full, isLoading, refetch }
}

/** Read milestoneCount from the contract */
export function useMilestoneCount(chainId: number | undefined) {
  const address = getContractAddress(chainId)
  return useReadContract({
    address: address ?? ADDR_ZERO,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'milestoneCount',
    chainId,
    query: { enabled: !!address && !!chainId },
  })
}

/** Read pendingWithdrawals for an address */
export function usePendingWithdrawals(
  chainId: number | undefined,
  account: `0x${string}` | undefined,
) {
  const address = getContractAddress(chainId)
  return useReadContract({
    address: address ?? ADDR_ZERO,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'pendingWithdrawals',
    args: [account ?? ADDR_ZERO],
    chainId,
    query: { enabled: !!address && !!chainId && !!account },
  })
}
