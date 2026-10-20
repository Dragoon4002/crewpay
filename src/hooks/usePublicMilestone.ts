/**
 * Reads a single milestone via a viem publicClient — no wallet required.
 * Used by MilestonePage so the page renders for unauthenticated visitors.
 */
import { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http } from 'viem'
import type { Chain } from 'viem'
import { arcTestnet } from 'viem/chains'
import {
  MILESTONE_ESCROW_ABI,
  getContractAddress,
  getRpcUrl,
  arcMainnet,
  ARC_MAINNET_CHAIN_ID,
} from '../lib/contract'
import type { MilestoneFull } from '../lib/types'
import { MilestoneState, MilestoneOutcome, UIStatus } from '../lib/types'

const ADDR_ZERO = '0x0000000000000000000000000000000000000000' as const

function getViemChain(chainId: number): Chain {
  if (chainId === ARC_MAINNET_CHAIN_ID) return arcMainnet
  return arcTestnet
}

export function usePublicMilestone(chainId: number, id: bigint) {
  const [data, setData] = useState<MilestoneFull | undefined>()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const address = getContractAddress(chainId)

  const load = useCallback(async () => {
    if (!address) {
      setData(undefined)
      setError('Contract not deployed on this chain.')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const client = createPublicClient({
        chain: getViemChain(chainId),
        transport: http(getRpcUrl(chainId)),
      })

      const [coreRaw, extraRaw, statusRaw] = await Promise.all([
        client.readContract({ address, abi: MILESTONE_ESCROW_ABI, functionName: 'getMilestone',      args: [id] }),
        client.readContract({ address, abi: MILESTONE_ESCROW_ABI, functionName: 'getMilestoneExtra', args: [id] }),
        client.readContract({ address, abi: MILESTONE_ESCROW_ABI, functionName: 'status',            args: [id] }),
      ])

      const [lead, clientAddr, amount, deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
             deadline, submittedAt, disputedAt, stateN, outcomeN] = coreRaw as readonly [
        `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint,
        bigint, bigint, bigint, number, number
      ]
      const [payees, bps, pendingExtensionDeadline, pendingSplitProposer, pendingSplitRefundBps] =
        extraRaw as readonly [`0x${string}`[], bigint[], bigint, `0x${string}`, bigint]
      const [uiStatusN, relevantDeadline] = statusRaw as readonly [number, bigint]

      // A non-existent milestone returns zero lead
      if (lead === ADDR_ZERO) {
        setData(undefined)
        setError(null)
        setIsLoading(false)
        return
      }

      setData({
        id,
        lead, client: clientAddr, amount,
        deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
        deadline, submittedAt, disputedAt,
        state: stateN as MilestoneState,
        outcome: outcomeN as MilestoneOutcome,
        payees, bps,
        pendingExtensionDeadline, pendingSplitProposer, pendingSplitRefundBps,
        uiStatus: uiStatusN as UIStatus,
        relevantDeadline,
      })
    } catch (e) {
      console.error('usePublicMilestone error', e)
      setError('Failed to load milestone data.')
      setData(undefined)
    } finally {
      setIsLoading(false)
    }
  }, [chainId, id, address])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  return { data, isLoading, error, refetch: load }
}

/** Read pendingWithdrawals for an address via public client */
export async function fetchPendingWithdrawals(
  chainId: number,
  account: `0x${string}`,
): Promise<bigint> {
  const address = getContractAddress(chainId)
  if (!address) return 0n
  const client = createPublicClient({
    chain: getViemChain(chainId),
    transport: http(getRpcUrl(chainId)),
  })
  return client.readContract({
    address,
    abi: MILESTONE_ESCROW_ABI,
    functionName: 'pendingWithdrawals',
    args: [account],
  }) as Promise<bigint>
}
