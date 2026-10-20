import { useState, useRef, useEffect } from 'react'
import { ConnectKitButton } from 'connectkit'
import { ChevronDown, ExternalLink, Check } from 'lucide-react'
import { useAccount, useSwitchChain } from 'wagmi'
import {
  getAddressUrl, MILESTONE_ESCROW_ADDRESS,
  ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID,
} from '../lib/contract'

function NetworkDropdown() {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const isTestnet  = isConnected  && chainId === ARC_TESTNET_CHAIN_ID
  const isOther    = isConnected  && chainId !== ARC_MAINNET_CHAIN_ID && chainId !== ARC_TESTNET_CHAIN_ID

  const dotColor = isOther ? 'var(--danger)' : isTestnet ? 'var(--warning)' : 'var(--success)'
  const label    = isOther ? 'Wrong network' : isTestnet ? 'Testnet' : 'Mainnet'

  const networks = [
    { id: ARC_MAINNET_CHAIN_ID, label: 'Arc Mainnet',  dot: 'var(--success)' },
    { id: ARC_TESTNET_CHAIN_ID, label: 'Arc Testnet',  dot: 'var(--warning)' },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-default border"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border-strong)',
          color: 'var(--ink)',
        }}
      >
        <span className="size-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
        {label}
        <ChevronDown className="size-3 shrink-0" style={{ color: 'var(--muted)' }} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 card py-1 min-w-[160px]"
          style={{ boxShadow: '0 4px 16px rgba(16,24,40,.10)' }}>
          {networks.map((n) => {
            const active = isConnected ? chainId === n.id : n.id === ARC_MAINNET_CHAIN_ID
            const addr = MILESTONE_ESCROW_ADDRESS[n.id]
            return (
              <div key={n.id}>
                <button
                  onClick={() => {
                    if (isConnected) switchChain({ chainId: n.id })
                    setOpen(false)
                  }}
                  disabled={isPending}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-medium transition-default hover:bg-[var(--surface-muted)] disabled:opacity-40"
                  style={{ color: 'var(--ink)' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full shrink-0" style={{ background: n.dot }} />
                    {n.label}
                  </span>
                  {active && <Check className="size-3 shrink-0" style={{ color: 'var(--success)' }} />}
                </button>
                {addr && (
                  <a href={getAddressUrl(n.id, addr)} target="_blank" rel="noreferrer"
                    className="flex w-full items-center gap-1 px-3 pb-2 text-[10px] transition-default hover:underline"
                    style={{ color: 'var(--muted)' }}>
                    <ExternalLink className="size-2.5" /> Contract
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full"
      style={{
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        {/* Wordmark — navy on white, always visible */}
        <a href="#/"
          className="text-lg font-extrabold tracking-tight"
          style={{ color: 'var(--primary)', fontFamily: "'Plus Jakarta Sans', sans-serif", textDecoration: 'none' }}>
          CrewPay
        </a>

        <div className="flex items-center gap-2">
          <NetworkDropdown />
          <ConnectKitButton />
        </div>
      </div>
    </header>
  )
}
