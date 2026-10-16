/**
 * "Listen together" — synchronized rooms, surfaced on the music page.
 *
 * This is the create/join/list surface only. The room itself (playback sync,
 * members, media picking) lives in MusicRoomPage, so the expensive realtime
 * machinery is only mounted while someone is actually in a room.
 *
 * A room plays our own catalogue, a host-uploaded file, or a single YouTube
 * video (embedded in YouTube's own player, kept in sync with the host). See the
 * notes in MusicRoomPage and backend/src/services/mediaUrl.ts for the rules.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Headphones, Loader2, LogIn, Music4, Plus, Radio } from 'lucide-react'
import { musicRoomApi, type MusicRoomSummary } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { Modal } from '../../components/ui'

/**
 * The upload lifetimes a creator can choose. 0 keeps the file until the room
 * ends; anything else is the number of days it survives. Deliberately a short
 * list rather than a free-text field — a wrong number here silently destroys
 * someone's upload.
 */
const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Keep until the room ends' },
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

export function MusicRoomsSection() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<MusicRoomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [retentionDays, setRetentionDays] = useState(0)
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await musicRoomApi.list()
      setRooms(res.data.data.items ?? [])
    } catch {
      // A failure here is not worth an error screen: the section simply shows
      // nothing, and the music page below it still works.
      setRooms([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const res = await musicRoomApi.create({ name: trimmed, retentionDays })
      const room = res.data.data
      toast.success('Room created — add what to play')
      navigate(`/music/room/${room.id}`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not create the room'))
    } finally {
      setCreating(false)
    }
  }

  const join = async () => {
    const trimmed = code.trim()
    if (!trimmed || joining) return
    setJoining(true)
    try {
      const res = await musicRoomApi.join(trimmed)
      navigate(`/music/room/${res.data.data.roomId}`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not join that room'))
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-700 dark:text-primary-300">
          <Headphones className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Listen together</h2>
          <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
            Start a room, invite people, and everyone hears the same song from the same
            spot at the same time.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setCreateOpen(true)} className="btn btn-primary btn-sm">
          <Plus className="h-4 w-4" /> Create a room
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void join()
          }}
          placeholder="Room code"
          maxLength={8}
          className="input flex-1 uppercase tracking-widest"
          aria-label="Room code"
        />
        <button
          type="button"
          onClick={() => void join()}
          disabled={joining || !code.trim()}
          className="btn btn-ghost btn-sm"
        >
          {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Join
        </button>
      </div>

      {loading ? null : rooms.length > 0 && (
        <ul className="mt-4 space-y-2">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/music/room/${room.id}`}
                className="flex items-center gap-3 rounded-2xl border border-surface-200 p-3 transition hover:border-primary-300 dark:border-surface-800"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-100 dark:bg-surface-800">
                  {room.isPlaying ? (
                    <Radio className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                  ) : (
                    <Music4 className="h-4 w-4 text-surface-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{room.name}</span>
                  <span className="block truncate text-xs text-surface-500">
                    {room.isPlaying ? 'Playing now' : room.mediaTitle || 'Nothing playing'}
                    {' · '}
                    {room.memberCount} {room.memberCount === 1 ? 'member' : 'members'}
                    {room.myRole === 'HOST' ? ' · you host' : ''}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs text-surface-400">{room.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a room"
        description="Name it. You'll pick what to play next."
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || !name.trim()}
              className="btn btn-primary btn-sm"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </button>
          </>
        }
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
          placeholder="e.g. Sunday night songs"
          maxLength={60}
          autoFocus
          className="input"
        />

        <div className="mt-4 space-y-1.5">
          <label htmlFor="room-retention" className="text-xs font-semibold uppercase tracking-wide text-surface-500">
            Upload lifetime
          </label>
          <select
            id="room-retention"
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            className="input"
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-surface-400">
            A file you upload is removed automatically after this. Links and our own tracks are
            unaffected. You can still end or remove the room at any time.
          </p>
        </div>
      </Modal>
    </div>
  )
}
