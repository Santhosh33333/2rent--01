import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface ServiceRow {
  key: string
  label: string
  shortDescription: string
  category: string
  requiresItem: boolean
  requiresDistance: boolean
  enabled: boolean
  pricing: {
    baseFee: number
    perMinute: number
    perKm: number
    platformFeePercent: number
    minBookingAmount: number
  }
}

export function AdminServicesPage() {
  const [items, setItems] = useState<ServiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchServices = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.getServices()
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.services) ? d.services : Array.isArray(d) ? d : []
      setItems(
        raw.map((s: any) => ({
          key: s.key,
          label: s.label,
          shortDescription: s.shortDescription || '',
          category: s.category || '',
          requiresItem: !!s.requiresItem,
          requiresDistance: !!s.requiresDistance,
          enabled: !!s.enabled,
          pricing: s.pricing || {},
        })),
      )
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load services'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchServices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Services</h1>
            <p className="text-gray-400 text-sm mt-1">Live partner ecosystem &amp; default pricing</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Service Catalog',
                columns: ['Key', 'Label', 'Category', 'Enabled', 'Base', 'Per Min', 'Per Km', 'Platform %'],
                rows: items.map((s) => [
                  s.key,
                  s.label,
                  s.category,
                  s.enabled ? 'Yes' : 'No',
                  `₹${s.pricing.baseFee ?? 0}`,
                  `₹${s.pricing.perMinute ?? 0}`,
                  `₹${s.pricing.perKm ?? 0}`,
                  `${s.pricing.platformFeePercent ?? 0}%`,
                ]),
                fileName: `rentbuddy-services-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={items.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        {error && <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading services...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No services found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((s) => (
              <div key={s.key} className="bg-gray-800 p-5 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h2 className="text-white font-semibold">{s.label}</h2>
                    <p className="text-gray-500 text-xs font-mono">{s.key}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${s.enabled ? 'bg-emerald-900/30 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                    {s.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <p className="text-gray-400 text-sm mb-3">{s.shortDescription}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-gray-900/50 rounded-lg p-2">
                    <p className="text-gray-500 text-[10px] uppercase">Base fee</p>
                    <p className="text-white">₹{Number(s.pricing.baseFee ?? 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-2">
                    <p className="text-gray-500 text-[10px] uppercase">Per minute</p>
                    <p className="text-white">₹{Number(s.pricing.perMinute ?? 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-2">
                    <p className="text-gray-500 text-[10px] uppercase">Per km</p>
                    <p className="text-white">₹{Number(s.pricing.perKm ?? 0).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="bg-gray-900/50 rounded-lg p-2">
                    <p className="text-gray-500 text-[10px] uppercase">Platform fee</p>
                    <p className="text-white">{Number(s.pricing.platformFeePercent ?? 0)}%</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 text-xs text-gray-500">
                  {s.requiresItem && <span className="px-2 py-1 rounded bg-gray-900/60">Item required</span>}
                  {s.requiresDistance && <span className="px-2 py-1 rounded bg-gray-900/60">Distance-based</span>}
                  <span className="px-2 py-1 rounded bg-gray-900/60">{s.category}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
