import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ShieldCheck,
  FileText,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
  PenLine,
  Type,
  ArrowRight,
} from 'lucide-react'
import { legalApi } from '../../lib/api'
import { SignaturePad } from '../../components/legal/SignaturePad'
import { PageHeader } from '../../components/PageHeader'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { getErrorMessage } from '../../lib/error'
import { useAuth } from '../../lib/auth'
import toast from 'react-hot-toast'

interface Doc {
  id: string
  kind: string
  version: number
  title: string
  summary: string | null
  contentHtml: string
}

interface Required {
  kind: string
  title: string
  version: number
  accepted: boolean
  acceptedAt: string | null
}

const GATE_TITLES: Record<string, string> = {
  SIGNUP: 'Create your account',
  PARTNER_ONBOARDING: 'Become a partner',
  BOOKING: 'Continue to booking',
  RE_CONSENT: 'Review updated terms',
}

const EXPLAIN: Record<string, string> = {
  SIGNUP: 'Please read and sign these to finish setting up your Nabri account.',
  PARTNER_ONBOARDING: 'Partners sign an additional agreement before taking jobs.',
  BOOKING: 'Accept the booking and refund terms to continue with this booking.',
  RE_CONSENT: 'These terms changed since you last accepted them, so please sign again.',
}

/**
 * Consent screen.
 *
 * The checkbox and the signature are the *record*; the gate is enforced by the
 * server from the database. So this page deliberately shows real failures
 * instead of optimistically proceeding: if the POST fails, the gate stays shut
 * and the reason is shown.
 */
export function LegalConsentPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const gate = (params.get('gate') || 'SIGNUP').toUpperCase()
  const next = params.get('next') || ''

  const [docs, setDocs] = useState<Doc[]>([])
  const [required, setRequired] = useState<Required[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [satisfied, setSatisfied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [openKind, setOpenKind] = useState<string | null>(null)
  const [method, setMethod] = useState<'TYPED_NAME' | 'DRAWN'>('TYPED_NAME')
  const [typedName, setTypedName] = useState(user?.fullName || '')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const docByKind = useMemo(() => {
    const map: Record<string, Doc> = {}
    for (const d of docs) map[d.kind] = d
    return map
  }, [docs])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const [docsRes, consentRes] = await Promise.all([
          legalApi.documents(),
          legalApi.consent(gate),
        ])
        if (!active) return
        const d = docsRes.data?.data || docsRes.data || {}
        const c = consentRes.data?.data || consentRes.data || {}
        setDocs(d.documents || [])
        setRequired(c.required || [])
        setMissing(c.missing || [])
        setSatisfied(Boolean(c.satisfied))
        // Open the first outstanding document so the action is obvious.
        if (Array.isArray(c.missing) && c.missing.length > 0) setOpenKind(c.missing[0])
      } catch (err) {
        if (active) setLoadError(getErrorMessage(err, 'Could not load the terms.'))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [gate])

  const signatureValue = method === 'DRAWN' ? drawn : typedName.trim()

  const canSign =
    !saving &&
    Boolean(openKind) &&
    (method === 'DRAWN' ? Boolean(drawn) : typedName.trim().length >= 2)

  const sign = async () => {
    if (!openKind || !signatureValue) return
    setSaving(true)
    try {
      const res = await legalApi.accept({
        kind: openKind,
        signatureType: method,
        signatureValue,
        consentType: gate,
      })
      const status = res.data?.data || res.data || {}
      setMissing(status.missing || [])
      setSatisfied(Boolean(status.satisfied))
      const remaining = status.missing || []
      if (remaining.length > 0) {
        setOpenKind(remaining[0])
        setDrawn(null)
        toast('Signed. One more document to go.')
      } else {
        toast.success('All terms signed.')
        if (next) navigate(next, { replace: true })
        else navigate('/agreements', { replace: true })
      }
    } catch (err) {
      // Surface the real failure rather than pretending it worked.
      toast.error(getErrorMessage(err, 'Could not record your signature.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <SkeletonLoader className="h-8 w-56" />
        <SkeletonLoader className="mt-4 h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title={GATE_TITLES[gate] || 'Terms & privacy'}
        subtitle={EXPLAIN[gate] || EXPLAIN.SIGNUP}
      />

      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {satisfied ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 size={20} />
            <p className="font-semibold">You have signed all required terms.</p>
          </div>
          <p className="mt-2 text-sm text-emerald-900/80 dark:text-emerald-200/80">
            A copy has been emailed to you. You can review every signed document any time.
          </p>
          <Link
            to="/agreements"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 underline dark:text-emerald-300"
          >
            View my signed documents <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <ul className="mb-4 space-y-2">
            {required.map((r) => {
              const doc = docByKind[r.kind]
              const isOpen = openKind === r.kind
              return (
                <li
                  key={r.kind}
                  className={`overflow-hidden rounded-2xl border ${
                    isOpen ? 'border-amber-300 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/20' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenKind(isOpen ? null : r.kind)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    {r.accepted ? (
                      <CheckCircle2 size={20} className="shrink-0 text-emerald-600" />
                    ) : (
                      <Circle size={20} className="shrink-0 text-stone-400" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-stone-900 dark:text-stone-100">
                        {r.title}
                      </span>
                      <span className="text-xs text-stone-500 dark:text-stone-400">
                        v{r.version}
                        {r.accepted && r.acceptedAt
                          ? ` · signed ${new Date(r.acceptedAt).toLocaleDateString('en-IN')}`
                          : ' · not signed'}
                      </span>
                    </span>
                    <FileText size={18} className="shrink-0 text-stone-400" />
                  </button>

                  {isOpen && (
                    <div className="border-t border-stone-200 p-4 dark:border-stone-700">
                      <div
                        className="legal-body max-h-96 overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed dark:border-stone-700 dark:bg-stone-800/60"
                        dangerouslySetInnerHTML={{ __html: doc?.contentHtml || '<p>Loading…</p>' }}
                      />

                      <div className="mt-4 rounded-xl border border-stone-200 p-3 dark:border-stone-700">
                        <p className="mb-2 text-sm font-semibold text-stone-800 dark:text-stone-200">
                          Sign to accept
                        </p>
                        <div className="mb-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setMethod('TYPED_NAME')}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              method === 'TYPED_NAME'
                                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200'
                            }`}
                          >
                            <Type size={13} /> Type name
                          </button>
                          <button
                            type="button"
                            onClick={() => setMethod('DRAWN')}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                              method === 'DRAWN'
                                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                                : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200'
                            }`}
                          >
                            <PenLine size={13} /> Draw
                          </button>
                        </div>

                        {method === 'TYPED_NAME' ? (
                          <input
                            value={typedName}
                            onChange={(e) => setTypedName(e.target.value)}
                            placeholder="Type your full name"
                            aria-label="Full name"
                            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-800"
                          />
                        ) : (
                          <SignaturePad onChange={setDrawn} disabled={saving} />
                        )}

                        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                          Your signature, the document version, a content hash, your IP and device are
                          recorded, and a copy is emailed to you and the Nabri archive.
                        </p>

                        <button
                          type="button"
                          onClick={sign}
                          disabled={!canSign}
                          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900"
                        >
                          {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                          {saving ? 'Recording…' : 'Accept and continue'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {missing.length > 1 && (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              {missing.length} document{missing.length > 1 ? 's' : ''} still need your signature.
            </p>
          )}
        </>
      )}

      <style>{`
        .legal-body h3 { font-weight: 700; margin: 14px 0 4px; }
        .legal-body ul { list-style: disc; padding-left: 20px; margin: 4px 0 8px; }
        .legal-body li { margin: 2px 0; }
        .legal-body p { margin: 0 0 8px; }
      `}</style>
    </div>
  )
}
