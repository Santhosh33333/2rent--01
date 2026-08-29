import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface EventRow {
  id: string
  title: string
  description?: string
  city?: string
  status?: string
  attendeeCount: number
  organizerName?: string
  startTime?: string
}

export function AdminEventsPage() {
  const [items, setItems] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  const fetchEvents = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.getAdminEvents({ page })
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.events) ? d.events : Array.isArray(d) ? d : []
      setItems(
        raw.map((e: any) => ({
          id: e.id,
          title: e.title || 'Untitled',
          description: e.description,
          city: e.city,
          status: e.status,
          attendeeCount: Number(e.attendeeCount ?? e._count?.attendees ?? 0),
          organizerName: e.organizer?.fullName || '—',
          startTime: e.startTime,
        })),
      )
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load events'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Events</h1>
            <p className="text-gray-400 text-sm mt-1">All platform events &amp; attendance</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Events',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['Title', 'City', 'Status', 'Attendees', 'Organizer', 'Start'],
                rows: items.map((e) => [
                  e.title,
                  e.city || '-',
                  e.status || '-',
                  String(e.attendeeCount),
                  e.organizerName || '-',
                  e.startTime ? new Date(e.startTime).toLocaleString('en-IN') : '-',
                ]),
                fileName: `rentbuddy-events-${new Date().toISOString().slice(0, 10)}`,
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
            <p className="text-gray-400 mt-4">Loading events...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <CalendarDays className="w-8 h-8 text-gray-600 mx-auto" />
            <p className="text-gray-400 mt-3">No events yet</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Title</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">City</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Attendees</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Organizer</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Start</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e) => (
                      <tr key={e.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-white text-sm font-medium">{e.title}</p>
                          {e.description && <p className="text-gray-500 text-xs line-clamp-1">{e.description}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{e.city || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{e.status || '-'}</td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{e.attendeeCount}</td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{e.organizerName}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {e.startTime ? new Date(e.startTime).toLocaleString('en-IN') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-gray-500 text-sm">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-white transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-white transition"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
