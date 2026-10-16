import { getErrorMessage } from '../../lib/error'
import toast from 'react-hot-toast'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Send, Loader2, AlertTriangle,
  CheckCheck, MessageCircle, ImagePlus, Mic, Square,
  Trash2, Flag, Ban, X, MessageCircleReply, Phone, Video,
  Compass, Calendar, UserPlus
} from 'lucide-react'
import { api, assetUrl, chatRequestApi, type ConnectionStatus } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useChat, useSocket } from '../../hooks/useSocket'
import { useCallLauncher } from '../../hooks/useCallLauncher'
import { Avatar } from '../../components/Avatar'

interface Message {
  id: string
  senderId: string
  receiverId?: string
  content: string
  messageType?: string
  mediaUrl?: string | null
  status?: string
  createdAt: string
  sender?: { fullName: string; avatarUrl?: string }
  replyToId?: string | null
  replyTo?: { id: string; content: string; senderId: string; messageType?: string; status?: string } | null
  reactions?: Record<string, string[]>
}

const REACTION_GLYPHS: Record<string, string> = {
  love: '❤️',
  like: '👍',
  laugh: '😂',
  wow: '😮',
  sad: '😢',
  thanks: '🙏',
  fire: '🔥',
  clap: '👏',
}
const REACTION_KEYS = Object.keys(REACTION_GLYPHS)

/** Loads an authenticated attachment (server checks membership) as a blob URL. */
function ChatAttachment({ mediaUrl, kind }: { mediaUrl: string; kind: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Chat media is stored as a relative "/uploads/..." path. `api`'s baseURL
  // ends in "/api", so requesting it unresolved hits "/api/uploads/..." and
  // 404s — every shared photo/voice note rendered "Attachment unavailable".
  // assetUrl() resolves it against the API origin instead.
  const resolved = assetUrl(mediaUrl)
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    if (!resolved) {
      setFailed(true)
      return
    }
    api.get(resolved, { responseType: 'blob' }).then((res) => {
      if (!alive) return
      objectUrl = URL.createObjectURL(res.data)
      setSrc(objectUrl)
      setFailed(false)
    }).catch(() => { if (alive) setFailed(true) })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resolved])
  if (failed) return <p className="text-xs opacity-70">Attachment unavailable</p>
  if (!src) return <Loader2 className="w-4 h-4 animate-spin" />
  if (kind === 'IMAGE') {
    return <img src={src} alt="Shared photo" className="rounded-xl max-w-full max-h-64 object-cover" />
  }
  return <audio controls src={src} className="max-w-full" />
}

export function ConversationPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id
  const startCall = useCallLauncher()

  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string>('Chat')
  const [partnerAvatar, setPartnerAvatar] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [otherTyping, setOtherTyping] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null)
  const [reportReason, setReportReason] = useState('Spam')
  const [reportDesc, setReportDesc] = useState('')
  const [modBusy, setModBusy] = useState(false)
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  // Chat-request state for a brand-new contact. The empty thread offers to ask
  // before messaging, but only when there is no existing connection (a dating
  // match or an existing thread already opens the chat).
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [requestNote, setRequestNote] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  // A brand-new contact cannot message until a request is accepted — the same
  // rule the server enforces on both send paths. While the status is still
  // loading (`null`) the composer stays usable and the server is the backstop.
  const chatLocked = Boolean(connection && !connection.connected)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  // The scrolling thread container and whether the reader is parked at its
  // bottom. New messages only auto-scroll when they are already at the bottom,
  // so a refresh can never yank them out of the history they are reading.
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const convIdRef = useRef<string | null>(null)
  const tempSeq = useRef(0)
  // Timers for optimistic bubbles awaiting a server ack. If the ack never
  // arrives (the socket died mid-send) the placeholder is dropped instead of
  // lingering forever as a message that was never actually delivered.
  const pendingAcks = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // The userId the currently-rendered fetch belongs to. A slow response for a
  // conversation the user already navigated away from must not repopulate it.
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const chat = useChat(conversationId ?? '')
  const chatRef = useRef(chat)
  chatRef.current = chat

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  /** Track whether the reader is at the bottom so we only follow new messages
      when it will not interrupt them. */
  const onThreadScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  useEffect(() => { convIdRef.current = conversationId }, [conversationId])

  // React reuses this component instance when the user opens a different
  // conversation from the Messages list (same route, different :userId param).
  // Without a reset the previous thread's conversationId and messages leak into
  // the new one: sends went to the old conversation, receipts marked the wrong
  // thread, and the previous chat's bubbles stayed on screen.
  useEffect(() => {
    setMessages([])
    setConversationId(null)
    convIdRef.current = null
    setPartnerName('Chat')
    setPartnerAvatar(null)
    setOtherTyping(false)
    setText('')
    setReplyTarget(null)
    setError(null)
    setConnection(null)
    setRequestNote('')
    setLoading(true)
  }, [userId])

  // Connection state for the (possibly) fresh thread. `connected` is true when
  // the pair can already chat - an accepted request, existing messages, or a
  // dating match - so the request panel is only offered to a genuinely new
  // contact and never to someone you already matched with.
  useEffect(() => {
    if (!userId) return
    let alive = true
    chatRequestApi
      .status(userId)
      .then((res) => {
        if (alive) setConnection(res.data.data)
      })
      .catch(() => {
        if (alive) setConnection(null)
      })
    return () => {
      alive = false
    }
  }, [userId])

  const sendChatRequest = async () => {
    if (!userId || requestBusy) return
    setRequestBusy(true)
    try {
      await chatRequestApi.send(userId, requestNote.trim() || undefined)
      setConnection((prev) =>
        prev
          ? {
              ...prev,
              canSendRequest: false,
              request: {
                id: 'pending',
                status: 'PENDING',
                direction: 'SENT',
                message: requestNote.trim() || null,
                expiresAt: '',
                cooldownUntil: null,
              },
            }
          : prev,
      )
      setRequestNote('')
      toast.success('Chat request sent.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the request'))
    } finally {
      setRequestBusy(false)
    }
  }

  /** Drop the ack watchdog for an optimistic bubble (reconciled or failed). */
  const clearPending = (tempId: string) => {
    const t = pendingAcks.current.get(tempId)
    if (t) {
      clearTimeout(t)
      pendingAcks.current.delete(tempId)
    }
  }

  // Initial load. After that the thread is kept current by real-time socket
  // events; the list is only re-fetched when a dropped connection may have
  // missed frames (see the recovery effect below). There is deliberately no
  // timer: a poll every 15s replaced the whole list, re-rendered every bubble
  // and — through the scroll effect — jumped the view, which read as the screen
  // refreshing on its own in the middle of a conversation.
  const fetchMessages = useCallback(async () => {
    if (!userId) return
    try {
      const response = await api.get(`/messages/${userId}`)
      // The user switched threads while this request was in flight.
      if (userIdRef.current !== userId) return
      const result = response.data
      if (result.success) {
        const items: Message[] = result.data?.items || []
        const cid = (items as any[]).find((m: any) => m.conversationId)?.conversationId
        if (cid) {
          convIdRef.current = cid
          // Replace, not `prev ?? cid`: on a thread switch the previous
          // conversationId must be replaced, not sticky.
          setConversationId(cid)
        }
        const theirs = items.find((m) => m.senderId === userId && (m as any).sender?.fullName)
        if (theirs) {
          setPartnerName((theirs as any).sender.fullName)
          // The message payload already carries the peer's avatarUrl; reading
          // only fullName is why the chat header and bubble showed initials.
          setPartnerAvatar((theirs as any).sender.avatarUrl ?? null)
        }

        setMessages((prev) => {
          const serverIds = new Set(items.map((m) => m.id))
          const temps = prev.filter((m) => m.id.startsWith('temp-'))
          const merged = [...items]
          for (const t of temps) if (!serverIds.has(t.id)) merged.push(t)

          // Bail out when nothing actually changed. Replacing the array with
          // freshly-parsed objects made every bubble re-render on every fetch
          // even when the thread was identical, which is the churn the user saw
          // as the screen "refreshing".
          const unchanged =
            merged.length === prev.length &&
            merged.every((m, i) => {
              const p = prev[i]
              return (
                !!p &&
                p.id === m.id &&
                p.status === m.status &&
                p.content === m.content &&
                JSON.stringify(p.reactions ?? {}) === JSON.stringify(m.reactions ?? {})
              )
            })
          return unchanged ? prev : merged
        })

        // Mark the partner's messages to us as read (real-time, via socket).
        const cidNow = convIdRef.current
        if (cidNow) {
          const unread = items.filter((m) => m.receiverId === myId && m.status !== 'READ')
          if (unread.length) {
            chatRef.current?.markAsRead(unread.map((m) => m.id), cidNow)
          }
        }
      } else {
        setError(result.error || 'Failed to fetch messages')
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to fetch messages'))
    } finally {
      setLoading(false)
    }
  }, [userId, myId])

  useEffect(() => {
    fetchMessages()
    return () => { if (typingTimer.current) clearTimeout(typingTimer.current) }
  }, [fetchMessages])

  // Recover anything a dropped socket frame missed without a timer that would
  // refresh the screen on its own: re-fetch after the socket reconnects, and
  // when the app comes back to the foreground. Both are edge-triggered, so
  // neither can interrupt an open conversation.
  const { on: onSocket } = useSocket({ autoConnect: true })
  useEffect(() => {
    const offConnect = onSocket('connect', () => { void fetchMessages() })
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchMessages()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      offConnect?.()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [onSocket, fetchMessages])

  useEffect(() => {
    // Follow new messages only when the reader is already at the bottom.
    if (atBottomRef.current) scrollToBottom()
  }, [messages])

  // Grow the composer with the message (up to ~5 lines) so everything the user
  // types stays visible instead of scrolling out of a one-line field.
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  // message_sent is always-on: for a brand-new thread conversationId is still null,
  // so we MUST hear this to learn the new conversationId and reconcile the optimistic
  // message. The other listeners are scoped to the active conversation below.
  useEffect(() => {
    const offs: Array<(() => void) | undefined> = []
    offs.push(chat.listenToMessageSent((data) => {
      // Only adopt the ack's conversationId if it belongs to the thread that is
      // actually open. A late ack from a thread the user just navigated away
      // from must not yank `conversationId` back to the old conversation.
      if (data.conversationId && (!convIdRef.current || convIdRef.current === data.conversationId)) {
        convIdRef.current = data.conversationId
        setConversationId(data.conversationId)
      }
      if (data.clientId) clearPending(data.clientId)
      setMessages((prev) => {
        // Reconcile the EXACT optimistic bubble. Matching on "the last temp"
        // instead crosses ids whenever two messages are in flight, because the
        // placeholder order and the server ack order can differ.
        let idx = -1
        if (data.clientId) {
          const byClient = prev.findIndex((m) => m.id === data.clientId)
          if (byClient !== -1) idx = byClient
        }
        if (idx === -1) {
          // Older servers do not echo clientId; fall back to the last placeholder
          // so those builds still reconcile.
          const reversed = [...prev].reverse().findIndex((m) => m.id.startsWith('temp-'))
          if (reversed === -1) return prev
          idx = prev.length - 1 - reversed
        }
        const copy = [...prev]
        copy[idx] = { ...copy[idx], id: data.messageId }
        return copy
      })
    }))
    return () => offs.forEach((off) => off && off())
  }, [chat])

  // Conversation-scoped real-time listeners. Re-subscribe whenever the conversation changes.
  useEffect(() => {
    if (!conversationId) return
    const offs: Array<(() => void) | undefined> = []

    offs.push(chat.listenToMessages((data) => {
      const msgId = data.messageId || data.id
      if (!msgId) return
      // New messages are delivered to the user's room regardless of which
      // thread is open, so a message from another conversation used to appear
      // in the currently-open thread. Only render the ones for this thread.
      if (data.conversationId && data.conversationId !== conversationId) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === msgId)) return prev
        const incoming: Message = {
          id: msgId,
          senderId: data.senderId,
          content: data.content,
          status: 'SENT',
          // Live messages now carry the sender profile, same as the REST shape.
          // Without it a message that arrived over the socket had no name or
          // avatar and fell back to initials until the next refresh.
          sender: (data as any).sender,
          replyToId: (data as any).replyToId || undefined,
          replyTo: (data as any).replyTo || undefined,
          reactions: (data as any).reactions || undefined,
          createdAt:
            typeof data.timestamp === 'string'
              ? data.timestamp
              : new Date(data.timestamp || Date.now()).toISOString(),
        }
        return [...prev, incoming]
      })
    }))

    offs.push(chat.listenToMessagesRead((data) => {
      if (data.conversationId !== conversationId) return
      setMessages((prev) =>
        prev.map((m) => (data.messageIds.includes(m.id) ? { ...m, status: 'READ' } : m))
      )
    }))

    offs.push(chat.listenToMessageDeleted((data) => {
      if (data.conversationId !== conversationId) return
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, content: '[deleted]', status: 'DELETED' } : m
        )
      )
    }))

    offs.push(chat.listenToMessageReacted((data) => {
      if (data.conversationId !== conversationId) return
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions || {} } : m))
      )
      setSelectedMsg((prev) =>
        prev && prev.id === data.messageId ? { ...prev, reactions: data.reactions || {} } : prev
      )
    }))

    offs.push(chat.listenToUserTyping((data) => {
      if (data.conversationId !== conversationId || data.userId === myId) return
      setOtherTyping(true)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      typingTimer.current = setTimeout(() => setOtherTyping(false), 4000)
    }))

    offs.push(chat.listenToUserStoppedTyping((data) => {
      if (data.conversationId !== conversationId || data.userId === myId) return
      setOtherTyping(false)
    }))

    return () => offs.forEach((off) => off && off())
  }, [conversationId, chat, myId])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setText(e.target.value)
    if (conversationId) chat.setTyping(true)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      if (conversationId) chat.setTyping(false)
    }, 1500)
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !userId || chatLocked) return
    setSending(true)
    // Sending is an explicit intent to see the newest message, so follow it even
    // if the reader had scrolled up.
    atBottomRef.current = true
    // Collision-free placeholder id. `Date.now()` alone repeats when two
    // messages are sent inside the same millisecond, which would make both
    // bubbles reconcile to the same real id.
    const tempId = `temp-${Date.now()}-${tempSeq.current++}`
    const content = text
    // A placeholder has no server row yet, so replying to one would be rejected
    // by the server's same-conversation parent check. The reply button is
    // already disabled for placeholders; this is the belt-and-braces guard.
    const replyingTo = replyTarget && !replyTarget.id.startsWith('temp-') ? replyTarget : null
    if (replyTarget && !replyingTo) {
      setSending(false)
      toast.error('Wait for that message to send before replying.')
      return
    }
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        senderId: myId || 'me',
        content,
        createdAt: new Date().toISOString(),
        status: 'SENT',
        replyToId: replyingTo?.id,
        replyTo: replyingTo
          ? { id: replyingTo.id, content: replyingTo.content, senderId: replyingTo.senderId, messageType: replyingTo.messageType }
          : undefined,
      },
    ])
    setText('')
    setReplyTarget(null)
    if (conversationId) chat.setTyping(false)
    try {
      if (replyingTo) {
        // Replies go over REST so the server can validate the parent lives
        // in this conversation; realtime fan-out still happens server-side.
        const res = await api.post('/messages', { receiverId: userId, content, replyToId: replyingTo.id, clientId: tempId })
        const saved = res.data?.data?.message || res.data?.data || res.data
        const realId = saved?.id || saved?.message?.id
        if (realId) {
          clearPending(tempId)
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)))
        }
      } else if (chat.isConnected()) {
        // Real-time send. For a brand-new thread we pass receiverId so the server
        // creates the conversation; message_sent returns the real conversationId.
        // clientId lets the ack rename this exact bubble rather than "the last one".
        chat.sendMessage(content, conversationId ? undefined : userId, tempId)
        // Watchdog: if the server never acks (the socket died between the
        // isConnected() guard and the emit) drop the placeholder and say so,
        // instead of leaving a bubble that was silently never delivered.
        pendingAcks.current.set(
          tempId,
          setTimeout(() => {
            pendingAcks.current.delete(tempId)
            setMessages((prev) => (prev.some((m) => m.id === tempId) ? prev.filter((m) => m.id !== tempId) : prev))
            toast.error('Message not delivered. Check your connection and try again.')
          }, 12000)
        )
      } else {
        // The socket emit is fire-and-forget: when the socket is down it only
        // logs a warning and never throws, so the optimistic bubble would sit
        // there forever with no error and no message delivered. Fall back to the
        // REST endpoint, which authenticates and validates the same way, so a
        // dropped websocket degrades into a slower send instead of silent loss.
        const res = await api.post('/messages', { receiverId: userId, content, clientId: tempId })
        const saved = res.data?.data?.message || res.data?.data || res.data
        const realId = saved?.id || saved?.message?.id
        if (realId) {
          clearPending(tempId)
          setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, id: realId } : m)))
        }
      }
    } catch {
      clearPending(tempId)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      toast.error('Message not sent. Try again.')
    } finally {
      setSending(false)
    }
  }

  const isOwn = (senderId: string) => senderId === myId || senderId === 'me'

  const deleteSelectedMessage = async () => {
    if (!selectedMsg || modBusy) return
    setModBusy(true)
    try {
      await api.delete(`/messages/${selectedMsg.id}`)
      setMessages((prev) => prev.filter((m) => m.id !== selectedMsg.id))
      toast.success('Message deleted')
      setSelectedMsg(null)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete message'))
    } finally {
      setModBusy(false)
    }
  }

  const reportSelectedMessage = async () => {
    if (!selectedMsg || modBusy) return
    setModBusy(true)
    try {
      await api.post('/privacy/report', {
        messageId: selectedMsg.id,
        conversationId: conversationId || undefined,
        reason: reportReason,
        description: reportDesc.trim() || undefined,
      })
      toast.success('Report submitted. Our team will review it.')
      setSelectedMsg(null)
      setReportDesc('')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not submit report'))
    } finally {
      setModBusy(false)
    }
  }

  const blockPartner = async () => {
    if (modBusy || !userId) return
    setModBusy(true)
    try {
      await api.post('/privacy/block', { blockedId: userId })
      toast.success('User blocked')
      setSelectedMsg(null)
      navigate('/messages')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not block user'))
    } finally {
      setModBusy(false)
    }
  }

  const reactToMessage = async (emoji: string) => {
    if (!selectedMsg || modBusy) return
    setModBusy(true)
    try {
      const res = await api.post(`/messages/${selectedMsg.id}/react`, { emoji })
      const reactions = res.data?.data?.reactions || res.data?.reactions || {}
      setMessages((prev) => prev.map((m) => (m.id === selectedMsg.id ? { ...m, reactions } : m)))
      setSelectedMsg((prev) => (prev ? { ...prev, reactions } : prev))
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not react'))
    } finally {
      setModBusy(false)
    }
  }

  const sendMedia = async (file: File, kind: 'IMAGE' | 'VOICE') => {
    if (!userId) return
    setUploading(true)
    atBottomRef.current = true
    try {
      const form = new FormData()
      // Give the file a safe extension. The chat upload endpoint allowlists by
      // extension, and Android's document picker sometimes hands back a name
      // with none, so picking a perfectly good photo failed as an "unsupported
      // file type". The central compressor (lib/imageCompress.ts) also shrinks
      // oversized camera stills before this request leaves the client.
      const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      form.append('file', file, kind === 'IMAGE' ? `chat.${ext}` : file.name)
      const up = await api.post('/messages/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      const mediaUrl = up.data?.data?.mediaUrl || up.data?.mediaUrl
      if (!mediaUrl) throw new Error('Upload failed')
      const res = await api.post('/messages', { receiverId: userId, messageType: kind, mediaUrl, content: '' })
      const saved = res.data?.data || res.data
      setMessages((prev) => [...prev, saved?.message || saved])
      scrollToBottom()
    } catch {
      toast.error('Failed to send attachment')
    } finally {
      setUploading(false)
    }
  }

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void sendMedia(file, 'IMAGE')
  }

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size > 0) void sendMedia(new File([blob], 'voice-note.webm', { type: blob.type }), 'VOICE')
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      toast.error('Microphone access denied')
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto chat-viewport flex flex-col animate-fadeInUp">
        <div className="glass-card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-surface-800 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-32 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-1" />
            <div className="h-3 w-20 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <div className="glass-card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 font-medium mb-2">Failed to Load</p>
          <p className="text-sm text-surface-500 mb-4">{error}</p>
          <button onClick={() => navigate('/messages')} className="btn-primary btn-sm">
            Back to Messages
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto chat-viewport flex flex-col animate-fadeInUp">
      {/* Chat Header */}
      <div className="glass-card p-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/messages')}
          className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Avatar src={partnerAvatar} name={partnerName} className="w-10 h-10 rounded-2xl" textClassName="text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-surface-900 dark:text-white truncate">
            {partnerName}
          </h3>
          <p className="text-xs text-emerald-500">
            {otherTyping ? 'typing…' : 'Online'}
          </p>
        </div>
        {/* In-app calls: the chat never reveals or dials a phone number. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => startCall({ id: userId ?? '', fullName: partnerName, avatarUrl: partnerAvatar }, 'VOICE')}
            disabled={!userId}
            title={`Call ${partnerName} inside the app`}
            aria-label={`Voice call ${partnerName} inside the app`}
            className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center hover:bg-emerald-200 transition-colors disabled:opacity-50"
          >
            <Phone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </button>
          <button
            type="button"
            onClick={() => startCall({ id: userId ?? '', fullName: partnerName, avatarUrl: partnerAvatar }, 'VIDEO')}
            disabled={!userId}
            title={`Video call ${partnerName} inside the app`}
            aria-label={`Video call ${partnerName} inside the app`}
            className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center hover:bg-emerald-200 transition-colors disabled:opacity-50"
          >
            <Video className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 glass-card mt-4 overflow-hidden flex flex-col min-h-0">
        <div ref={scrollRef} onScroll={onThreadScroll} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            /* Was a grey icon, one line, and a sub-line. An empty thread is the
               first thing a new user sees on their primary Chat tab, so it now
               says what will happen and offers the action that starts it. */
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="prism-card prism-ring relative mb-5 flex h-20 w-20 items-center justify-center rounded-3xl">
                <div className="prism-aurora animate-prism-breathe opacity-60" aria-hidden />
                <MessageCircle
                  className="relative z-10 h-8 w-8 text-primary-500 dark:text-primary-300"
                  aria-hidden
                />
              </div>

              <h3 className="font-display text-lg font-bold text-surface-900 dark:text-white">
                No messages yet
              </h3>
              <p className="mt-1.5 max-w-[34ch] text-sm leading-relaxed text-surface-500 dark:text-surface-400">
                Start the conversation. Messages you send stay here, and both of you can pick up
                where you left off.
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Link
                  to="/discover"
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition active:scale-[0.97]"
                >
                  <Compass className="h-4 w-4" aria-hidden />
                  Find people
                </Link>
                <Link
                  to="/events"
                  className="inline-flex items-center gap-2 rounded-full border border-surface-200 bg-white px-5 py-2.5 text-sm font-semibold text-surface-700 transition hover:bg-surface-50 active:scale-[0.97] dark:border-surface-700 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Calendar className="h-4 w-4" aria-hidden />
                  Join an event
                </Link>
              </div>

              {/* Ask-before-you-message. Only offered for a genuinely new
                  contact: a dating match, an accepted request or an existing
                  thread already has `connected: true` and never shows this. */}
              {connection && !connection.connected && !connection.blocked && (
                <div className="mt-6 w-full max-w-[34ch] rounded-3xl border border-surface-200 bg-white p-4 text-left shadow-sm dark:border-surface-700 dark:bg-surface-800/60">
                  {connection.canSendRequest ? (
                    <>
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">
                        Want to chat? Send a request.
                      </p>
                      <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                        They can accept before either of you can message.
                      </p>
                      <input
                        value={requestNote}
                        onChange={(e) => setRequestNote(e.target.value)}
                        placeholder="Add a short note (optional)"
                        maxLength={200}
                        className="input mt-3 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void sendChatRequest()}
                        disabled={requestBusy}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                      >
                        {requestBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <UserPlus className="h-4 w-4" aria-hidden />
                        )}
                        Send chat request
                      </button>
                    </>
                  ) : connection.request?.direction === 'SENT' && connection.request.status === 'PENDING' ? (
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                      Chat request sent. You can message once they accept.
                    </p>
                  ) : connection.request?.direction === 'RECEIVED' && connection.request.status === 'PENDING' ? (
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                      This person sent you a chat request.{' '}
                      <Link to="/messages/requests" className="font-semibold text-primary-600 dark:text-primary-400">
                        Review it
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg, idx) => {
              const own = isOwn(msg.senderId)
              const showAvatar = idx === 0 || isOwn(messages[idx - 1]?.senderId) !== own
              return (
                <div key={msg.id} className={`flex ${own ? 'justify-end' : 'justify-start'} items-end gap-2 ${showAvatar ? 'mt-4' : 'mt-0.5'}`}>
                  {!own && showAvatar && (
                    <Avatar src={partnerAvatar} name={partnerName} className="w-8 h-8 rounded-xl" textClassName="text-xs" />
                  )}
                  {!own && !showAvatar && <div className="w-8 flex-shrink-0" />}
                  <div className={`max-w-[75%] group relative ${own ? 'order-1' : 'order-0'}`}>
                    <button
                      type="button"
                      disabled={msg.id.startsWith('temp-')}
                      onClick={() => setSelectedMsg(msg)}
                      className={`block w-full text-left px-4 py-2.5 rounded-2xl active:scale-[0.98] transition-transform ${
                        own
                          ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-br-md'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-white rounded-bl-md'
                      }`}
                    >
                      {msg.mediaUrl && (msg.messageType === 'IMAGE' || msg.messageType === 'VOICE') ? (
                        <div className="space-y-1.5">
                          <ChatAttachment mediaUrl={msg.mediaUrl} kind={msg.messageType} />
                          {msg.content ? <p className="text-sm leading-relaxed">{msg.content}</p> : null}
                        </div>
                      ) : (
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      )}
                      {msg.replyTo && msg.replyTo.status !== 'DELETED' && (
                        <div className={`mt-1.5 rounded-xl px-2.5 py-1.5 text-xs border-l-2 ${own ? 'border-white/50 bg-black/10' : 'border-primary-500 bg-surface-200/60 dark:bg-black/20'}`}>
                          <p className={`font-semibold ${own ? 'text-white/90' : 'text-primary-600 dark:text-primary-400'}`}>
                            {msg.replyTo.senderId === myId || msg.replyTo.senderId === 'me' ? 'You' : partnerName}
                          </p>
                          <p className={`truncate ${own ? 'text-white/80' : 'text-surface-500'}`}>
                            {msg.replyTo.content || (msg.replyTo.messageType === 'IMAGE' ? 'A photo' : 'A voice note')}
                          </p>
                        </div>
                      )}
                    </button>
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1 ${own ? 'justify-end' : 'justify-start'}`}>
                        {Object.entries(msg.reactions)
                          .filter(([, voters]) => Array.isArray(voters) && voters.length > 0)
                          .map(([key, voters]) => (
                            <span key={key} className="inline-flex items-center gap-0.5 rounded-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 px-1.5 py-0.5 text-xs">
                              {REACTION_GLYPHS[key] || key}
                              <span className="text-surface-500">{(voters as string[]).length}</span>
                            </span>
                          ))}
                      </div>
                    )}
                    <div className={`flex items-center gap-1 mt-0.5 ${own ? 'justify-end' : 'justify-start'} px-1`}>
                      <span className="text-[10px] text-surface-400">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {own && (
                        <CheckCheck className={`w-3 h-3 ${msg.status === 'READ' ? 'text-primary-500' : 'text-surface-400'}`} />
                      )}
                    </div>
                  </div>
                  {own && showAvatar && (
                    <Avatar src={user?.avatarUrl} name={user?.name} className="w-8 h-8 rounded-xl" textClassName="text-xs" />
                  )}
                  {own && !showAvatar && <div className="w-8 flex-shrink-0" />}
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message actions: delete own, report/block others */}
        {selectedMsg && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => !modBusy && setSelectedMsg(null)}>
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-surface-900 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold">Message options</h3>
                <button type="button" onClick={() => setSelectedMsg(null)} className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 rounded-2xl bg-surface-50 dark:bg-surface-800/60 px-2 py-2">
                {REACTION_KEYS.map((key) => {
                  const mine = selectedMsg.reactions?.[key]?.includes(myId || '')
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={modBusy}
                      onClick={() => reactToMessage(key)}
                      aria-label={`React ${key}`}
                      className={`text-xl leading-none p-1.5 rounded-xl transition-all hover:scale-125 disabled:opacity-50 ${mine ? 'bg-primary-500/15 ring-1 ring-primary-500/40' : ''}`}
                    >
                      {REACTION_GLYPHS[key]}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  setReplyTarget(selectedMsg)
                  setSelectedMsg(null)
                }}
                className="w-full flex items-center gap-2 rounded-2xl bg-surface-100 dark:bg-surface-800 px-4 py-3 text-sm font-semibold"
              >
                <MessageCircleReply className="w-4 h-4 text-primary-500" /> Reply to this message
              </button>
              {isOwn(selectedMsg.senderId) ? (
                <button
                  type="button"
                  onClick={deleteSelectedMessage}
                  disabled={modBusy}
                  className="w-full flex items-center gap-2 rounded-2xl bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400 disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" /> Delete this message
                </button>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-semibold text-surface-500 mb-2">Report reason</p>
                    <div className="flex flex-wrap gap-2">
                      {['Spam', 'Harassment', 'Inappropriate', 'Scam', 'Other'].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReportReason(r)}
                          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                            reportReason === r
                              ? 'bg-primary-600 text-white'
                              : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <input
                      value={reportDesc}
                      onChange={(e) => setReportDesc(e.target.value)}
                      placeholder="Details (optional)"
                      maxLength={500}
                      className="input mt-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={reportSelectedMessage}
                    disabled={modBusy}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm font-semibold text-amber-600 dark:text-amber-400 disabled:opacity-50"
                  >
                    <Flag className="w-4 h-4" /> Submit report
                  </button>
                  <button
                    type="button"
                    onClick={blockPartner}
                    disabled={modBusy}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400 disabled:opacity-50"
                  >
                    <Ban className="w-4 h-4" /> Block this user
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 pb-[max(1rem,var(--safe-bottom,0px))] border-t border-surface-100 dark:border-surface-800">
          {replyTarget && (
            <div className="mb-2 flex items-center gap-2 rounded-2xl bg-surface-100 dark:bg-surface-800 px-3 py-2">
              <div className="w-1 self-stretch rounded-full bg-primary-500 shrink-0" />
              <p className="flex-1 min-w-0 text-xs text-surface-500 truncate">
                Replying to: {replyTarget.content || (replyTarget.messageType === 'IMAGE' ? 'a photo' : 'a voice note')}
              </p>
              <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply" className="p-1 rounded-lg text-surface-400 hover:text-surface-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onPickImage} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || recording || chatLocked}
              title="Send photo"
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors disabled:opacity-50 flex-shrink-0"
            >
              {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={toggleRecording}
              disabled={uploading || chatLocked}
              title={recording ? 'Stop recording' : 'Record voice note'}
              className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors flex-shrink-0 ${recording ? 'bg-red-500 text-white animate-pulse' : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800'}`}
            >
              {recording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <div className="flex-1">
              <textarea
                ref={composerRef}
                rows={1}
                value={text}
                onChange={handleInput}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts a newline — same as the old
                  // single-line field but without clipping long messages.
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
                placeholder={chatLocked ? 'Send a chat request to start messaging' : 'Type a message...'}
                className="input max-h-[132px] resize-none overflow-y-auto py-3 leading-relaxed"
                disabled={sending || chatLocked}
              />
            </div>
            <button
              type="submit"
              disabled={!text.trim() || sending || chatLocked}
              className="w-11 h-11 rounded-2xl bg-gradient-to-r from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          {/* Server-side guard (services/piiGuard.ts) rejects these with
              PII_NOT_ALLOWED; the hint is here so people know before they hit
              a blocked send rather than learning it from an error toast. */}
          <p className="mt-2 text-center text-[11px] leading-relaxed text-surface-400 dark:text-surface-500">
            Don&rsquo;t share your phone number, OTP or address &mdash; messages with personal details are blocked.
          </p>
        </div>
      </div>
    </div>
  )
}
