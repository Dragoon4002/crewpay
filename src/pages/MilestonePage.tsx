import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import {
  ArrowLeft, ExternalLink, RefreshCw, Copy, Check,
  AlertTriangle, Home, MoreHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { usePublicMilestone, fetchPendingWithdrawals } from '../hooks/usePublicMilestone'
import { StatusBadge } from '../components/StatusBadge'
import { WrongNetwork } from '../components/WrongNetwork'
import { TxButton } from '../components/TxButton'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Avatar } from '../components/Avatar'
import {
  MILESTONE_ESCROW_ABI, getContractAddress, USDC_ADDRESS,
  getTxUrl, getAddressUrl, buildShareLink, getChainName,
} from '../lib/contract'
import {
  formatUsdc, shortAddr, countdown, formatTs, bpsToPercent, parseOnchainError, formatDuration,
} from '../lib/format'
import { MilestoneState, UIStatus, OUTCOME_LABELS, MilestoneOutcome } from '../lib/types'

interface Props { chainId: number; id: bigint }

// ── Step chips ────────────────────────────────────────────────────────────────

function StepChips({ state, relevantDeadline, outcome }: {
  state: MilestoneState
  uiStatus?: UIStatus
  relevantDeadline: bigint
  outcome: MilestoneOutcome
}) {
  if (state === MilestoneState.Cancelled) {
    return (
      <div className="step-chips mb-5">
        <div className="step-chip" style={{ borderColor: 'var(--subtle)', color: 'var(--subtle)' }}>
          <span className="step-chip-icon"><AlertTriangle className="size-3" /></span>
          Cancelled
        </div>
      </div>
    )
  }

  type ChipState = 'done' | 'current' | 'dispute' | ''
  const isDisputed = state === MilestoneState.Disputed
  const isDone = (s: MilestoneState) => {
    const order = [
      MilestoneState.Created,
      MilestoneState.InProgress,
      MilestoneState.UnderReview,
      MilestoneState.Disputed,
      MilestoneState.Settled,
    ]
    return order.indexOf(state) > order.indexOf(s)
  }

  type Chip = { label: string; chipState: ChipState; sub?: string }
  const chips: Chip[] = [
    {
      label: 'Funded',
      chipState: isDone(MilestoneState.Created) ? 'done'
        : state === MilestoneState.Created ? 'current' : 'done',
    },
    {
      label: 'In progress',
      chipState: isDone(MilestoneState.InProgress) ? 'done'
        : state === MilestoneState.InProgress ? 'current' : '',
      sub: state === MilestoneState.InProgress && relevantDeadline > 0n
        ? countdown(relevantDeadline) : undefined,
    },
    {
      label: isDisputed ? 'Disputed' : 'Review',
      chipState: isDisputed ? 'dispute'
        : isDone(MilestoneState.UnderReview) ? 'done'
        : state === MilestoneState.UnderReview ? 'current' : '',
      sub: state === MilestoneState.UnderReview && relevantDeadline > 0n
        ? countdown(relevantDeadline) : undefined,
    },
    {
      label: 'Settled',
      chipState: state === MilestoneState.Settled ? 'done' : '',
      sub: state === MilestoneState.Settled ? OUTCOME_LABELS[outcome] : undefined,
    },
  ]

  return (
    <div className="step-chips mb-5">
      {chips.map((c) => (
        <div key={c.label} className={`step-chip ${c.chipState}`}>
          <span className="step-chip-icon">
            {c.chipState === 'done'
              ? <Check className="size-3" />
              : c.chipState === 'dispute'
              ? <AlertTriangle className="size-3" />
              : <span className="text-[10px] font-bold">{chips.indexOf(c) + 1}</span>}
          </span>
          <span>
            {c.label}
            {c.sub && (
              <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--muted)' }}>
                · {c.sub}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Money bar ──────────────────────────────────────────────────────────────────

const BAR_COLORS = [
  '#0B1437','#2F6BFF','#12B76A','#F79009','#8B5CF6','#EF4444',
  '#0EA5E9','#D97706','#10B981','#6366F1',
]

function MoneyBar({ payees, bps, amount, walletAddr }: {
  payees: readonly `0x${string}`[]
  bps: readonly bigint[]
  amount: bigint
  walletAddr?: `0x${string}`
}) {
  if (payees.length === 0) return null
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {payees.map((_, i) => (
          <div key={i} style={{ width: `${Number(bps[i]) / 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {payees.map((addr, i) => {
          const usdcAmt = (amount * bps[i]) / 10000n
          const isYou = !!walletAddr && addr.toLowerCase() === walletAddr.toLowerCase()
          return (
            <div key={i} className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: BAR_COLORS[i % BAR_COLORS.length] }} />
                <Avatar address={addr} size={24} className="shrink-0" />
                <span className="mono text-xs truncate" style={{ color: 'var(--muted)' }}>{shortAddr(addr)}</span>
                {isYou && (
                  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                    style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>you</span>
                )}
              </div>
              <div className="shrink-0 flex items-center gap-2 tabnum">
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>{bpsToPercent(bps[i])}</span>
                <span className="mono text-sm font-bold" style={{ color: 'var(--ink)' }}>${formatUsdc(usdcAmt)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Address cell ───────────────────────────────────────────────────────────────

function AddrCell({ addr, chainId, isYou }: { addr: `0x${string}`; chainId: number; isYou: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 group min-w-0">
      <Avatar address={addr} size={20} className="shrink-0" />
      <a href={getAddressUrl(chainId, addr)} target="_blank" rel="noreferrer"
        className="mono text-xs hover:underline truncate" style={{ color: 'var(--ink-2)' }}>
        {shortAddr(addr)}
      </a>
      {isYou && (
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>you</span>
      )}
      <button onClick={() => {
        void navigator.clipboard.writeText(addr)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }} className="opacity-0 group-hover:opacity-100 transition-default rounded-full p-0.5">
        {copied
          ? <Check className="size-3" style={{ color: 'var(--success)' }} />
          : <Copy className="size-3" style={{ color: 'var(--subtle)' }} />}
      </button>
      <a href={getAddressUrl(chainId, addr)} target="_blank" rel="noreferrer"
        className="opacity-0 group-hover:opacity-100 transition-default">
        <ExternalLink className="size-3" style={{ color: 'var(--subtle)' }} />
      </a>
    </span>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function MilestonePage({ chainId, id }: Props) {
  const { address, chainId: walletChain, isConnected } = useAccount()

  const { data: ms, isLoading, error: loadError, refetch } = usePublicMilestone(chainId, id)
  const contractAddress = getContractAddress(walletChain ?? chainId)

  const [pendingAmt, setPendingAmt] = useState<bigint>(0n)
  const walletOnRightChain = isConnected && walletChain === chainId

  useEffect(() => {
    if (!address || !walletOnRightChain) { setPendingAmt(0n); return }
    void fetchPendingWithdrawals(chainId, address).then(setPendingAmt)
  }, [chainId, address, walletOnRightChain])

  const [tab, setTab]               = useState<'overview' | 'crew' | 'activity'>('overview')
  const [disputeReason, setDisputeReason] = useState('')
  const [extensionDate, setExtensionDate] = useState('')
  const [splitPct, setSplitPct]     = useState('50')
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()
  const [copied, setCopied]         = useState(false)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [confirmDispute, setConfirmDispute] = useState(false)
  const [confirmConcede, setConfirmConcede] = useState(false)

  const { writeContractAsync, isPending } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0', (getContractAddress(chainId) ?? '0x0')],
    chainId: walletChain,
    query: { enabled: !!address && !!walletOnRightChain && !!getContractAddress(chainId) },
  })
  const { isLoading: approveConfirming } = useWaitForTransactionReceipt({ hash: approveHash })

  useEffect(() => {
    if (!isSuccess) return
    void refetch()
    if (address) void fetchPendingWithdrawals(chainId, address).then(setPendingAmt)
    toast.dismiss('tx')
    toast.success('Transaction confirmed')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  async function call(fn: string, args: unknown[], label = 'Transaction') {
    if (!contractAddress || !walletOnRightChain) return
    try {
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: MILESTONE_ESCROW_ABI,
        functionName: fn,
        args,
        chainId: walletChain,
      })
      setTxHash(hash)
      toast.loading(`${label} submitted…`, {
        id: 'tx',
        description: (
          <a href={getTxUrl(walletChain, hash)} target="_blank" rel="noreferrer"
            className="underline flex items-center gap-1 text-xs">
            View on explorer <ExternalLink className="size-3 inline" />
          </a>
        ),
      })
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  async function handleApproveUsdc() {
    const ca = getContractAddress(chainId)
    if (!ca || !ms) return
    try {
      const hash = await writeContractAsync({
        address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
        args: [ca, ms.amount], chainId: walletChain,
      })
      setApproveHash(hash)
      toast.success('USDC approved')
      void refetchAllowance()
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  function copyShareLink() {
    void navigator.clipboard.writeText(buildShareLink(chainId, id))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-col gap-4">
        {[80, 200, 140].map((h, i) => <div key={i} className="skeleton rounded-[20px]" style={{ height: h }} />)}
      </div>
    </div>
  )

  // ── Bug: distinguish not-found from real error ─────────────────────────────
  if (loadError && !ms) return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="card p-10">
        <AlertTriangle className="mx-auto mb-4 size-10" style={{ color: 'var(--warning)' }} />
        <h2 className="font-extrabold text-lg mb-2" style={{ color: 'var(--ink)' }}>Failed to load</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>{loadError}</p>
        <button onClick={() => { void refetch() }}
          className="btn-primary mx-auto">Try again</button>
      </div>
    </div>
  )

  if (!ms) return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <div className="card p-10">
        <div className="flex size-14 items-center justify-center rounded-full mx-auto mb-4"
          style={{ background: 'var(--surface-muted)' }}>
          <Home className="size-7" style={{ color: 'var(--subtle)' }} />
        </div>
        <h2 className="font-extrabold text-lg mb-2" style={{ color: 'var(--ink)' }}>Milestone not found</h2>
        <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>
          Milestone #{id.toString()} does not exist on {getChainName(chainId)}.
          Check the link or try a different network.
        </p>
        <a href="#/" className="btn-primary mx-auto inline-flex">
          <ArrowLeft className="size-4" /> Back home
        </a>
      </div>
    </div>
  )

  // ── Role detection ────────────────────────────────────────────────────────
  const isLead   = !!address && address.toLowerCase() === ms.lead.toLowerCase()
  const isClient = !!address && address.toLowerCase() === ms.client.toLowerCase()
  const isPayee  = !!address && ms.payees.some((p) => p.toLowerCase() === address.toLowerCase())
  const hasPending = pendingAmt > 0n

  const needsFundApproval = ms && allowance !== undefined && allowance < ms.amount
  const splitRefundBps = BigInt(Math.round(parseFloat(splitPct) * 100))
  const hasPendingProposal = ms.pendingSplitProposer !== '0x0000000000000000000000000000000000000000'
  const canAcceptSplit = hasPendingProposal &&
    ((isClient && ms.pendingSplitProposer.toLowerCase() === ms.lead.toLowerCase()) ||
     (isLead   && ms.pendingSplitProposer.toLowerCase() === ms.client.toLowerCase()))
  const isProposer = hasPendingProposal && ms.pendingSplitProposer.toLowerCase() === address?.toLowerCase()
  const extensionTs = extensionDate ? BigInt(Math.floor(new Date(extensionDate).getTime() / 1000)) : 0n

  const concedeCrewUSDC   = `$${formatUsdc(ms.amount)} USDC`
  const concedeClientUSDC = `$${formatUsdc(ms.amount)} USDC`

  // What happens next line
  let nextLine = ''
  if (ms.uiStatus === UIStatus.InProgress && ms.relevantDeadline > 0n) {
    nextLine = `If the lead misses the deadline, anyone can refund to the client after ${new Date(Number(ms.relevantDeadline) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}.`
  } else if (ms.uiStatus === UIStatus.UnderReview && ms.relevantDeadline > 0n) {
    nextLine = `If the client does nothing by ${new Date(Number(ms.relevantDeadline) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, anyone can release payment to the crew.`
  } else if (ms.uiStatus === UIStatus.Disputed && ms.relevantDeadline > 0n) {
    nextLine = `If no agreement by ${new Date(Number(ms.relevantDeadline) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}, anyone can trigger a 50/50 split.`
  } else if (ms.state === MilestoneState.Settled) {
    nextLine = `Outcome: ${OUTCOME_LABELS[ms.outcome]}`
  }

  // Primary action determination
  const primaryAction = (() => {
    if (!isConnected || !walletOnRightChain) return null
    if (ms.state === MilestoneState.Created && isClient) return 'fund'
    if (ms.state === MilestoneState.InProgress && isLead) return 'submit'
    if (ms.state === MilestoneState.UnderReview && isClient) return 'approve'
    if (ms.uiStatus === UIStatus.RefundEligible || ms.uiStatus === UIStatus.AutoApproveEligible || ms.uiStatus === UIStatus.DisputeTimeoutEligible) return 'settle'
    return null
  })()

  // ── Action panel content ──────────────────────────────────────────────────
  // ms is asserted non-null — early returns above guarantee it
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const msNN = ms

  function ActionPanel({ compact = false }: { compact?: boolean }) {
    return (
      <div className={`flex flex-col gap-3 ${compact ? '' : ''}`}>
        {!isConnected && (
          <p className="rounded-2xl p-4 text-center text-sm"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}>
            Connect your wallet to take action.
          </p>
        )}

        {/* Deferred withdrawal */}
        {hasPending && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--success-bg)', border: '1px solid rgba(18,183,106,0.2)' }}>
            <p className="mb-3 text-sm font-bold" style={{ color: 'var(--success)' }}>
              ${formatUsdc(pendingAmt)} USDC ready to claim
            </p>
            <TxButton label="Withdraw" onClick={() => call('withdraw', [], 'Withdraw')}
              isPending={isPending} isConfirming={isConfirming} variant="cta" />
          </div>
        )}

        {/* Created — client: fund */}
        {isConnected && msNN.state === MilestoneState.Created && isClient && walletOnRightChain && (
          <div>
            <div className="callout-info mb-3 text-xs" style={{ color: 'var(--info)' }}>
              By funding you accept these terms. If you dispute and the window expires without agreement, the default is a 50/50 split.
            </div>
            {needsFundApproval ? (
              <TxButton label={`Allow $${formatUsdc(msNN.amount)} USDC`}
                onClick={handleApproveUsdc}
                isPending={isPending} isConfirming={approveConfirming} variant="ghost" />
            ) : (
              <TxButton label={`Fund $${formatUsdc(msNN.amount)} USDC`}
                onClick={() => call('fund', [id], 'Fund')}
                isPending={isPending} isConfirming={isConfirming} variant="cta" />
            )}
          </div>
        )}

        {/* Created — lead: cancel */}
        {isConnected && msNN.state === MilestoneState.Created && isLead && walletOnRightChain && (
          <TxButton label="Cancel milestone" onClick={() => call('cancel', [id], 'Cancel')}
            isPending={isPending} isConfirming={isConfirming} variant="ghost" />
        )}

        {/* InProgress — lead: submit + extension */}
        {isConnected && msNN.state === MilestoneState.InProgress && isLead && walletOnRightChain && (
          <>
            {!compact && (
              <TxButton label="Submit for review" onClick={() => call('submit', [id], 'Submit')}
                isPending={isPending} isConfirming={isConfirming} variant="cta" />
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Request deadline extension
              </label>
              <div className="flex gap-2 min-w-0">
                <input type="datetime-local" value={extensionDate}
                  onChange={(e) => setExtensionDate(e.target.value)}
                  className="flex-1 min-w-0 rounded-2xl border px-3 py-2 text-sm outline-none focus:border-[var(--info)] transition-default"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-muted)' }} />
                <button disabled={!extensionDate || isPending}
                  onClick={() => { void call('requestExtension', [id, extensionTs], 'Request extension') }}
                  className="shrink-0 rounded-full border px-3 py-2 text-xs font-bold disabled:opacity-40 transition-default hover:bg-[var(--surface-muted)]"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-2)' }}>
                  Request
                </button>
              </div>
            </div>
          </>
        )}

        {/* InProgress — client with pending extension */}
        {isConnected && msNN.state === MilestoneState.InProgress && isClient && msNN.pendingExtensionDeadline > 0n && walletOnRightChain && (
          <TxButton label={`Approve extension to ${formatTs(msNN.pendingExtensionDeadline)}`}
            onClick={() => call('approveExtension', [id, msNN.pendingExtensionDeadline], 'Approve extension')}
            isPending={isPending} isConfirming={isConfirming} variant="primary" />
        )}

        {/* UnderReview — client: approve / dispute */}
        {isConnected && msNN.state === MilestoneState.UnderReview && isClient && walletOnRightChain && (
          <>
            {!compact && (
              <TxButton label="Approve and pay crew"
                onClick={() => call('approve', [id], 'Approve')}
                isPending={isPending} isConfirming={isConfirming} variant="cta" />
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                Reason (required to dispute)
              </label>
              <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Describe the issue…" rows={2}
                className="mb-2 w-full rounded-2xl border px-3 py-2 text-sm outline-none resize-none focus:border-[var(--danger)] transition-default"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-muted)' }} />
              <TxButton label="Raise dispute" variant="danger"
                onClick={() => setConfirmDispute(true)}
                isPending={isPending} isConfirming={isConfirming}
                disabled={!disputeReason.trim()} />
            </div>
          </>
        )}

        {/* Disputed */}
        {isConnected && msNN.state === MilestoneState.Disputed && walletOnRightChain && (
          <>
            {(isClient || isLead) && (
              <TxButton
                label={isClient ? 'Concede — give crew 100%' : 'Concede — refund client 100%'}
                variant="ghost"
                onClick={() => setConfirmConcede(true)}
                isPending={isPending} isConfirming={isConfirming} />
            )}
            {(isClient || isLead) && (
              <div>
                <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Propose split — % refunded to client
                </label>
                <div className="flex items-center gap-3 mb-1">
                  <input type="range" min="0" max="100" step="1" value={splitPct}
                    onChange={(e) => setSplitPct(e.target.value)}
                    className="flex-1 accent-[var(--primary)]" />
                  <span className="mono w-12 text-right text-sm tabnum font-bold" style={{ color: 'var(--ink)' }}>
                    {splitPct}%
                  </span>
                </div>
                <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
                  Client: ${formatUsdc((msNN.amount * splitRefundBps) / 10000n)} ·{' '}
                  Crew: ${formatUsdc((msNN.amount * (10000n - splitRefundBps)) / 10000n)}
                </p>
                <TxButton label="Propose this split"
                  onClick={() => call('proposeSplit', [id, splitRefundBps], 'Propose split')}
                  isPending={isPending} isConfirming={isConfirming} variant="primary" />
              </div>
            )}
            {canAcceptSplit && !isProposer && (
              <div className="rounded-2xl p-4" style={{ background: 'var(--success-bg)', border: '1px solid rgba(18,183,106,0.2)' }}>
                <p className="mb-2 text-sm font-bold" style={{ color: 'var(--success)' }}>
                  Counterparty proposed: {bpsToPercent(msNN.pendingSplitRefundBps)} to client
                  {' '}(${formatUsdc((msNN.amount * msNN.pendingSplitRefundBps) / 10000n)})
                </p>
                <TxButton label="Accept this split"
                  onClick={() => call('acceptSplit', [id, msNN.pendingSplitRefundBps], 'Accept split')}
                  isPending={isPending} isConfirming={isConfirming} variant="cta" />
              </div>
            )}
          </>
        )}

        {/* Permissionless settle */}
        {isConnected && walletOnRightChain && (
          msNN.uiStatus === UIStatus.RefundEligible ||
          msNN.uiStatus === UIStatus.AutoApproveEligible ||
          msNN.uiStatus === UIStatus.DisputeTimeoutEligible
        ) && (
          <TxButton label="Settle now" onClick={() => call('settle', [id], 'Settle')}
            isPending={isPending} isConfirming={isConfirming} variant="cta" />
        )}

        {/* Visitor / observer */}
        {isConnected && !isLead && !isClient && !isPayee && !hasPending &&
          msNN.state !== MilestoneState.Settled && msNN.state !== MilestoneState.Cancelled &&
          msNN.uiStatus !== UIStatus.RefundEligible &&
          msNN.uiStatus !== UIStatus.AutoApproveEligible &&
          msNN.uiStatus !== UIStatus.DisputeTimeoutEligible && (
          <p className="text-center text-sm" style={{ color: 'var(--subtle)' }}>
            Connect as lead or client to act.
          </p>
        )}
        {(msNN.state === MilestoneState.Settled || msNN.state === MilestoneState.Cancelled) && !hasPending && (
          <p className="text-center text-sm" style={{ color: 'var(--subtle)' }}>
            This milestone is closed.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmDispute}
        title="Raise a dispute"
        description={
          <span>
            This pauses the review clock. You and the lead will negotiate a split.
            If no agreement within <strong>{formatDuration(Number(ms.disputeWindow))}</strong>,
            anyone can trigger a 50/50 split automatically.
          </span>
        }
        confirmLabel="Raise dispute" confirmVariant="danger"
        onConfirm={() => { setConfirmDispute(false); void call('dispute', [id, disputeReason], 'Dispute') }}
        onCancel={() => setConfirmDispute(false)}
      />
      <ConfirmDialog
        open={confirmConcede}
        title={isClient ? 'Concede to the crew' : 'Concede to the client'}
        description={isClient
          ? <span>This pays <strong>{concedeCrewUSDC}</strong> to the crew in full. You receive nothing.</span>
          : <span>This refunds <strong>{concedeClientUSDC}</strong> to the client in full. The crew receives nothing.</span>
        }
        confirmLabel="Confirm concede" confirmVariant="danger"
        onConfirm={() => { setConfirmConcede(false); void call('concede', [id], 'Concede') }}
        onCancel={() => setConfirmConcede(false)}
      />

      {/* More actions sheet */}
      {showMoreSheet && (
        <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowMoreSheet(false) }}>
          <div className="sheet-panel">
            <div className="sheet-handle" />
            <p className="font-bold mb-4" style={{ color: 'var(--ink)' }}>All actions</p>
            <ActionPanel />
            <button onClick={() => setShowMoreSheet(false)}
              className="btn-secondary w-full mt-4">Close</button>
          </div>
        </div>
      )}

      {/* Nav bar */}
      <div className="mb-4 flex items-center justify-between min-w-0">
        <button onClick={() => { window.location.hash = '/' }}
          className="flex items-center gap-1.5 text-sm transition-default hover:opacity-70"
          style={{ color: 'var(--muted)' }}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={copyShareLink}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-default hover:bg-[var(--surface-muted)]"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-2)' }}>
            {copied ? <Check className="size-3.5" style={{ color: 'var(--success)' }} /> : <Copy className="size-3.5" />}
            {copied ? 'Copied!' : 'Share'}
          </button>
          <button onClick={() => { void refetch() }}
            className="rounded-full p-2 transition-default hover:bg-[var(--surface-muted)]">
            <RefreshCw className="size-4" style={{ color: 'var(--muted)' }} />
          </button>
        </div>
      </div>

      {/* Wrong network */}
      <WrongNetwork targetChainId={chainId} />

      {/* Step chips */}
      <StepChips
        state={ms.state}
        uiStatus={ms.uiStatus}
        relevantDeadline={ms.relevantDeadline}
        outcome={ms.outcome}
      />

      {/* Title card */}
      <div className="card p-5 mb-4">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>
              Milestone #{id.toString()} · {getChainName(chainId)}
            </p>
            <div className="mono text-3xl font-extrabold tabnum" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              ${formatUsdc(ms.amount)}
              <span className="ml-1 text-base font-normal" style={{ color: 'var(--muted)' }}>USDC</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <StatusBadge status={ms.uiStatus} />
            {ms.uiStatus !== UIStatus.Settled && ms.uiStatus !== UIStatus.Cancelled && ms.relevantDeadline > 0n && (
              <p className="mt-1 text-xs tabnum" style={{ color: 'var(--subtle)' }}>
                {countdown(ms.relevantDeadline)}
              </p>
            )}
          </div>
        </div>

        {/* What happens next callout */}
        {nextLine && (
          <div className="callout-info mt-4 text-xs" style={{ color: 'var(--info)' }}>
            <strong>What happens next: </strong>{nextLine}
          </div>
        )}

        {/* Pending banners */}
        {ms.pendingExtensionDeadline > 0n && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl p-3"
            style={{ background: 'var(--info-bg)', border: '1px solid rgba(47,107,255,0.2)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--info)' }} />
            <p className="text-sm" style={{ color: 'var(--ink)' }}>
              Extension requested to <strong>{formatTs(ms.pendingExtensionDeadline)}</strong>
            </p>
          </div>
        )}
        {hasPendingProposal && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl p-3"
            style={{ background: 'var(--warning-bg)', border: '1px solid rgba(247,144,9,0.25)' }}>
            <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--warning)' }} />
            <p className="text-sm" style={{ color: 'var(--ink)' }}>
              Split proposed by {shortAddr(ms.pendingSplitProposer)}
              {' '}— {bpsToPercent(ms.pendingSplitRefundBps)} to client
              {' '}(${formatUsdc((ms.amount * ms.pendingSplitRefundBps) / 10000n)})
              , {bpsToPercent(10000n - ms.pendingSplitRefundBps)} to crew
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 rounded-2xl p-1" style={{ background: 'var(--surface-muted)' }}>
        {(['overview', 'crew', 'activity'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="flex-1 rounded-xl py-2 text-xs font-bold capitalize transition-default"
            style={{
              background: tab === t ? 'var(--surface)' : 'transparent',
              color: tab === t ? 'var(--ink)' : 'var(--muted)',
              boxShadow: tab === t ? '0 1px 2px rgba(16,24,40,.06)' : 'none',
            }}>
            {t === 'crew' ? 'Crew split' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Lead',     value: <AddrCell addr={ms.lead}   chainId={chainId} isYou={isLead} /> },
              { label: 'Client',   value: <AddrCell addr={ms.client} chainId={chainId} isYou={isClient} /> },
              { label: 'Delivery', value: <span className="mono tabnum text-sm">{formatDuration(Number(ms.deliveryWindow))}</span> },
              { label: 'Grace',    value: <span className="mono tabnum text-sm">{ms.gracePeriod > 0n ? formatDuration(Number(ms.gracePeriod)) : 'None'}</span> },
              { label: 'Review',   value: <span className="mono tabnum text-sm">{formatDuration(Number(ms.reviewWindow))}</span> },
              { label: 'Dispute',  value: <span className="mono tabnum text-sm">{formatDuration(Number(ms.disputeWindow))}</span> },
              ...(ms.deadline > 0n ? [{ label: 'Deadline', value: <span className="mono text-sm">{formatTs(ms.deadline)}</span> }] : []),
              ...(ms.submittedAt > 0n ? [{ label: 'Submitted', value: <span className="mono text-sm">{formatTs(ms.submittedAt)}</span> }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="field-tile">
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
                <div style={{ color: 'var(--ink)' }}>{value}</div>
              </div>
            ))}
            {/* Contract ID */}
            <div className="field-tile col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>Contract</p>
              <div className="flex items-center gap-2">
                <span className="mono text-xs truncate" style={{ color: 'var(--ink-2)' }}>
                  {shortAddr(getContractAddress(chainId) ?? '0x0')}
                </span>
                <a href={getAddressUrl(chainId, getContractAddress(chainId) ?? '')} target="_blank" rel="noreferrer"
                  className="shrink-0 transition-default hover:opacity-70">
                  <ExternalLink className="size-3.5" style={{ color: 'var(--info)' }} />
                </a>
              </div>
            </div>
          </div>
          {/* Settled outcome */}
          {ms.state === MilestoneState.Settled && (
            <div className="mt-3 rounded-2xl p-3"
              style={{ background: 'var(--success-bg)', border: '1px solid rgba(18,183,106,0.2)' }}>
              <p className="text-xs font-bold" style={{ color: 'var(--success)' }}>
                Settled · {OUTCOME_LABELS[ms.outcome]}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Crew split */}
      {tab === 'crew' && (
        <div className="card p-5 mb-4">
          <MoneyBar payees={ms.payees} bps={ms.bps} amount={ms.amount} walletAddr={address} />
        </div>
      )}

      {/* Tab: Activity (timeline) */}
      {tab === 'activity' && (
        <div className="card p-5 mb-4">
          <div className="flex flex-col gap-4">
            {/* Always-present events based on state */}
            {[
              ms.state >= MilestoneState.InProgress ? {
                label: 'Funded',
                ts: ms.deadline > 0n ? ms.deadline - ms.deliveryWindow : 0n,
                color: 'var(--success)',
              } : null,
              ms.submittedAt > 0n ? {
                label: 'Submitted for review',
                ts: ms.submittedAt,
                color: 'var(--info)',
              } : null,
              ms.disputedAt > 0n ? {
                label: 'Disputed',
                ts: ms.disputedAt,
                color: 'var(--danger)',
              } : null,
              ms.state === MilestoneState.Settled ? {
                label: `Settled — ${OUTCOME_LABELS[ms.outcome]}`,
                ts: 0n,
                color: 'var(--success)',
              } : null,
              ms.state === MilestoneState.Cancelled ? {
                label: 'Cancelled',
                ts: 0n,
                color: 'var(--subtle)',
              } : null,
            ].filter(Boolean).map((ev, i) => ev && (
              <div key={i} className="flex items-start gap-3">
                <div className="size-2 mt-1.5 rounded-full shrink-0" style={{ background: ev.color }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{ev.label}</p>
                  {ev.ts > 0n && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{formatTs(ev.ts)}</p>
                  )}
                </div>
              </div>
            ))}
            {ms.state === MilestoneState.Created && (
              <p className="text-sm" style={{ color: 'var(--subtle)' }}>Awaiting funding…</p>
            )}
          </div>
        </div>
      )}

      {/* Desktop inline action panel */}
      <div className="hidden sm:block card p-5 mb-4">
        <p className="mb-4 text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>Actions</p>
        <ActionPanel />
      </div>

      {/* Mobile sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 sm:hidden"
        style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(16px)', borderTop: '1px solid var(--border)', padding: '12px 16px 20px' }}>
        <div className="flex gap-2">
          {primaryAction === 'fund' && (
            needsFundApproval
              ? <TxButton label={`Allow $${formatUsdc(ms.amount)}`} onClick={handleApproveUsdc}
                  isPending={isPending} isConfirming={approveConfirming} variant="ghost" />
              : <TxButton label={`Fund $${formatUsdc(ms.amount)} USDC`}
                  onClick={() => call('fund', [id], 'Fund')}
                  isPending={isPending} isConfirming={isConfirming} variant="cta" />
          )}
          {primaryAction === 'submit' && (
            <TxButton label="Submit for review" onClick={() => call('submit', [id], 'Submit')}
              isPending={isPending} isConfirming={isConfirming} variant="cta" />
          )}
          {primaryAction === 'approve' && (
            <TxButton label="Approve and pay crew" onClick={() => call('approve', [id], 'Approve')}
              isPending={isPending} isConfirming={isConfirming} variant="cta" />
          )}
          {primaryAction === 'settle' && (
            <TxButton label="Settle now" onClick={() => call('settle', [id], 'Settle')}
              isPending={isPending} isConfirming={isConfirming} variant="cta" />
          )}
          {!primaryAction && !hasPending && isConnected && (
            <div className="flex-1 rounded-full py-3 text-sm font-bold text-center"
              style={{ background: 'var(--surface-muted)', color: 'var(--subtle)' }}>
              No action needed
            </div>
          )}
          {hasPending && (
            <TxButton label={`Withdraw $${formatUsdc(pendingAmt)}`}
              onClick={() => call('withdraw', [], 'Withdraw')}
              isPending={isPending} isConfirming={isConfirming} variant="cta" />
          )}
          <button onClick={() => setShowMoreSheet(true)}
            className="shrink-0 rounded-full border p-3 transition-default hover:bg-[var(--surface-muted)]"
            style={{ borderColor: 'var(--border-strong)' }}>
            <MoreHorizontal className="size-4" style={{ color: 'var(--ink-2)' }} />
          </button>
        </div>
      </div>
    </div>
  )
}
