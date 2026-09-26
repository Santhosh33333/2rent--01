import { useState } from 'react'
import { FileText, CheckCircle2, ChevronDown, ShieldCheck, Download, Loader2 } from 'lucide-react'
import { agreementApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { AnimatedPage } from '../../components/AnimatedPage'
import { useAsync } from '../../hooks/useAsync'
import { useAuth } from '../../lib/auth'
import toast from 'react-hot-toast'

interface Agreement {
  id: string
  kind: 'USER' | 'PARTNER'
  title: string
  status: 'PENDING' | 'SENT' | 'ACCEPTED'
  contentHtml?: string
  sentAt?: string | null
  acceptedAt?: string | null
  createdAt?: string
}

const statusBadge: Record<string, string> = {
  ACCEPTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  SENT: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

export function AgreementsPage() {
  const { user } = useAuth()
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Agreement | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)

  const { loading, error, retry } = useAsync(
    async () => {
      const res = await agreementApi.getMyAgreements()
      const d = res.data?.data || res.data || {}
      const raw = Array.isArray(d) ? d : d.items || d.agreements || []
      setAgreements(raw.map((a: any) => ({ ...a })))
      return raw
    },
    true
  )

  const toggleDetail = async (ag: Agreement) => {
    if (open === ag.id) {
      setOpen(null)
      setDetail(null)
      return
    }
    setOpen(ag.id)
    setDetail(null)
    try {
      const res = await agreementApi.getAgreement(ag.id)
      const d = res.data?.data?.agreement || res.data?.agreement
      setDetail(d as Agreement)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load agreement'))
    }
  }

  const handleAccept = async (ag: Agreement) => {
    if (!window.confirm(`Accept "${ag.title}"? This records your agreement with Nabri.`)) return
    setAccepting(ag.id)
    try {
      await agreementApi.accept(ag.id)
      toast.success('Agreement accepted — confirmation emailed to you')
      setAgreements((prev) => prev.map((a) => (a.id === ag.id ? { ...a, status: 'ACCEPTED', acceptedAt: new Date().toISOString() } : a)))
      if (detail && detail.id === ag.id) setDetail({ ...detail, status: 'ACCEPTED', acceptedAt: new Date().toISOString() })
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to accept agreement'))
    } finally {
      setAccepting(null)
    }
  }

  const downloadPrint = async (ag: Agreement, contentHtml: string | undefined) => {
    if (!contentHtml) {
      toast.error('Agreement content not loaded yet')
      return
    }
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><title>${ag.title}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;color:#1C1917;line-height:1.6}h1{color:#0D378B;border-bottom:3px solid #0D378B;padding-bottom:10px}</style></head><body><h1>${ag.title}</h1>${contentHtml}<script>window.onload=()=>window.print()<\/script></body></html>`)
    win.document.close()
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-56 rounded-2xl" />
        <SkeletonLoader lines={6} variant="table" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={FileText}
        title="Failed to load agreements"
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
      />
    )
  }

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <PageHeader title="My Agreements" subtitle={user?.fullName || 'Signed-in member'} />

        <div className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800/50 p-4">
          <p className="text-sm text-surface-600 dark:text-surface-400">
            These agreements are issued after your identity (KYC) is approved and are legally binding in India. Accept them to fully activate your
            account. A PDF copy is emailed to you and a record is kept on file.
          </p>
        </div>

        {agreements.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No agreements yet"
            description="Your agreements will appear here once your identity verification is approved."
          />
        ) : (
          <div className="space-y-3">
            {agreements.map((ag) => (
              <div
                key={ag.id}
                className={`rounded-2xl border ${ag.status === 'ACCEPTED' ? 'border-emerald-300 dark:border-emerald-800' : 'border-surface-200 dark:border-surface-700'} bg-white dark:bg-surface-800/50 overflow-hidden`}
              >
                <button onClick={() => toggleDetail(ag)} className="w-full text-left p-4 flex items-center gap-3 hover:bg-surface-50 dark:hover:bg-surface-700/40 transition">
                  <div className="w-11 h-11 rounded-xl bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-surface-900 dark:text-white truncate">{ag.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusBadge[ag.status] || 'bg-gray-100 text-gray-600'}`}>
                        {ag.status === 'ACCEPTED' ? 'Accepted' : ag.status === 'SENT' ? 'Emailed — awaiting accept' : 'Pending issue'}
                      </span>
                      <span className="text-[10px] text-surface-500">{ag.kind === 'PARTNER' ? 'Partner agreement' : 'Member agreement'}</span>
                    </div>
                  </div>
                  <ChevronOpen open={open === ag.id} />
                </button>

                {open === ag.id && (
                  <div className="px-4 pb-4">
                    {detail ? (
                      <>
                        <div
                          className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900/40 p-4 max-h-96 overflow-y-auto text-sm leading-relaxed text-surface-700 dark:text-surface-300"
                          dangerouslySetInnerHTML={{ __html: detail.contentHtml || '' }}
                        />
                        <div className="flex flex-wrap items-center gap-2 mt-4">
                          {ag.status !== 'ACCEPTED' ? (
                            <button
                              onClick={() => handleAccept(ag)}
                              disabled={accepting === ag.id}
                              className="btn btn-primary btn-sm flex items-center gap-2"
                            >
                              {accepting === ag.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              {accepting === ag.id ? 'Recording…' : 'Accept agreement'}
                            </button>
                          ) : (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                              <CheckCircle2 className="w-4 h-4" /> Accepted{ag.acceptedAt ? ` · ${new Date(ag.acceptedAt).toLocaleDateString('en-IN')}` : ''}
                            </span>
                          )}
                          <button onClick={() => downloadPrint(ag, detail.contentHtml)} className="btn btn-ghost btn-sm flex items-center gap-2">
                            <Download className="w-4 h-4" /> PDF
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="space-y-2">
                        <SkeletonLoader lines={3} variant="text" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

function ChevronOpen({ open }: { open: boolean }) {
  return (
    <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform ${open ? 'rotate-180' : ''}`} />
  )
}