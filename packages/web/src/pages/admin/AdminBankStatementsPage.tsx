import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, CircleSlash,
  RefreshCw, ShieldQuestion, ArrowLeft, Landmark, Inbox, ChevronRight,
} from 'lucide-react'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { adminApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'

/**
 * Bank statement reconciliation.
 *
 * This screen is deliberately built around one idea: the machine is fast and
 * literal, the human is slow and accountable, and the screen must never make it
 * look like the first one's work is finished.
 *
 * So a fresh upload lands on a preview that says in plain words what will and
 * will not happen, "Apply" only ever credits lines that already matched, and
 * anything left over sits in a queue where the only way forward is to pick a
 * verdict and type why. There is no bulk "approve all", because there is no
 * reading of that button which is safe.
 */

interface StatementRow {
  id: string
  lineNo: number
  rawReference: string
  rawAmount: string | null
  amount: number | null
  txnDate: string | null
  inbound: boolean
  matchStatus: string
  matchReason: string | null
  matchedType: string | null
  matchedId: string | null
  matchedUserId: string | null
  adminComment?: string | null
  decidedStatus?: string | null
  creditedAt?: string | null
}

/** One row of the history list, from GET /admin/bank-statements. */
interface StatementSummary {
  id: string
  fileName: string
  rowCount: number
  matchedCount: number
  creditedCount: number
  unmatchedCount: number
  skippedAmount: number
  status: string
  createdAt: string
  periodFrom: string | null
  periodTo: string | null
}

/** One statement opened for reading, from GET /admin/bank-statements/:id. */
interface StatementDetail extends StatementSummary {
  columnMap: unknown
  warnings: Array<{ kind: string; detail: string }>
  rows: StatementRow[]
}

/**
 * What POST /admin/bank-statements and POST /:id/rematch return.
 *
 * A deliberately separate type, because the two endpoints answer with different
 * shapes: the summary is keyed by `statementId` and carries no `creditedCount` or
 * `createdAt`, while the detail is keyed by `id`. Reading the upload response as
 * a `StatementDetail` type-checks and then sends an apply to
 * `/bank-statements/undefined/apply`, because `detail.id` is not merely missing
 * at runtime - it never existed. `upload` therefore takes the id off this and
 * re-reads the statement, so `detail` only ever holds one real shape.
 */
interface UploadSummary {
  statementId: string
  rowCount: number
  matchedCount: number
  unmatchedCount: number
}

interface QueueRow extends StatementRow {
  statementId: string
  fileName: string
}

type Tab = 'upload' | 'queue' | 'history'

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Every status the matcher can emit, and what an admin should read from it. */
const STATUS_META: Record<string, { label: string; tone: string; credit: boolean }> = {
  MATCHED: { label: 'Matched', tone: 'bg-emerald-900/40 text-emerald-300', credit: true },
  ALREADY_SETTLED: { label: 'Already paid', tone: 'bg-surface-800 text-surface-300', credit: false },
  UNMATCHED: { label: 'No claim', tone: 'bg-amber-900/40 text-amber-300', credit: false },
  AMOUNT_MISMATCH: { label: 'Amount differs', tone: 'bg-orange-900/40 text-orange-300', credit: false },
  DUPLICATE_IN_FILE: { label: 'Repeated UTR', tone: 'bg-orange-900/40 text-orange-300', credit: false },
  NO_REFERENCE: { label: 'No UTR', tone: 'bg-surface-800 text-surface-300', credit: false },
  UNPARSEABLE_AMOUNT: { label: 'Unreadable amount', tone: 'bg-surface-800 text-surface-300', credit: false },
  OUTBOUND: { label: 'Money out', tone: 'bg-surface-800 text-surface-300', credit: false },
  ZERO_AMOUNT: { label: 'Nothing to credit', tone: 'bg-surface-800 text-surface-300', credit: false },
}

const CARD = 'rounded-2xl border border-surface-700/60 bg-surface-900/40'

export function AdminBankStatementsPage() {
  const [tab, setTab] = useState<Tab>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [detail, setDetail] = useState<StatementDetail | null>(null)
  const [history, setHistory] = useState<StatementSummary[]>([])
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [applying, setApplying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await adminApi.getBankStatements({ limit: 50 } as never)
      const d = res.data?.data || res.data
      setHistory(Array.isArray(d?.items) ? d.items : [])
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load statements'))
    }
  }, [])

  const loadQueue = useCallback(async () => {
    try {
      const res = await adminApi.getUnresolvedStatementRows({ limit: 100 } as never)
      const d = res.data?.data || res.data
      setQueue(Array.isArray(d?.items) ? d.items : [])
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load the queue'))
    }
  }, [])

  useEffect(() => {
    loadHistory()
    loadQueue()
  }, [loadHistory, loadQueue])

  const upload = async () => {
    if (!file) {
      setError('Choose a statement file first.')
      return
    }
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const res = await adminApi.uploadStatement(file)
      const d = (res.data?.data || res.data) as UploadSummary
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setNotice(res.data?.message || 'Statement read. Nothing has been credited yet.')
      // Read it back rather than rendering the summary: `detail` then only ever
      // holds the shape StatementDetail actually describes.
      await openStatement(d.statementId)
      await Promise.all([loadHistory(), loadQueue()])
    } catch (e) {
      setError(getErrorMessage(e, 'Could not read that statement. Nothing was credited.'))
    } finally {
      setUploading(false)
    }
  }

  const apply = async (id: string) => {
    setApplying(true)
    setError('')
    try {
      const res = await adminApi.applyBankStatement(id)
      setNotice(res.data?.message || 'Applied.')
      await openStatement(id)
      await Promise.all([loadHistory(), loadQueue()])
    } catch (e) {
      setError(getErrorMessage(e, 'Could not apply this statement'))
    } finally {
      setApplying(false)
    }
  }

  const rematch = async (id: string) => {
    setError('')
    try {
      const res = await adminApi.rematchBankStatement(id)
      setNotice(res.data?.message || 'Re-checked.')
      await openStatement(id)
      await Promise.all([loadHistory(), loadQueue()])
    } catch (e) {
      setError(getErrorMessage(e, 'Could not re-check this statement'))
    }
  }

  const openStatement = async (id: string) => {
    setError('')
    try {
      const res = await adminApi.getBankStatement(id)
      setDetail((res.data?.data || res.data) as StatementDetail)
      setTab('upload')
    } catch (e) {
      setError(getErrorMessage(e, 'Could not open that statement'))
    }
  }

  const pendingCredit = detail?.rows.filter((r) => r.matchStatus === 'MATCHED' && !r.creditedAt) ?? []
  const creditTotal = pendingCredit.reduce((sum, r) => sum + (r.amount ?? 0), 0)

  return (
    <div className="bg-surface-50 dark:bg-surface-950 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <AdminPageHeader
          title="Bank reconciliation"
          subtitle="Upload the bank's statement. Lines that match a payment someone already submitted get credited; everything else waits for you, with a reason and a comment."
          tone="surface"
        />

        <div className="flex gap-1 rounded-2xl bg-surface-100 p-1 dark:bg-surface-800">
          {(
            [
              ['upload', 'Upload & preview', Upload],
              ['queue', `Needs a decision (${queue.length})`, ShieldQuestion],
              ['history', 'Statements', Landmark],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as Tab)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                tab === key
                  ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-surface-600 hover:text-surface-900 dark:text-surface-300 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && !error && (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {tab === 'upload' && (
          <>
            <div className={CARD + ' p-4 space-y-3'}>
              <div className="flex items-center gap-2 text-sm font-medium text-surface-800 dark:text-surface-100">
                <FileSpreadsheet className="h-4 w-4 text-primary-400" />
                Statement file
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt,.pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setError('')
                }}
                className="block w-full text-sm text-surface-600 file:mr-3 file:rounded-xl file:border-0 file:bg-primary-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-primary-500 dark:text-surface-300"
              />
              <p className="text-xs text-surface-500 dark:text-surface-400">
                CSV, Excel or PDF. The file is read and discarded - only the parsed lines are kept.
                A PDF is read by inferring the column layout, so nothing is ever credited from one
                automatically.
              </p>
              <button
                type="button"
                onClick={upload}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-500 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Read statement
              </button>
            </div>

            {detail && <StatementPreview detail={detail} onApply={() => apply(detail.id)} onRematch={() => rematch(detail.id)} applying={applying} pendingCount={pendingCredit.length} creditTotal={creditTotal} />}
          </>
        )}

        {tab === 'queue' && <Queue queue={queue} onDone={async () => { await Promise.all([loadQueue(), loadHistory()]) }} />}

        {tab === 'history' && (
          <div className={CARD + ' divide-y divide-surface-700/60'}>
            {history.length === 0 && (
              <p className="p-6 text-center text-sm text-surface-500">No statements uploaded yet.</p>
            )}
            {history.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openStatement(s.id)}
                className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-800/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-surface-900 dark:text-white">{s.fileName}</p>
                  <p className="mt-0.5 text-xs text-surface-500">
                    {new Date(s.createdAt).toLocaleString()} · {s.rowCount} lines · {s.matchedCount} matched ·{' '}
                    {s.creditedCount} credited
                    {s.unmatchedCount > 0 && ` · ${s.unmatchedCount} waiting`}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    s.status === 'APPLIED'
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : 'bg-surface-800 text-surface-300'
                  }`}
                >
                  {s.status}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-surface-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------

function StatementPreview({
  detail, onApply, onRematch, applying, pendingCount, creditTotal,
}: {
  detail: StatementDetail
  onApply: () => void
  onRematch: () => void
  applying: boolean
  pendingCount: number
  creditTotal: number
}) {
  const grouped = useMemo(() => {
    const matched = detail.rows.filter((r) => r.matchStatus === 'MATCHED')
    const rest = detail.rows.filter((r) => r.matchStatus !== 'MATCHED')
    return { matched, rest }
  }, [detail.rows])

  return (
    <div className="space-y-4">
      <div className={CARD + ' p-4'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-surface-900 dark:text-white">{detail.fileName}</p>
            <p className="mt-1 text-xs text-surface-500">
              {detail.rowCount} lines ·{' '}
              {(detail.periodFrom || detail.periodTo) && (
                <>
                  {detail.periodFrom ? new Date(detail.periodFrom).toLocaleDateString() : 'start'} →{' '}
                  {detail.periodTo ? new Date(detail.periodTo).toLocaleDateString() : 'latest'} ·{' '}
                </>
              )}
              {inr(detail.skippedAmount)} arrived that reconciliation did not act on
            </p>
          </div>
          <span className="rounded-full bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-300">
            {detail.status}
          </span>
        </div>

        {detail.warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {detail.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-medium">{w.kind}</span> - {w.detail}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={applying || detail.status === 'APPLIED' || pendingCount === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {detail.status === 'APPLIED'
              ? 'Already applied'
              : `Credit ${pendingCount} matched payment${pendingCount === 1 ? '' : 's'} (${inr(creditTotal)})`}
          </button>
          <button
            type="button"
            onClick={onRematch}
            disabled={detail.status === 'APPLIED'}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-surface-600 disabled:opacity-40"
          >
            <RefreshCw className="h-4 w-4" />
            Re-check
          </button>
        </div>
        {detail.status !== 'APPLIED' && (
          <p className="mt-2 text-xs text-surface-500">
            Re-check is worth trying after a user submits a reference that was late - it matches the
            stored lines again without needing the original file.
          </p>
        )}
      </div>

      <RowTable title="Will be credited" rows={grouped.matched} tone="emerald" />
      <RowTable title="Not credited - each one needs a reason from you" rows={grouped.rest} tone="amber" />
    </div>
  )
}

function RowTable({ title, rows, tone }: { title: string; rows: StatementRow[]; tone: 'emerald' | 'amber' }) {
  if (rows.length === 0) return null
  return (
    <div className={CARD + ' overflow-hidden'}>
      <p className={`border-b border-surface-700/60 px-4 py-2.5 text-sm font-medium ${tone === 'emerald' ? 'text-emerald-300' : 'text-amber-300'}`}>
        {title} ({rows.length})
      </p>
      {/* Scrolls rather than paginating: an admin scanning for one bad line is
          looking for an amount or a UTR, and a scrolled table keeps the line and
          its neighbours together. Both axes: the card clips overflow, so without
          an x-axis the columns past the right edge were unreachable on a phone. */}
      <div className="max-h-[28rem] overflow-y-auto overflow-x-auto">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-surface-700/40">
            {rows.map((r) => {
              const meta = STATUS_META[r.matchStatus] ?? { label: r.matchStatus, tone: 'bg-surface-800 text-surface-300', credit: false }
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 text-xs text-surface-500">#{r.lineNo}</td>
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-surface-100">{r.rawReference || '—'}</p>
                    {r.txnDate && (
                      <p className="mt-0.5 text-xs text-surface-500">{new Date(r.txnDate).toLocaleDateString()}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-surface-100">
                    {r.amount === null ? <span className="text-surface-500">unreadable</span> : inr(r.amount)}
                    {!r.inbound && <span className="ml-1 text-xs text-surface-500">(out)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.tone}`}>{meta.label}</span>
                    {r.matchReason && <p className="mt-1 max-w-sm text-xs text-surface-400">{r.matchReason}</p>}
                    {r.adminComment && (
                      <p className="mt-1 max-w-sm text-xs text-surface-300">
                        <span className="text-surface-500">Your note:</span> {r.adminComment}
                      </p>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------

function Queue({ queue, onDone }: { queue: QueueRow[]; onDone: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const total = queue.reduce((sum, r) => sum + (r.inbound && r.amount ? r.amount : 0), 0)

  return (
    <div className="space-y-4">
      <div className={CARD + ' p-4 text-sm text-surface-600 dark:text-surface-300'}>
        {queue.length === 0 ? (
          <span className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Nothing is waiting on you.
          </span>
        ) : (
          <>
            <p>
              {queue.length} line{queue.length === 1 ? '' : 's'} arrived that no payment has claimed,
              totalling <span className="font-medium text-surface-100">{inr(total)}</span>. Read each one
              against the statement and decide. The comment is required - it is the only record of why.
            </p>
            <p className="mt-2 text-xs text-surface-500">
              Common causes: the user mistyped the UTR, the payment landed outside the statement period,
              or it was someone else&rsquo;s transfer into the account.
            </p>
          </>
        )}
      </div>

      {queue.length > 0 && (
        <div className={CARD + ' divide-y divide-surface-700/60'}>
          {queue.map((row) =>
            openId === row.id ? (
              <DecisionForm key={row.id} row={row} onCancel={() => setOpenId(null)} onDone={async () => { setOpenId(null); await onDone() }} />
            ) : (
              <button
                key={row.id}
                type="button"
                onClick={() => setOpenId(row.id)}
                className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-800/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-surface-100">{row.rawReference || 'no reference'}</p>
                  <p className="mt-0.5 text-xs text-surface-500">
                    {row.fileName} · line {row.lineNo} ·{' '}
                    {row.amount === null ? 'unreadable amount' : inr(row.amount)} · {row.matchReason}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_META[row.matchStatus]?.tone ?? 'bg-surface-800 text-surface-300'}`}>
                  {STATUS_META[row.matchStatus]?.label ?? row.matchStatus}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-surface-500" />
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

function DecisionForm({ row, onCancel, onDone }: { row: QueueRow; onCancel: () => void; onDone: () => Promise<void> }) {
  const [comment, setComment] = useState('')
  const [claim, setClaim] = useState<{ kind: 'TOPUP' | 'UPI_PAYMENT'; id: string; label: string } | null>(
    row.matchedType && row.matchedId
      ? { kind: row.matchedType as 'TOPUP' | 'UPI_PAYMENT', id: row.matchedId, label: 'The payment the matcher found' }
      : null,
  )
  const [acceptDifference, setAcceptDifference] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (decision: 'CREDIT' | 'REJECT' | 'IGNORE') => {
    if (comment.trim().length < 5) {
      setError('Write what you checked - at least a few words.')
      return
    }
    if (decision === 'CREDIT' && !claim) {
      setError('Pick which payment this line paid before crediting it.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await adminApi.decideStatementRow(row.id, {
        decision,
        comment: comment.trim(),
        ...(decision === 'CREDIT' && claim ? { matchedType: claim.kind, matchedId: claim.id } : {}),
        ...(decision === 'CREDIT' && acceptDifference ? { amountMismatchAccepted: true } : {}),
      })
      await onDone()
    } catch (e) {
      setError(getErrorMessage(e, 'Could not record that decision'))
    } finally {
      setBusy(false)
    }
  }

  const candidateClaims = useMemo<Array<{ kind: 'TOPUP' | 'UPI_PAYMENT'; id: string; label: string }>>(() => {
    if (!row.matchedId || (row.matchedType !== 'TOPUP' && row.matchedType !== 'UPI_PAYMENT')) return []
    return [{ kind: row.matchedType, id: row.matchedId, label: 'The payment the matcher found' }]
  }, [row.matchedId, row.matchedType])

  return (
    <div className="space-y-4 p-4">
      <button type="button" onClick={onCancel} className="flex items-center gap-1.5 text-xs text-surface-400 hover:text-surface-200">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to the queue
      </button>

      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <dt className="text-xs text-surface-500">Reference</dt>
          <dd className="mt-0.5 font-mono text-xs text-surface-100">{row.rawReference || 'none'}</dd>
        </div>
        <div>
          <dt className="text-xs text-surface-500">Amount in file</dt>
          <dd className="mt-0.5 text-surface-100">{row.amount === null ? 'unreadable' : inr(row.amount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-surface-500">Statement</dt>
          <dd className="mt-0.5 truncate text-surface-100">{row.fileName}</dd>
        </div>
        <div>
          <dt className="text-xs text-surface-500">Why it stopped</dt>
          <dd className="mt-0.5 text-surface-100">{STATUS_META[row.matchStatus]?.label ?? row.matchStatus}</dd>
        </div>
      </dl>

      {row.matchReason && <p className="rounded-xl bg-surface-800/60 p-3 text-xs text-surface-300">{row.matchReason}</p>}

      <div>
        <label htmlFor={`decision-${row.id}`} className="mb-1.5 block text-sm font-medium text-surface-200">
          What did you check? <span className="text-red-400">Required</span>
        </label>
        <textarea
          id={`decision-${row.id}`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder="e.g. Matched UTR 4471 to the top-up Priya submitted on 12 Oct for the same amount."
          className="w-full rounded-xl border border-surface-700 bg-surface-950 p-3 text-sm text-surface-100 outline-none focus:border-primary-500"
        />
        <p className="mt-1 text-xs text-surface-500">
          Stored on the line permanently. A credit without a reason is indistinguishable from a mistake.
        </p>
      </div>

      {candidateClaims.length > 0 && (
        <div>
          <label htmlFor={`claim-${row.id}`} className="mb-1.5 block text-sm font-medium text-surface-200">
            Which payment did this line pay?
          </label>
          <select
            id={`claim-${row.id}`}
            value={claim?.id ?? ''}
            onChange={(e) => {
              const found = candidateClaims.find((c) => c.id === e.target.value)
              setClaim(found ?? null)
            }}
            className="w-full rounded-xl border border-surface-700 bg-surface-950 p-2.5 text-sm text-surface-100 outline-none focus:border-primary-500"
          >
            <option value="">Choose a payment…</option>
            {candidateClaims.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {row.matchStatus === 'AMOUNT_MISMATCH' && (
            <label className="mt-2 flex items-start gap-2 text-xs text-amber-300">
              <input type="checkbox" checked={acceptDifference} onChange={(e) => setAcceptDifference(e.target.checked)} className="mt-0.5" />
              The amounts differ and I have checked both - credit it anyway.
            </label>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => submit('CREDIT')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Credit this payment
        </button>
        <button
          type="button"
          onClick={() => submit('REJECT')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-surface-700 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-surface-600 disabled:opacity-50"
        >
          <CircleSlash className="h-4 w-4" /> Not ours - reject
        </button>
        <button
          type="button"
          onClick={() => submit('IGNORE')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-surface-700 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-surface-600 disabled:opacity-50"
        >
          <Inbox className="h-4 w-4" /> Ignore this line
        </button>
      </div>
      <p className="text-xs text-surface-500">
        Reject and Ignore record your note and clear the line from the queue. Only Credit moves money,
        and only if you have named the payment it paid.
      </p>
    </div>
  )
}