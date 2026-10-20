/**
 * Fetches milestones relevant to a wallet address by scanning MilestoneCreated logs,
 * then reads state for each. Scans from the deployment block forward in bounded 10k-block chunks.
 */
import { useEffect, useState, useCallback } from 'react'
import { createPublicClient, http, parseAbiItem } from 'viem'
import type { Chain } from 'viem'
import { arcTestnet } from 'viem/chains'
import { useAccount } from 'wagmi'
import {
  MILESTONE_ESCROW_ADDRESS, MILESTONE_ESCROW_ABI,
  DEPLOY_BLOCK, getRpcUrl, arcMainnet, ARC_MAINNET_CHAIN_ID,
  isSupported,
} from '../lib/contract'
import type { MilestoneFull } from '../lib/types'

const CHUNK = 10000n

const createdEvent = parseAbiItem(
  'event MilestoneCreated(uint256 indexed id, address indexed lead, address indexed client, uint256 amount, uint256 deliveryWindow, uint256 gracePeriod, uint256 reviewWindow, uint256 disputeWindow, address[] payees, uint256[] bps)',
)

export type MilestoneListItem = MilestoneFull & { role: 'lead' | 'client' | 'payee'; chainId: number }

export function useMilestoneList() {
  const { address, chainId } = useAccount()
  const [items, setItems] = useState<MilestoneListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!address || !chainId || !isSupported(chainId)) {
      setItems([])
      return
    }
    const contractAddress = MILESTONE_ESCROW_ADDRESS[chainId]
    if (!contractAddress) { setItems([]); return }

    setLoading(true)
    setError(null)
    try {
      const viemChain: Chain = chainId === ARC_MAINNET_CHAIN_ID ? arcMainnet : (arcTestnet)
      const client = createPublicClient({ chain: viemChain, transport: http(getRpcUrl(chainId)) })
      const head = await client.getBlockNumber()
      const fromBlock = DEPLOY_BLOCK[chainId] ?? 0n

      // Scan for MilestoneCreated events involving this address
      const matchingIds: { id: bigint; role: 'lead' | 'client' | 'payee' }[] = []
      let from = fromBlock

      while (from <= head) {
        const to = from + CHUNK > head ? head : from + CHUNK
        const logs = await client.getLogs({
          address: contractAddress,
          event: createdEvent,
          fromBlock: from,
          toBlock: to,
        })
        for (const log of logs) {
          const { id, lead, client: clientAddr, payees } = log.args as {
            id: bigint; lead: `0x${string}`; client: `0x${string}`; payees: `0x${string}`[]
          }
          const lower = address.toLowerCase()
          if (lead.toLowerCase() === lower) {
            matchingIds.push({ id, role: 'lead' })
          } else if (clientAddr.toLowerCase() === lower) {
            matchingIds.push({ id, role: 'client' })
          } else if (payees.some((p) => p.toLowerCase() === lower)) {
            matchingIds.push({ id, role: 'payee' })
          }
        }
        from = to + 1n
      }

      if (matchingIds.length === 0) {
        setItems([])
        return
      }

      // Batch-read state for each matching milestone
      const resolved: MilestoneListItem[] = []
      for (const { id, role } of matchingIds) {
        try {
          const [coreRaw, extraRaw, statusRaw] = await Promise.all([
            client.readContract({ address: contractAddress, abi: MILESTONE_ESCROW_ABI, functionName: 'getMilestone',      args: [id] }),
            client.readContract({ address: contractAddress, abi: MILESTONE_ESCROW_ABI, functionName: 'getMilestoneExtra', args: [id] }),
            client.readContract({ address: contractAddress, abi: MILESTONE_ESCROW_ABI, functionName: 'status',            args: [id] }),
          ])

          const [lead, clientAddr, amount, deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
                 deadline, submittedAt, disputedAt, stateN, outcomeN] = coreRaw as readonly [
            `0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, number
          ]
          const [payees, bps, pendingExtensionDeadline, pendingSplitProposer, pendingSplitRefundBps] =
            extraRaw as readonly [`0x${string}`[], bigint[], bigint, `0x${string}`, bigint]
          const [uiStatusN, relevantDeadline] = statusRaw as readonly [number, bigint]

          resolved.push({
            id, role, chainId,
            lead, client: clientAddr, amount,
            deliveryWindow, gracePeriod, reviewWindow, disputeWindow,
            deadline, submittedAt, disputedAt,
            state: stateN,
            outcome: outcomeN,
            payees, bps,
            pendingExtensionDeadline, pendingSplitProposer, pendingSplitRefundBps,
            uiStatus: uiStatusN,
            relevantDeadline,
          })
        } catch {
          // skip invalid milestone IDs
        }
      }

      setItems(resolved.sort((a, b) => Number(b.id - a.id)))
    } catch (e) {
      setError('Failed to load milestones. Please try again.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [address, chainId])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  return { items, loading, error, refetch: load }
}
