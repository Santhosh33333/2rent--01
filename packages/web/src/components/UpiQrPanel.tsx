import { useCallback, useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Download, RefreshCw, ShieldCheck, Clock } from 'lucide-react'
import { api } from '../lib/api'
import { saveBlob, svgToPngBlob } from '../lib/download'
import toast from 'react-hot-toast'

export interface UpiQrData {
  upiId: string
  accountName?: string | null
  upiUri?: string | null
  /** Admin-uploaded static QR, used only when the dynamic URI is unavailable. */
  qrUrl?: string | null
  qrReference?: string | null
  qrExpiresAt?: string | null
  qrExpiresInSeconds?: number | null
  amount: number
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

/**
 * Dynamic UPI QR.
 *
 * The QR encodes a UPI intent whose transaction reference is tied to the current
 * hour, so a screenshot of an old QR cannot be matched to a payment made later.
 * When the hour rolls over the panel refetches, which mints the next reference
 * without the customer doing anything.
 */
export function UpiQrPanel({
  bookingId,
  amount,
  data,
  onData,
}: {
  bookingId: string
  amount: number
  data: UpiQrData | null
  onData: (next: UpiQrData) => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const expiryRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // Seed the countdown from the server value, which is authoritative even if
  // the device clock is wrong.
  useEffect(() => {
    if (data?.qrExpiresAt) {
      const target = new Date(data.qrExpiresAt).getTime()
      if (!Number.isNaN(target)) {
        expiryRef.current = target
        setSecondsLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)))
      }
    }
  }, [data?.qrExpiresAt, data?.qrReference])

  const refresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await api.get(`/bookings/${bookingId}/upi-details`)
      const next = (res.data?.data || res.data) as UpiQrData
      if (next?.upiUri) {
        onData(next)
        toast.success('New payment QR generated.')
      }
    } catch {
      toast.error('Could not refresh the QR. Please try again.')
    } finally {
      setRefreshing(false)
    }
  }, [bookingId, onData, refreshing])

  /** Save the visible QR as a PNG - works in the app too, via the Share sheet. */
  const downloadQr = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg || downloading) return;
    setDownloading(true);
    try {
      const blob = await svgToPngBlob(svg);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const outcome = await saveBlob(blob, `Nabri-UPI-QR-${stamp}.png`);
      toast.success(outcome === 'shared' ? 'Choose where to save the QR' : 'QR image saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the QR image.');
    } finally {
      setDownloading(false);
    }
  }, [downloading]);

  // Tick down, and mint the next hour's QR as soon as this one expires.
  useEffect(() => {
    const tick = setInterval(() => {
      const target = expiryRef.current
      if (!target) return
      const remaining = Math.max(0, Math.floor((target - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) void refresh()
    }, 1000)
    return () => clearInterval(tick)
  }, [refresh])

  if (!data) return null

  return (
    <div className="space-y-3">
      {data.upiUri ? (
        <div className="flex flex-col items-center gap-2">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-surface-200 dark:border-surface-700">
            <QRCodeSVG ref={svgRef} value={data.upiUri} size={176} level="M" marginSize={0} />
          </div>
          <div className="flex items-center gap-1.5 text-xs text-surface-500">
            <Clock className="w-3.5 h-3.5" />
            <span>
              This QR refreshes in{' '}
              <span className="font-mono font-semibold text-surface-700 dark:text-surface-200">
                {formatCountdown(secondsLeft)}
              </span>
            </span>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Generating...' : 'Generate next QR now'}
          </button>
          <button
            onClick={() => void downloadQr()}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline disabled:opacity-50"
          >
            <Download className={`w-3.5 h-3.5 ${downloading ? 'animate-pulse' : ''}`} />
            {downloading ? 'Saving...' : 'Download QR'}
          </button>
        </div>
      ) : data.qrUrl ? (
        <img src={data.qrUrl} alt="UPI QR code" className="w-48 h-48 mx-auto rounded-xl bg-white p-2" />
      ) : (
        <p className="text-xs text-center text-surface-500">
          QR unavailable. Pay manually to the UPI ID above.
        </p>
      )}

      {data.upiUri && (
        <p className="text-xs text-center text-surface-500 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          Pay exactly{' '}
          <span className="font-bold">₹{(data.amount ?? amount).toLocaleString('en-IN')}</span> with{' '}
          <span className="font-mono">{data.upiId}</span>
        </p>
      )}
    </div>
  )
}
