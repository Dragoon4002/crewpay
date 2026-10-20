/**
 * Shows a banner only when a wallet IS connected AND the chain is not supported.
 * Bug 3 fix: no banner for disconnected visitors.
 */
import { useSwitchChain, useAccount } from 'wagmi'
import { AlertTriangle } from 'lucide-react'
import { isSupported, ARC_TESTNET_CHAIN_ID, getChainName } from '../lib/contract'

interface Props {
  /** When set, offer to switch to a specific chain (e.g. the chain in the share link) */
  targetChainId?: number
}

export function WrongNetwork({ targetChainId }: Props) {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  // Bug 3: only show when connected
  if (!isConnected) return null

  // If a target chain is given, show when connected wallet is on a different chain
  if (targetChainId !== undefined) {
    if (chainId === targetChainId) return null
    const targetName = getChainName(targetChainId)
    return (
      <div className="mb-4 flex items-start gap-3 rounded-xl p-3"
        style={{ background: 'var(--warning-bg)', border: '1px solid rgba(217,119,6,0.25)' }}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
            You're on {getChainName(chainId)} — this milestone is on {targetName}.
          </p>
          <button
            onClick={() => switchChain({ chainId: targetChainId })}
            disabled={isPending}
            className="mt-1 text-sm font-semibold disabled:opacity-40"
            style={{ color: 'var(--warning)' }}
          >
            {isPending ? 'Switching…' : `Switch to ${targetName} →`}
          </button>
        </div>
      </div>
    )
  }

  // Generic: wallet connected to an unsupported chain
  if (isSupported(chainId)) return null

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl p-3"
      style={{ background: 'var(--danger-bg)', border: '1px solid rgba(220,38,38,0.2)' }}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--danger)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          Please switch to Arc Testnet to use CrewPay.
        </p>
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
          disabled={isPending}
          className="mt-1 text-sm font-semibold disabled:opacity-40"
          style={{ color: 'var(--danger)' }}
        >
          {isPending ? 'Switching…' : 'Switch network →'}
        </button>
      </div>
    </div>
  )
}
