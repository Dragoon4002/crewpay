import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, RefreshCw, Loader2, ExternalLink, Lock, CheckCircle, Coins, ArrowRight, ChevronRight } from 'lucide-react'
import { useMilestoneList } from '../hooks/useMilestoneList'
import { StatusBadge } from '../components/StatusBadge'
import { WrongNetwork } from '../components/WrongNetwork'
import { Avatar } from '../components/Avatar'
import { formatUsdc, shortAddr, countdown } from '../lib/format'
import { UIStatus } from '../lib/types'
import { getAddressUrl, MILESTONE_ESCROW_ADDRESS, ARC_MAINNET_CHAIN_ID, DEFAULT_CHAIN_ID } from '../lib/contract'
import type { MilestoneListItem } from '../hooks/useMilestoneList'

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  lead:   { bg: 'var(--surface-muted)', color: 'var(--ink-2)' },
  client: { bg: 'var(--info-bg)',       color: 'var(--info)' },
  payee:  { bg: 'var(--success-bg)',    color: 'var(--success)' },
}

function MilestoneCard({ item, onClick }: { item: MilestoneListItem; onClick: () => void }) {
  const showCountdown =
    item.uiStatus !== UIStatus.Settled &&
    item.uiStatus !== UIStatus.Cancelled &&
    item.relevantDeadline > 0n

  const rc = ROLE_COLORS[item.role] ?? ROLE_COLORS.lead

  return (
    <button onClick={onClick}
      className="card w-full p-4 text-left transition-default hover:shadow-md active:scale-[0.995]"
      style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar address={item.lead} size={36} className="shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                Milestone #{item.id.toString()}
              </span>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: rc.bg, color: rc.color }}>
                {item.role}
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1">
              <span className="mono text-xl font-bold tabnum" style={{ color: 'var(--ink)' }}>
                ${formatUsdc(item.amount)}
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>USDC</span>
            </div>
            <p className="mt-0.5 mono text-[11px] truncate" style={{ color: 'var(--subtle)' }}>
              {shortAddr(item.lead)} → {shortAddr(item.client)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right flex flex-col items-end gap-1">
          <StatusBadge status={item.uiStatus} />
          {showCountdown && (
            <p className="text-[11px] tabnum" style={{ color: 'var(--subtle)' }}>
              {countdown(item.relevantDeadline)}
            </p>
          )}
          <ChevronRight className="size-4 mt-0.5" style={{ color: 'var(--subtle)' }} />
        </div>
      </div>
    </button>
  )
}

// ── Landing ────────────────────────────────────────────────────────────────────

const HOW_IT_WORKS = [
  { icon: Lock,        title: 'Lock',    desc: 'Client funds escrow with USDC — nothing moves until release' },
  { icon: ArrowRight,  title: 'Deliver', desc: 'Agency delivers and submits for review' },
  { icon: CheckCircle, title: 'Approve', desc: 'Client approves, or payment auto-releases after review window' },
  { icon: Coins,       title: 'Paid',    desc: 'One transaction pays every crew member their exact cut' },
]

function Landing() {
  const [pasteId, setPasteId] = useState('')
  const contractAddrMainnet = MILESTONE_ESCROW_ADDRESS[ARC_MAINNET_CHAIN_ID]
  const explorerUrl = contractAddrMainnet
    ? getAddressUrl(ARC_MAINNET_CHAIN_ID, contractAddrMainnet)
    : undefined

  function openLink() {
    const v = pasteId.trim()
    if (!v) return
    const m = v.match(/\/m\/(\d+)\/(\d+)$/) || v.match(/\/m\/(\d+)$/)
    if (m) {
      window.location.hash = m[0]
    } else if (/^\d+$/.test(v)) {
      window.location.hash = `/m/${DEFAULT_CHAIN_ID}/${v}`
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      {/* Hero */}
      <div className="mb-12 text-center" style={{ background: 'var(--bg-gradient)' }}>
        <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mb-4"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>
          <span className="size-1.5 rounded-full" style={{ background: 'var(--info)' }} />
          USDC on Arc Mainnet
        </div>
        <h1 className="mb-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl"
          style={{ color: 'var(--primary)', letterSpacing: '-0.03em' }}>
          Get paid as a crew.<br />One escrow, one release,<br />everyone paid.
        </h1>
        <p className="mx-auto max-w-lg text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
          Milestone escrow for small agencies. Client locks USDC; one transaction pays the whole team.
          No arbiter, no surprises — fixed rules written in a public contract.
        </p>
      </div>

      {/* Path cards */}
      <div className="mb-12 grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
        {/* Lead card */}
        <div className="card p-6 flex flex-col gap-4">
          <div className="flex size-10 items-center justify-center rounded-2xl"
            style={{ background: 'var(--primary)' }}>
            <Plus className="size-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--ink)' }}>I'm the agency lead</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Create a milestone, add your crew's wallets and percentages, share the payment link with your client.
            </p>
          </div>
          <div className="mt-auto">
            <ConnectKitButton />
          </div>
        </div>

        {/* Client card */}
        <div className="card p-6 flex flex-col gap-4">
          <div className="flex size-10 items-center justify-center rounded-2xl"
            style={{ background: 'var(--info-bg)' }}>
            <ExternalLink className="size-5" style={{ color: 'var(--info)' }} />
          </div>
          <div>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--ink)' }}>I'm the client</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Received a payment link? Open it directly. Or paste the link or milestone ID below.
            </p>
          </div>
          <div className="mt-auto flex gap-2 min-w-0">
            <input value={pasteId} onChange={(e) => setPasteId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') openLink() }}
              placeholder="Paste link or ID…"
              className="mono flex-1 min-w-0 rounded-full border px-4 py-2.5 text-sm outline-none focus:border-[var(--info)] transition-default"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-muted)' }} />
            <button onClick={openLink} disabled={!pasteId.trim()}
              className="shrink-0 rounded-full px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 transition-default hover:opacity-90"
              style={{ background: 'var(--primary)' }}>
              Open
            </button>
          </div>
        </div>
      </div>

      {/* How it works */}
      <div className="mb-12">
        <p className="mb-6 text-center text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
          How it works
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {HOW_IT_WORKS.map(({ icon: Icon, title, desc }, i) => (
            <div key={title} className="card p-5 text-center">
              <div className="mb-3 flex items-center justify-center">
                <div className="flex size-10 items-center justify-center rounded-2xl"
                  style={{ background: i === 0 ? 'var(--primary)' : 'var(--surface-muted)' }}>
                  <Icon className="size-5"
                    style={{ color: i === 0 ? '#fff' : 'var(--muted)' }} />
                </div>
              </div>
              <p className="text-xs font-bold mb-1" style={{ color: 'var(--ink)' }}>{i + 1}. {title}</p>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Trust row */}
      <div className="callout-info flex flex-col sm:flex-row items-center justify-center gap-4 text-xs text-center"
        style={{ color: 'var(--info)' }}>
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5 shrink-0" />
          Funds held by an open contract, not by us
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-0.5 underline hover:opacity-70">
              (view <ExternalLink className="size-3" />)
            </a>
          )}
        </span>
        <span className="hidden sm:block" style={{ color: 'rgba(47,107,255,0.3)' }}>·</span>
        <span>USDC on Arc</span>
        <span className="hidden sm:block" style={{ color: 'rgba(47,107,255,0.3)' }}>·</span>
        <span>No arbiter: two parties, fixed rules</span>
      </div>
    </div>
  )
}

// ── Connected: My milestones ───────────────────────────────────────────────────

export function HomePage() {
  const { isConnected } = useAccount()
  const { items, loading, error, refetch } = useMilestoneList()
  const navigate = (hash: string) => { window.location.hash = hash }

  if (!isConnected) return <Landing />

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <WrongNetwork />

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ color: 'var(--ink)' }}>My milestones</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { void refetch() }}
            className="rounded-full p-2 transition-default hover:bg-[var(--surface-muted)]" title="Refresh">
            <RefreshCw className="size-4" style={{ color: 'var(--muted)' }} />
          </button>
          <button onClick={() => navigate('/create')}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-white transition-default hover:opacity-90 active:scale-95"
            style={{ background: 'var(--primary)' }}>
            <Plus className="size-4" /> New milestone
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-[20px]" />)}
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          <button onClick={() => { void refetch() }} className="mt-3 text-sm font-bold" style={{ color: 'var(--info)' }}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="mb-1 font-bold text-sm" style={{ color: 'var(--ink)' }}>No milestones yet</p>
          <p className="mb-6 text-sm" style={{ color: 'var(--muted)' }}>
            Create your first or ask a lead to share their payment link.
          </p>
          <button onClick={() => navigate('/create')}
            className="btn-primary mx-auto">
            <Plus className="size-4" /> Create milestone
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <MilestoneCard key={`${item.chainId}-${item.id}`} item={item}
              onClick={() => navigate(`/m/${item.chainId}/${item.id}`)} />
          ))}
          {loading && (
            <div className="mt-2 flex justify-center gap-2" style={{ color: 'var(--muted)' }}>
              <Loader2 className="size-4 animate-spin" />
              <span className="text-xs">Scanning…</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
