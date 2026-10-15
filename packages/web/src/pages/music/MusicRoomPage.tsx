/**
 * A synchronized listening / watch-together room.
 *
 * The host is the clock. Only the host's transport moves playback, and every
 * change is broadcast so guests follow. A guest never touches their own
 * transport — scrubbing would desync them, so the guest's player has no
 * controls, only a "sync now" that re-applies the host's last position.
 *
 * Two browser facts shape the guest experience:
 *
 *   - **Autoplay is blocked.** A guest cannot be told to "just play" on arrival;
 *     that silently fails. So a guest is *unarmed* until they tap once, and a tap
 *     is what makes the room audible. Until then the host's changes are recorded
 *     but not played.
 *   - **Media may not be seekable the instant it is assigned.** Seeking before
 *     metadata exists is dropped by some browsers, so the target position is
 *     (re)applied on `loadedmetadata` and on every sync, not only on a click.
 *
 * Media is our own (the licensed catalogue, an uploaded file), a direct
 * audio/video file the host supplies, or a single YouTube video. A YouTube
 * playlist is refused because it has no one position to synchronise — see
 * backend/src/services/mediaUrl.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  Copy,
  Headphones,
  Link2,
  Loader2,
  LogOut,
  Music4,
  Pause,
  Play,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import { assetUrl, musicRoomApi, type MusicRoomDetail } from '../../lib/api'
import { loadSongLibrary, type SongTrack } from '../../lib/songLibrary'
import { useAuth } from '../../lib/auth'
import { useSocket } from '../../hooks/useSocket'
import { Avatar } from '../../components/Avatar'
import { GroupMemberPicker } from '../../components/GroupMemberPicker'
import { YouTubeRoomPlayer, type YouTubeTransport } from './YouTubeRoomPlayer'
import { youtubeVideoId } from '../../lib/youtubePlayer'
import { Modal, ScreenState } from '../../components/ui'
import { getErrorMessage } from '../../lib/error'
import { shareContent } from '../../lib/share'

interface PlaybackSync {
  isPlaying: boolean
  positionSec: number
  updatedAt: string
  version: number
}

/**
 * Resolve a room's media URL for the browser.
 *
 * `/audio/...` is served by the web app itself and `/uploads/...` by the API,
 * which in a Capacitor/prod build is a different origin — so only the upload
 * path is re-based. Absolute https URLs pass through unchanged.
 */
function resolveRoomMedia(url?: string | null): string | undefined {
  if (!url) return undefined
  if (url.startsWith('/uploads/')) return assetUrl(url)
  return url
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** "in 3 days" style countdown to an upload's expiry. */
function formatExpiry(iso: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return ''
  const days = Math.ceil((when.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'soon'
  return days === 1 ? 'in 1 day' : `in ${days} days`
}

/** The upload-lifetime choices offered in the room, mirroring the create dialog. */
const RETENTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Keep until the room ends' },
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
]

export function MusicRoomPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id
  const { on, emit } = useSocket({ autoConnect: true })

  const [room, setRoom] = useState<MusicRoomDetail | null>(null)
  const [sync, setSync] = useState<PlaybackSync | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [needsTap, setNeedsTap] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)

  const [mediaOpen, setMediaOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tracks, setTracks] = useState<SongTrack[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [titleInput, setTitleInput] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const ytTransportRef = useRef<YouTubeTransport | null>(null)
  const desiredRef = useRef<{ positionSec: number; isPlaying: boolean }>({ positionSec: 0, isPlaying: false })
  const isHostRef = useRef(false)

  const isHost = room?.myRole === 'HOST'
  useEffect(() => {
    isHostRef.current = isHost === true
  }, [isHost])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!roomId) return
      try {
        const res = await musicRoomApi.detail(roomId)
        if (signal?.aborted) return
        const detail = res.data.data
        setRoom(detail)
        setSync({
          isPlaying: detail.isPlaying,
          positionSec: detail.positionSec,
          updatedAt: detail.updatedAt,
          version: detail.version,
        })
        setError(null)
      } catch (err) {
        if (!signal?.aborted) setError(getErrorMessage(err, "We couldn't open this room."))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [roomId],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Catalogue for the host's picker. `loadSongLibrary` is memoised, so opening
  // the picker does not refetch.
  useEffect(() => {
    let alive = true
    void loadSongLibrary().then((lib) => {
      if (alive) setTracks(lib.tracks)
    })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Apply the host's desired playhead to the guest's element. Safe to call at
   * any time: a seek is skipped when we are already close, and a rejected
   * `play()` is turned into the "tap to listen" prompt rather than a silent
   * console error.
   */
  const applyDesired = useCallback(() => {
    // A YouTube frame is driven through its own API, not through an element.
    const yt = ytTransportRef.current
    if (yt) {
      yt.applyNow()
      return
    }
    const el = mediaRef.current
    if (!el) return
    const { positionSec, isPlaying } = desiredRef.current
    if (Number.isFinite(positionSec) && Math.abs(el.currentTime - positionSec) > 1.5) {
      try {
        el.currentTime = positionSec
      } catch {
        /* metadata not ready yet; the loadedmetadata handler will retry */
      }
    }
    if (isPlaying) {
      const attempt = el.play()
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => setNeedsTap(true))
    } else if (!el.paused) {
      el.pause()
    }
  }, [])

  // Join the room's realtime channel; re-join after any reconnect, since the
  // first emit can fire before the socket is up.
  useEffect(() => {
    if (!roomId) return
    emit('music_room_join', roomId)
    const off = on('connect', () => emit('music_room_join', roomId))
    return () => {
      off?.()
      emit('music_room_leave', roomId)
    }
  }, [roomId, emit, on])

  const applyServerSync = useCallback((data: any) => {
    setRoom((prev) =>
      prev && (prev.mediaUrl !== data.mediaUrl || prev.mediaKind !== data.mediaKind)
        ? { ...prev, mediaUrl: data.mediaUrl, mediaKind: data.mediaKind, mediaTitle: data.mediaTitle }
        : prev,
    )
    setSync({
      isPlaying: data.isPlaying === true,
      positionSec: Number(data.positionSec) || 0,
      updatedAt: String(data.updatedAt || new Date().toISOString()),
      version: Number(data.version) || 0,
    })
  }, [])

  useEffect(() => {
    if (!roomId) return
    const offState = on('music_room_state', (data: unknown) => {
      const d = data as { roomId?: string }
      if (d?.roomId !== roomId) return
      applyServerSync(d)
    })
    const offSync = on('music_room_sync', (data: unknown) => {
      const d = data as { roomId?: string }
      if (d?.roomId !== roomId) return
      applyServerSync(d)
    })
    const offPresence = on('music_room_presence', (data: unknown) => {
      const d = data as { roomId?: string; memberCount?: number }
      if (d?.roomId !== roomId) return
      setRoom((prev) => (prev ? { ...prev, memberCount: d.memberCount ?? prev.memberCount } : prev))
    })
    const offHost = on('music_room_host_changed', (data: unknown) => {
      const d = data as { roomId?: string }
      if (d?.roomId !== roomId) return
      void load()
    })
    const offEnded = on('music_room_ended', (data: unknown) => {
      const d = data as { roomId?: string }
      if (d?.roomId !== roomId) return
      setEnded(true)
    })
    return () => {
      offState?.()
      offSync?.()
      offPresence?.()
      offHost?.()
      offEnded?.()
    }
  }, [roomId, on, applyServerSync, load])

  // Guests follow the host's clock. The host is the source, so it never rewrites
  // its own element from a broadcast.
  useEffect(() => {
    if (!sync || isHost) return
    const elapsed = sync.isPlaying
      ? Math.max(0, (Date.now() - new Date(sync.updatedAt).getTime()) / 1000)
      : 0
    desiredRef.current = { positionSec: sync.positionSec + elapsed, isPlaying: sync.isPlaying }
    const el = mediaRef.current
    if (el && el.readyState >= 1) applyDesired()
  }, [sync, isHost, applyDesired])

  // While playing, the host reports its real playhead periodically so guests can
  // correct the drift that buffering introduces, and so a late joiner lands in
  // the right place even if no control event follows.
  useEffect(() => {
    if (!isHost || !room?.mediaUrl || room.mediaKind === 'YOUTUBE') return
    const id = window.setInterval(() => {
      const el = mediaRef.current
      if (!el || el.paused) return
      emit('music_room_heartbeat', { roomId, positionSec: el.currentTime, isPlaying: true })
    }, 10000)
    return () => window.clearInterval(id)
  }, [isHost, room?.mediaUrl, roomId, emit])

  // Stop the audio when leaving the page.
  useEffect(() => {
    return () => {
      mediaRef.current?.pause()
    }
  }, [])

  const setMediaEl = useCallback((el: HTMLMediaElement | null) => {
    mediaRef.current = el
  }, [])

  const onLoadedMetadata = useCallback(() => {
    if (!isHostRef.current) applyDesired()
  }, [applyDesired])

  const onTimeUpdate = useCallback(() => {
    const el = mediaRef.current
    if (el) {
      setPosition(el.currentTime)
      if (Number.isFinite(el.duration)) setDuration(el.duration)
    }
  }, [])

  // --- Host transport. Native controls drive the element; these listeners turn
  // those user actions into the room's shared state. ---
  const hostPlay = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    emit('music_room_control', { roomId, action: 'play', positionSec: el.currentTime })
  }, [emit, roomId])
  const hostPause = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    emit('music_room_control', { roomId, action: 'pause', positionSec: el.currentTime })
  }, [emit, roomId])
  const hostSeeked = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    emit('music_room_control', { roomId, action: 'seek', positionSec: el.currentTime, isPlaying: !el.paused })
  }, [emit, roomId])

  // --- YouTube transport. The frame reports its own calls; these relay them to
  // the room exactly as the audio element's handlers do. ---
  const ytControl = useCallback(
    (action: 'play' | 'pause', positionSec: number) => {
      emit('music_room_control', { roomId, action, positionSec })
    },
    [emit, roomId],
  )
  const ytHeartbeat = useCallback(
    (positionSec: number, isPlaying: boolean) => {
      emit('music_room_heartbeat', { roomId, positionSec, isPlaying })
    },
    [emit, roomId],
  )
  const ytProgress = useCallback((positionSec: number, durationSec: number, isPlaying: boolean) => {
    setPosition(positionSec)
    if (durationSec > 0) setDuration(durationSec)
    setPlaying(isPlaying)
  }, [])
  const ytRequestTap = useCallback(() => setNeedsTap(true), [])

  const pickTrack = async (mediaUrl: string, mediaTitle: string) => {
    if (!roomId || busy) return
    setBusy(true)
    try {
      await musicRoomApi.update(roomId, { mediaUrl, mediaTitle })
      setMediaOpen(false)
      setUrlInput('')
      setTitleInput('')
      // The server broadcasts the new state; refresh membership-free fields too.
      await load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not set what plays'))
    } finally {
      setBusy(false)
    }
  }

  const pickUrl = () => {
    const url = urlInput.trim()
    if (!url) return
    void pickTrack(url, titleInput.trim() || 'Shared media')
  }

  const uploadFile = async (file: File) => {
    if (!roomId || uploading) return
    setUploading(true)
    try {
      await musicRoomApi.uploadMedia(roomId, file, titleInput.trim() || undefined)
      setMediaOpen(false)
      setUrlInput('')
      setTitleInput('')
      // The server broadcast the new track; refresh so the host's own picker
      // reflects the stored title and the room summary stays truthful.
      await load()
      toast.success('Added to the room')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not upload that file'))
    } finally {
      setUploading(false)
    }
  }

  const addPeople = async (userIds: string[]) => {
    if (!roomId) return
    setBusy(true)
    try {
      const res = await musicRoomApi.addMembers(roomId, userIds)
      toast.success('Added')
      setRoom((prev) => (prev ? { ...prev, memberCount: res.data.data.memberCount } : prev))
      setAddOpen(false)
      await load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not add them'))
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    if (!roomId) return
    setBusy(true)
    try {
      await musicRoomApi.leave(roomId)
      toast.success('You left the room')
      navigate('/music')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not leave right now'))
      setBusy(false)
    }
  }

  const endRoom = async () => {
    if (!roomId) return
    setBusy(true)
    try {
      await musicRoomApi.end(roomId)
      toast.success('Room ended')
      navigate('/music')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not end the room'))
      setBusy(false)
    }
  }

  const removeRoom = async () => {
    if (!roomId) return
    setBusy(true)
    try {
      await musicRoomApi.remove(roomId)
      toast.success('Room removed')
      navigate('/music')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove the room'))
      setBusy(false)
    }
  }

  const changeRetention = async (days: number) => {
    if (!roomId) return
    setBusy(true)
    try {
      await musicRoomApi.update(roomId, { retentionDays: days })
      await load()
      toast.success('Upload lifetime updated')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not change the upload lifetime'))
    } finally {
      setBusy(false)
    }
  }

  const copyCode = () => {
    if (!room?.code) return
    navigator.clipboard?.writeText(room.code).then(
      () => toast.success('Room code copied'),
      () => toast.error('Could not copy the code'),
    )
  }

  const resolvedMedia = resolveRoomMedia(room?.mediaUrl)
  const youTubeId = room?.mediaKind === 'YOUTUBE' ? youtubeVideoId(room.mediaUrl) : null
  const existingMemberIds = useMemo(() => room?.members.map((m) => m.userId) ?? [], [room])

  if (loading) {
    return (
      <div className="mx-auto flex h-[70vh] max-w-3xl items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    )
  }

  if (ended) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <ScreenState kind="empty" title="This room has ended" message="The host closed it. Start your own from the music page." />
        <div className="mt-4 text-center">
          <Link to="/music" className="text-sm font-semibold text-primary-600 dark:text-primary-300">
            Back to music
          </Link>
        </div>
      </div>
    )
  }

  if (error || !room) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <ScreenState kind="error" title="Room unavailable" message={error || 'This room could not be opened.'} onRetry={() => void load()} />
        <div className="mt-4 text-center">
          <Link to="/music" className="text-sm font-semibold text-primary-600 dark:text-primary-300">
            Back to music
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="flex items-center gap-3 border-b border-surface-200 pb-3 dark:border-surface-800">
        <Link
          to="/music"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-surface-900 dark:text-white">{room.name}</p>
          <p className="truncate text-xs text-surface-500 dark:text-surface-400">
            {isHost ? 'You host' : 'Listening'} · {room.memberCount} {room.memberCount === 1 ? 'person' : 'people'}
          </p>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="flex items-center gap-1.5 rounded-2xl bg-surface-100 px-3 py-2 font-mono text-xs text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
          title="Copy room code"
        >
          <Copy className="h-3.5 w-3.5" /> {room.code}
        </button>
        <button
          type="button"
          onClick={() => {
            shareContent({ title: room.name, text: 'Join my Nabri music room', url: window.location.href })
          }}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Share room"
        >
          <Share2 className="h-5 w-5" />
        </button>
        {isHost && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-700 transition hover:bg-primary-500/25 dark:text-primary-300"
            aria-label="Add people"
          >
            <UserPlus className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Members"
        >
          <Users className="h-5 w-5" />
        </button>
      </header>

      <div className="glass-card p-5">
        {room.mediaUrl ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-700 dark:text-primary-300">
                {playing ? <Pause className="h-5 w-5" /> : <Music4 className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{room.mediaTitle || 'Now playing'}</p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {playing ? 'Playing' : 'Paused'} · {formatTime(position)}
                  {duration > 0 ? ` / ${formatTime(duration)}` : ''}
                </p>
                {room.mediaUrl?.startsWith('/uploads/') && room.mediaExpiresAt && (
                  <p className="text-xs text-surface-400">
                    Upload is removed {formatExpiry(room.mediaExpiresAt)}
                  </p>
                )}
              </div>
              {!isHost && (
                <button
                  type="button"
                  onClick={applyDesired}
                  className="flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1.5 text-xs font-semibold text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Sync now
                </button>
              )}
            </div>

            {room.mediaKind === 'YOUTUBE' ? (
              youTubeId ? (
                <YouTubeRoomPlayer
                  videoId={youTubeId}
                  isHost={isHost}
                  sync={sync}
                  transportRef={ytTransportRef}
                  onControl={ytControl}
                  onHeartbeat={ytHeartbeat}
                  onProgress={ytProgress}
                  onRequestTap={ytRequestTap}
                />
              ) : (
                <p className="text-sm text-surface-500">
                  This video link could not be read. Ask the host to pick it again.
                </p>
              )
            ) : room.mediaKind === 'VIDEO' ? (
              <video
                ref={setMediaEl}
                src={resolvedMedia}
                controls={isHost}
                playsInline
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => {
                  setPlaying(true)
                  if (isHost) hostPlay()
                }}
                onPause={() => {
                  setPlaying(false)
                  if (isHost) hostPause()
                }}
                onSeeked={() => {
                  if (isHost) hostSeeked()
                }}
                className="w-full rounded-2xl bg-black"
              />
            ) : (
              <audio
                ref={setMediaEl}
                src={resolvedMedia}
                controls={isHost}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onPlay={() => {
                  setPlaying(true)
                  if (isHost) hostPlay()
                }}
                onPause={() => {
                  setPlaying(false)
                  if (isHost) hostPause()
                }}
                onSeeked={() => {
                  if (isHost) hostSeeked()
                }}
                className="w-full"
              />
            )}

            {/* A guest's element cannot start on its own. Name it and give the
                one gesture that fixes it, rather than a room that stays silent
                with no explanation. */}
            {!isHost && needsTap && (
              <button
                type="button"
                onClick={() => {
                  setNeedsTap(false)
                  applyDesired()
                }}
                className="btn btn-primary btn-sm mt-4 w-full"
              >
                <Play className="h-4 w-4" /> Tap to listen along
              </button>
            )}
          </>
        ) : (
          <div className="py-8 text-center">
            <Headphones className="mx-auto mb-2 h-6 w-6 text-surface-300" />
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">
              {isHost ? 'Nothing playing yet' : 'Waiting for the host'}
            </p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
              {isHost ? 'Pick a song or a video to start the room.' : 'The host will pick something soon.'}
            </p>
            {isHost && (
              <button type="button" onClick={() => setMediaOpen(true)} className="btn btn-primary btn-sm mt-4">
                <Link2 className="h-4 w-4" /> Choose what plays
              </button>
            )}
          </div>
        )}
      </div>

      {isHost && room.mediaUrl && (
        <button type="button" onClick={() => setMediaOpen(true)} className="btn btn-ghost btn-sm">
          <Link2 className="h-4 w-4" /> Change what plays
        </button>
      )}

      <p className="text-xs text-surface-400">
        Rooms play our own tracks, uploaded files, a direct audio/video link, or a single YouTube
        video. Paste a YouTube link to watch it together — playback stays in YouTube&apos;s own
        player and stays in sync with the host.
      </p>

      {/* Members */}
      <Modal open={membersOpen} onClose={() => setMembersOpen(false)} title={room.name} description={`${room.memberCount} people`}>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {room.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 rounded-2xl px-2 py-2">
              <Avatar src={m.user?.avatarUrl} name={m.user?.fullName} className="h-10 w-10 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                  {m.user?.fullName || 'Nabri member'}
                  {m.userId === myId ? ' (you)' : ''}
                </p>
                <p className="text-xs capitalize text-surface-400">{m.role.toLowerCase()}</p>
              </div>
            </div>
          ))}
        </div>
        {isHost && (
          <div className="mt-4 space-y-1.5">
            <label
              htmlFor="room-retention-edit"
              className="text-xs font-semibold uppercase tracking-wide text-surface-500"
            >
              Upload lifetime
            </label>
            <select
              id="room-retention-edit"
              value={room.retentionDays}
              disabled={busy}
              onChange={(e) => void changeRetention(Number(e.target.value))}
              className="input"
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-surface-400">
              Applies to a file you upload. Links and our own tracks are unaffected.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {isHost && (
            <button type="button" onClick={() => setAddOpen(true)} className="btn btn-primary btn-sm">
              <UserPlus className="h-4 w-4" /> Add people
            </button>
          )}
          <button type="button" onClick={() => void leave()} disabled={busy} className="btn btn-ghost btn-sm">
            <LogOut className="h-4 w-4" /> Leave
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => void endRoom()}
              disabled={busy}
              className="btn btn-sm text-red-600 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> End room
            </button>
          )}
          {isHost && (
            <button
              type="button"
              onClick={() => void removeRoom()}
              disabled={busy}
              className="btn btn-sm text-red-700 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Remove room
            </button>
          )}
        </div>
      </Modal>

      {/* Host: choose what plays */}
      <Modal
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        title="What plays"
        description="Upload a file, pick a catalogue track, or paste a direct audio/video or YouTube link."
      >
        {tracks.length > 0 && (
          <div className="mb-4 max-h-52 space-y-1 overflow-y-auto">
            {tracks.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => void pickTrack(t.src, t.title)}
                className="flex w-full items-center gap-3 rounded-2xl border border-surface-200 p-3 text-left transition hover:border-primary-300 disabled:opacity-50 dark:border-surface-800"
              >
                <Music4 className="h-4 w-4 text-surface-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{t.title}</span>
                  {t.artist && <span className="block truncate text-xs text-surface-500">{t.artist}</span>}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-surface-500">Title (optional)</label>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="e.g. Sunday night song"
            maxLength={200}
            className="input"
          />
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-surface-500">Upload from your device</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Clear so picking the same file twice still fires onChange.
              e.target.value = ''
              if (file) void uploadFile(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading}
            className="btn btn-primary btn-sm w-full"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Choose a file
          </button>
          <p className="text-xs text-surface-400">
            MP3, M4A, WAV, FLAC, OGG, MP4, MOV or WEBM — up to 25 MB. Only upload what you have the right to share.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-surface-500">Direct link or YouTube</label>
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…/song.mp3, /audio/… or a YouTube video link"
            className="input"
          />
          <button
            type="button"
            onClick={pickUrl}
            disabled={busy || uploading || !urlInput.trim()}
            className="btn btn-ghost btn-sm w-full"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Play this link
          </button>
        </div>
      </Modal>

      <GroupMemberPicker
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onConfirm={(ids) => void addPeople(ids)}
        title={`Add to ${room.name}`}
        excludeIds={existingMemberIds}
        confirmLabel="Add"
        busy={busy}
      />
    </div>
  )
}

export default MusicRoomPage
