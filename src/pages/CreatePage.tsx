import { useState, useMemo, useEffect, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { Plus, Trash2, ArrowLeft, ExternalLink, Copy, Check, AlertCircle, ChevronRight, Clock, Users, FileText } from 'lucide-react'
import { toast } from 'sonner'
import {
  MILESTONE_ESCROW_ABI, getContractAddress, USDC_ADDRESS, getTxUrl,
  buildShareLink, DEFAULT_CHAIN_ID,
} from '../lib/contract'
import { parseUsdc, percentToBps, parseOnchainError, formatUsdc, formatDuration } from '../lib/format'
import { TxButton } from '../components/TxButton'
import { WrongNetwork } from '../components/WrongNetwork'
import { Avatar } from '../components/Avatar'

// ── Window helpers ────────────────────────────────────────────────────────────

type TimeUnit = 'minutes' | 'hours' | 'days'
interface WindowInput { value: string; unit: TimeUnit }

function toSeconds(w: WindowInput): number {
  const v = Number(w.value)
  if (isNaN(v) || v < 0) return 0
  if (w.unit === 'minutes') return Math.round(v * 60)
  if (w.unit === 'hours')   return Math.round(v * 3600)
  return Math.round(v * 86400)
}

const MAX_DELIVERY_S = 365 * 86400
const MAX_OTHER_S    = 90  * 86400

function validateWindow(w: WindowInput, allowZero: boolean, maxS: number): string | null {
  const s = toSeconds(w)
  if (!allowZero && s <= 0) return 'Must be > 0'
  if (s > maxS) return `Max ${maxS / 86400}d`
  return null
}

// ── Presets ───────────────────────────────────────────────────────────────────

type Preset = { label: string; icon: string; delivery: WindowInput; grace: WindowInput; review: WindowInput; dispute: WindowInput }

const PRESETS: Preset[] = [
  {
    label: 'Demo · 2 min', icon: '⚡',
    delivery: { value: '2', unit: 'minutes' }, grace:  { value: '2', unit: 'minutes' },
    review:   { value: '2', unit: 'minutes' }, dispute: { value: '2', unit: 'minutes' },
  },
  {
    label: 'Sprint · 1 week', icon: '🏃',
    delivery: { value: '7',  unit: 'days' }, grace:  { value: '2', unit: 'days' },
    review:   { value: '3',  unit: 'days' }, dispute: { value: '7', unit: 'days' },
  },
  {
    label: 'Project · 1 month', icon: '📁',
    delivery: { value: '30', unit: 'days' }, grace:  { value: '3', unit: 'days' },
    review:   { value: '7',  unit: 'days' }, dispute: { value: '14', unit: 'days' },
  },
  {
    label: 'Custom', icon: '✏️',
    delivery: { value: '14', unit: 'days' }, grace:  { value: '3', unit: 'days' },
    review:   { value: '7',  unit: 'days' }, dispute: { value: '7', unit: 'days' },
  },
]

// ── Step chip ────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Client & amount', 'Crew split', 'Timeline', 'Review & create']
const STEP_ICONS  = [Users, Users, Clock, FileText]

function StepChips({ step }: { step: number }) {
  return (
    <div className="step-chips mb-6">
      {STEP_LABELS.map((label, i) => {
        const Icon = STEP_ICONS[i]
        const done    = i < step
        const current = i === step
        return (
          <div key={label}
            className={`step-chip ${done ? 'done' : current ? 'current' : ''}`}>
            <span className="step-chip-icon">
              {done ? <Check className="size-3" /> : <Icon className="size-3" />}
            </span>
            <span className="text-xs">{i + 1}/{STEP_LABELS.length} · {label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Window field (for step 3) ─────────────────────────────────────────────────

function WindowField({ label, value, onChange, allowZero = false, maxS }:
  { label: string; value: WindowInput; onChange: (w: WindowInput) => void; allowZero?: boolean; maxS: number }) {
  const err = validateWindow(value, allowZero, maxS)
  return (
    <div className="field-tile">
      <label className="block text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      <div className={`flex rounded-xl overflow-hidden border ${err ? 'border-[var(--danger)]' : 'border-[var(--border-strong)]'}`}>
        <input type="number" min="0" step="1"
          value={value.value}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
          className="w-0 flex-1 bg-transparent px-3 py-2 text-sm tabnum outline-none"
          style={{ color: 'var(--ink)', fontFamily: 'IBM Plex Mono, monospace' }} />
        <select value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as TimeUnit })}
          className="shrink-0 border-l bg-transparent px-2 py-2 text-xs outline-none"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--muted)' }}>
          <option value="minutes">min</option>
          <option value="hours">hr</option>
          <option value="days">day</option>
        </select>
      </div>
      {err && <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>{err}</p>}
    </div>
  )
}

// ── Payee row (step 2) ────────────────────────────────────────────────────────

interface PayeeRow { address: string; percent: string; role: string }

// ── Live preview card ────────────────────────────────────────────────────────

function PreviewCard({ client, amount, payees, delivery, review, dispute, chainId }: {
  client: string; amount: string; payees: PayeeRow[]
  delivery: WindowInput; grace?: WindowInput; review: WindowInput; dispute: WindowInput
  chainId: number
}) {
  let amountBig: bigint | null = null
  try { amountBig = parseUsdc(amount) } catch { /* ignore */ }

  const hasTimes = !!amountBig

  return (
    <div className="card p-5 text-sm" style={{ borderLeft: '3px solid var(--info)' }}>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--muted)' }}>
        Client preview
      </p>

      <div className="mb-4 text-3xl font-extrabold tabnum mono" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
        {amountBig ? `$${formatUsdc(amountBig)}` : '—'}
        <span className="ml-1 text-sm font-normal" style={{ color: 'var(--muted)' }}>USDC</span>
      </div>

      {client && (
        <div className="mb-3 flex items-center gap-2">
          <Avatar address={client} size={24} />
          <span className="mono text-[11px] truncate" style={{ color: 'var(--muted)' }}>{client.slice(0, 16)}…</span>
        </div>
      )}

      {/* Payees */}
      {payees.filter((p) => p.address).length > 0 && (
        <div className="mb-3 flex flex-col gap-1">
          {payees.filter((p) => p.address).map((p, i) => {
            const pct = parseFloat(p.percent) || 0
            const bps = BigInt(Math.round(pct * 100))
            const usdcAmt = amountBig ? (amountBig * bps) / 10000n : null
            return (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Avatar address={p.address} size={20} />
                  <span className="mono text-[11px] truncate" style={{ color: 'var(--muted)' }}>
                    {p.address.slice(0, 8)}…
                  </span>
                </div>
                <span className="shrink-0 mono text-xs font-bold tabnum" style={{ color: 'var(--ink)' }}>
                  {pct.toFixed(1)}% {usdcAmt ? `· $${formatUsdc(usdcAmt)}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Timeline */}
      {hasTimes && toSeconds(delivery) > 0 && (
        <div className="callout-info text-[11px] mb-3">
          <p><strong>Deliver within</strong> {formatDuration(toSeconds(delivery))}</p>
          {toSeconds(review) > 0 && <p><strong>Auto-release</strong> {formatDuration(toSeconds(review))} after delivery</p>}
          {toSeconds(dispute) > 0 && <p><strong>Dispute default 50/50</strong> after {formatDuration(toSeconds(dispute))} if no deal</p>}
        </div>
      )}

      {/* Dispute note */}
      <div className="rounded-2xl p-3 text-[11px]"
        style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}>
        If you dispute and no agreement is reached in {dispute.value || '?'} {dispute.unit}, the default is a 50/50 split.
      </div>

      <p className="mt-3 text-[10px] text-center" style={{ color: 'var(--subtle)' }}>
        Chain: {chainId === 5042 ? 'Arc Mainnet' : 'Arc Testnet'}
      </p>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function CreatePage() {
  const { address, chainId } = useAccount()
  const contractAddress = getContractAddress(chainId)
  const effectiveChain = chainId ?? DEFAULT_CHAIN_ID

  // Wizard state
  const [step, setStep] = useState(0)

  // Form state
  const [client, setClient] = useState('')
  const [amount, setAmount] = useState('')
  const [payees, setPayees] = useState<PayeeRow[]>([{ address: '', percent: '100', role: 'Crew' }])
  const [delivery, setDelivery] = useState<WindowInput>({ value: '14', unit: 'days' })
  const [grace,    setGrace]    = useState<WindowInput>({ value: '3',  unit: 'days' })
  const [review,   setReview]   = useState<WindowInput>({ value: '7',  unit: 'days' })
  const [dispute,  setDispute]  = useState<WindowInput>({ value: '7',  unit: 'days' })
  const [selectedPreset, setSelectedPreset] = useState(2) // 'Project'
  const [createdId, setCreatedId] = useState<bigint | null>(null)
  const [copied, setCopied] = useState(false)
  const [approveHash, setApproveHash] = useState<`0x${string}` | undefined>()

  // USDC allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [address ?? '0x0', contractAddress ?? '0x0'],
    chainId,
    query: { enabled: !!address && !!contractAddress && !!chainId },
  })

  const { writeContractAsync: approve, isPending: approving } = useWriteContract()
  const { isLoading: approvingConfirming } = useWaitForTransactionReceipt({ hash: approveHash })
  const { writeContractAsync: create, isPending: creating, data: createHash } = useWriteContract()
  const { isLoading: creating2, isSuccess: createSuccess } = useWaitForTransactionReceipt({ hash: createHash })

  // Derived
  const totalBps  = useMemo(() => payees.reduce((s, p) => s + Number(percentToBps(p.percent)), 0), [payees])
  const bpsValid  = totalBps === 10000
  const amountBig = useMemo(() => { try { return parseUsdc(amount) } catch { return null } }, [amount])
  const needsApproval = !!(amountBig && allowance !== undefined && allowance < amountBig)

  const deliveryErr = validateWindow(delivery, false, MAX_DELIVERY_S)
  const graceErr    = validateWindow(grace,    true,  MAX_OTHER_S)
  const reviewErr   = validateWindow(review,   false, MAX_OTHER_S)
  const disputeErr  = validateWindow(dispute,  false, MAX_OTHER_S)
  const windowsOk   = !deliveryErr && !graceErr && !reviewErr && !disputeErr

  function applyPreset(idx: number) {
    setSelectedPreset(idx)
    const p = PRESETS[idx]
    setDelivery(p.delivery); setGrace(p.grace); setReview(p.review); setDispute(p.dispute)
  }

  const addPayee     = useCallback(() => { if (payees.length < 20) setPayees([...payees, { address: '', percent: '0', role: 'Crew' }]) }, [payees])
  const addTreasury  = useCallback(() => { if (address && payees.length < 20) setPayees([...payees, { address, percent: '0', role: 'Treasury' }]) }, [payees, address])
  const removePayee  = useCallback((i: number) => { if (payees.length > 1) setPayees(payees.filter((_, idx) => idx !== i)) }, [payees])
  const updatePayee  = useCallback((i: number, field: keyof PayeeRow, val: string) => {
    const next = [...payees]; next[i] = { ...next[i], [field]: val }; setPayees(next)
  }, [payees])

  async function handleApprove() {
    if (!contractAddress || !amountBig) return
    try {
      const hash = await approve({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
        args: [contractAddress, amountBig], chainId })
      setApproveHash(hash)
      toast.success('USDC approved')
      void refetchAllowance()
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  async function handleCreate() {
    if (!contractAddress || !amountBig || !client || !bpsValid || !chainId || !windowsOk) return
    try {
      const hash = await create({
        address: contractAddress,
        abi: MILESTONE_ESCROW_ABI,
        functionName: 'create',
        args: [
          client.trim() as `0x${string}`,
          amountBig,
          BigInt(toSeconds(delivery)),
          BigInt(toSeconds(grace)),
          BigInt(toSeconds(review)),
          BigInt(toSeconds(dispute)),
          payees.map((p) => p.address.trim() as `0x${string}`),
          payees.map((p) => percentToBps(p.percent)),
        ],
        chainId,
      })
      toast.success('Milestone created!', {
        description: (
          <a href={getTxUrl(chainId, hash)} target="_blank" rel="noreferrer"
            className="underline flex items-center gap-1">
            View tx <ExternalLink className="size-3 inline" />
          </a>
        ),
      })
    } catch (e) { toast.error(parseOnchainError(e)) }
  }

  // Extract milestone ID from receipt
  const { data: receipt } = useWaitForTransactionReceipt({ hash: createHash })
  useEffect(() => {
    if (!receipt || createdId !== null) return
    for (const log of receipt.logs) {
      if (log.topics.length >= 2) {
        try {
          const id = BigInt(log.topics[1] as string)
          // eslint-disable-next-line react/set-state-in-effect
          setCreatedId(id)
          break
        } catch { /* skip */ }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt])

  function copyLink() {
    if (createdId === null) return
    const url = buildShareLink(effectiveChain, createdId)
    void navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Step validation
  const step0Valid = !!client.match(/^0x[0-9a-fA-F]{40}$/) && !!amountBig && amountBig > 0n
  const step1Valid = bpsValid && payees.every((p) => p.address.match(/^0x[0-9a-fA-F]{40}$/))
  const step2Valid = windowsOk
  const step3CanCreate = step0Valid && step1Valid && step2Valid && !!contractAddress

  // ── Success ───────────────────────────────────────────────────────────────
  if (createSuccess && createdId !== null) {
    const shareLink = buildShareLink(effectiveChain, createdId)
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="card p-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex size-14 items-center justify-center rounded-full"
              style={{ background: 'var(--success-bg)' }}>
              <Check className="size-7" style={{ color: 'var(--success)' }} />
            </div>
          </div>
          <h2 className="text-xl font-extrabold mb-2" style={{ color: 'var(--ink)' }}>
            Milestone #{createdId.toString()} created
          </h2>
          <p className="text-sm mb-5" style={{ color: 'var(--muted)' }}>Share this link with your client.</p>
          <div className="rounded-2xl flex items-center gap-2 p-3 mb-5"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <span className="mono flex-1 truncate text-xs min-w-0" style={{ color: 'var(--ink-2)' }}>{shareLink}</span>
            <button onClick={copyLink}
              className="shrink-0 rounded-full p-2 transition-default hover:bg-[var(--border)]">
              {copied
                ? <Check className="size-4" style={{ color: 'var(--success)' }} />
                : <Copy className="size-4" style={{ color: 'var(--muted)' }} />}
            </button>
          </div>
          <div className="flex gap-3">
            <a href={`#/m/${effectiveChain}/${createdId}`}
              className="flex-1 btn-primary text-center">
              View milestone
            </a>
            <button onClick={() => { window.location.hash = '/' }}
              className="flex-1 btn-secondary">
              Back home
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Wizard ────────────────────────────────────────────────────────────────

  const inputCls = 'w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-[var(--info)] transition-default'
  const inputStyle = { borderColor: 'var(--border-strong)', color: 'var(--ink)', background: 'var(--surface-muted)' }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <button onClick={() => step > 0 ? setStep(step - 1) : (window.location.hash = '/')}
        className="mb-6 flex items-center gap-1.5 text-sm transition-default hover:opacity-70"
        style={{ color: 'var(--muted)' }}>
        <ArrowLeft className="size-4" /> {step > 0 ? 'Back' : 'Home'}
      </button>

      <StepChips step={step} />

      <WrongNetwork />

      <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
        {/* ── Left: form panels ── */}
        <div>

          {/* Step 0: Client & amount */}
          {step === 0 && (
            <div className="card p-6 flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-extrabold mb-1" style={{ color: 'var(--ink)' }}>Client & amount</h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>Who is paying, and for how much?</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
                  Client wallet address
                </label>
                <input value={client} onChange={(e) => setClient(e.target.value)}
                  placeholder="0x…"
                  className={`mono ${inputCls}`} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
                  Escrow amount
                </label>
                <div className="flex items-center gap-2 rounded-2xl border px-4 py-3 transition-default focus-within:border-[var(--info)]"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-muted)' }}>
                  <input inputMode="decimal" value={amount}
                    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g,''); if (!v || /^\d*\.?\d*$/.test(v)) setAmount(v) }}
                    placeholder="0.00"
                    className="flex-1 text-3xl font-extrabold tabnum outline-none bg-transparent"
                    style={{ color: 'var(--ink)', fontFamily: 'IBM Plex Mono, monospace' }} />
                  <span className="text-sm font-bold shrink-0" style={{ color: 'var(--muted)' }}>USDC</span>
                </div>
              </div>
              <button
                disabled={!step0Valid}
                onClick={() => setStep(1)}
                className="btn-primary w-full disabled:opacity-40">
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {/* Step 1: Crew split */}
          {step === 1 && (
            <div className="card p-6 flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-extrabold mb-1" style={{ color: 'var(--ink)' }}>Crew split</h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Add everyone who gets paid. Percentages must total exactly 100%.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {payees.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <Avatar address={p.address || '0x0000'} size={32} className="shrink-0" />
                    <input value={p.address} onChange={(e) => updatePayee(i, 'address', e.target.value)}
                      placeholder="0x… wallet address"
                      className={`mono flex-1 min-w-0 ${inputCls}`} style={inputStyle} />
                    <div className="shrink-0 flex items-center gap-0.5 rounded-2xl border"
                      style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-muted)' }}>
                      <input type="number" min="0" max="100" step="0.01" value={p.percent}
                        onChange={(e) => updatePayee(i, 'percent', e.target.value)}
                        className="w-14 px-2 py-2.5 text-sm tabnum text-right outline-none bg-transparent"
                        style={{ color: 'var(--ink)', fontFamily: 'IBM Plex Mono, monospace' }} />
                      <span className="pr-2 text-xs" style={{ color: 'var(--subtle)' }}>%</span>
                    </div>
                    {payees.length > 1 && (
                      <button onClick={() => removePayee(i)}
                        className="shrink-0 rounded-full p-1.5 transition-default hover:bg-[var(--danger-bg)]">
                        <Trash2 className="size-4" style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Live total bar */}
              <div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
                  <div className="h-full rounded-full transition-default"
                    style={{
                      width: `${Math.min(totalBps / 100, 100)}%`,
                      background: bpsValid ? 'var(--success)' : totalBps > 10000 ? 'var(--danger)' : 'var(--info)',
                    }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--muted)' }}>Total</span>
                  <span className="mono font-bold tabnum"
                    style={{ color: bpsValid ? 'var(--success)' : 'var(--danger)' }}>
                    {(totalBps / 100).toFixed(2)}%
                    {bpsValid ? ' ✓' : ' — must equal 100%'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={addPayee} disabled={payees.length >= 20}
                  className="btn-secondary flex-1 disabled:opacity-40">
                  <Plus className="size-4" /> Add payee
                </button>
                {address && (
                  <button onClick={addTreasury}
                    className="btn-secondary flex-1">
                    + My cut
                  </button>
                )}
              </div>

              <button disabled={!step1Valid} onClick={() => setStep(2)}
                className="btn-primary w-full disabled:opacity-40">
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {/* Step 2: Timeline */}
          {step === 2 && (
            <div className="card p-6 flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-extrabold mb-1" style={{ color: 'var(--ink)' }}>Timeline</h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>How long does each phase last?</p>
              </div>

              {/* Preset grid */}
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => applyPreset(i)}
                    className="rounded-2xl border p-3 text-left transition-default"
                    style={{
                      borderColor: selectedPreset === i ? 'var(--accent)' : 'var(--border)',
                      background: selectedPreset === i ? 'rgba(255,138,0,0.06)' : 'var(--surface-muted)',
                    }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold" style={{ color: 'var(--ink)' }}>{p.icon} {p.label}</span>
                      {selectedPreset === i && <Check className="size-4" style={{ color: 'var(--accent)' }} />}
                    </div>
                    <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      {p.delivery.value}{p.delivery.unit[0]} deliver · {p.review.value}{p.review.unit[0]} review
                    </p>
                  </button>
                ))}
              </div>

              {/* Window fields */}
              <div className="grid grid-cols-2 gap-3">
                <WindowField label="Delivery window" value={delivery} onChange={(w) => { setDelivery(w); setSelectedPreset(3) }} maxS={MAX_DELIVERY_S} />
                <WindowField label="Grace period"    value={grace}    onChange={(w) => { setGrace(w);    setSelectedPreset(3) }} allowZero maxS={MAX_OTHER_S} />
                <WindowField label="Review window"   value={review}   onChange={(w) => { setReview(w);   setSelectedPreset(3) }} maxS={MAX_OTHER_S} />
                <WindowField label="Dispute window"  value={dispute}  onChange={(w) => { setDispute(w);  setSelectedPreset(3) }} maxS={MAX_OTHER_S} />
              </div>

              {/* Blue callout */}
              <div className="callout-info text-sm" style={{ color: 'var(--info)' }}>
                <p className="font-semibold mb-1">Milestone timeline</p>
                <p className="text-xs leading-relaxed">
                  Deliver within <strong>{delivery.value} {delivery.unit}</strong>
                  {toSeconds(grace) > 0 ? ` + ${grace.value} ${grace.unit} grace` : ''}.
                  Client reviews for <strong>{review.value} {review.unit}</strong> — if no action, anyone can auto-release.
                  If disputed, default 50/50 split after <strong>{dispute.value} {dispute.unit}</strong>.
                </p>
              </div>

              <button disabled={!step2Valid} onClick={() => setStep(3)}
                className="btn-primary w-full disabled:opacity-40">
                Continue <ChevronRight className="size-4" />
              </button>
            </div>
          )}

          {/* Step 3: Review */}
          {step === 3 && (
            <div className="card p-6 flex flex-col gap-5">
              <div>
                <h2 className="text-lg font-extrabold mb-1" style={{ color: 'var(--ink)' }}>Review & create</h2>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Double-check everything — you cannot edit a milestone after creation.
                </p>
              </div>

              {/* Summary tiles */}
              <div className="grid grid-cols-2 gap-3">
                <div className="field-tile col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>Amount</p>
                  <p className="mono text-2xl font-extrabold tabnum" style={{ color: 'var(--ink)' }}>
                    {amountBig ? `$${formatUsdc(amountBig)}` : '—'} <span className="text-sm font-normal" style={{ color: 'var(--muted)' }}>USDC</span>
                  </p>
                </div>
                <div className="field-tile col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>Client</p>
                  <p className="mono text-sm truncate" style={{ color: 'var(--ink)' }}>{client || '—'}</p>
                </div>
                {[
                  { label: 'Deliver', w: delivery }, { label: 'Grace', w: grace },
                  { label: 'Review',  w: review },   { label: 'Dispute', w: dispute },
                ].map(({ label, w }) => (
                  <div key={label} className="field-tile">
                    <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--muted)' }}>{label}</p>
                    <p className="mono text-sm tabnum font-bold" style={{ color: 'var(--ink)' }}>
                      {w.value} {w.unit}
                    </p>
                  </div>
                ))}
              </div>

              {/* Payee summary */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>Payees ({payees.length})</p>
                <div className="flex flex-col gap-1.5">
                  {payees.map((p, i) => {
                    const pct  = parseFloat(p.percent) || 0
                    const bps  = BigInt(Math.round(pct * 100))
                    const usdc = amountBig ? (amountBig * bps) / 10000n : null
                    return (
                      <div key={i} className="flex items-center gap-2 min-w-0">
                        <Avatar address={p.address || '0x0000'} size={28} />
                        <span className="mono text-xs truncate flex-1 min-w-0" style={{ color: 'var(--muted)' }}>
                          {p.address.slice(0, 16)}…
                        </span>
                        <span className="mono text-xs font-bold tabnum shrink-0" style={{ color: 'var(--ink)' }}>
                          {pct.toFixed(1)}%{usdc ? ` · $${formatUsdc(usdc)}` : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {!contractAddress && (
                <div className="flex items-center gap-2 rounded-2xl p-3"
                  style={{ background: 'var(--warning-bg)' }}>
                  <AlertCircle className="size-4 shrink-0" style={{ color: 'var(--warning)' }} />
                  <span className="text-sm" style={{ color: 'var(--warning)' }}>
                    Connect to Arc Testnet or Mainnet to create a milestone.
                  </span>
                </div>
              )}

              {needsApproval && (
                <TxButton
                  label={`Allow $${amount} USDC`}
                  onClick={handleApprove}
                  isPending={approving}
                  isConfirming={approvingConfirming}
                  variant="ghost"
                />
              )}

              <TxButton
                label="Create milestone"
                onClick={handleCreate}
                isPending={creating}
                isConfirming={creating2}
                variant="cta"
                disabled={!step3CanCreate || needsApproval}
              />
            </div>
          )}
        </div>

        {/* ── Right: live preview (sticky) ── */}
        <div className="lg:sticky lg:top-20">
          <PreviewCard
            client={client} amount={amount} payees={payees}
            delivery={delivery} review={review} dispute={dispute}
            chainId={effectiveChain}
          />
        </div>
      </div>
    </div>
  )
}
