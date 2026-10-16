import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  LogOut,
  Send,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  api,
  assetUrl,
  chatGroupApi,
  type ChatGroupDetail,
  type ChatGroupMessageRecord,
} from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useSocket } from '../../hooks/useSocket'
import { Avatar } from '../../components/Avatar'
import { GroupMemberPicker } from '../../components/GroupMemberPicker'
import { Modal, ScreenState } from '../../components/ui'
import { getErrorMessage } from '../../lib/error'

/** Media bubble: fetches the blob through the authenticated client (mirrors the
 *  1:1 ConversationPage attachment handling). */
function GroupAttachment({ mediaUrl, kind }: { mediaUrl: string; kind: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const resolved = assetUrl(mediaUrl)
  useEffect(() => {
    let alive = true
    let objectUrl: string | null = null
    if (!resolved) {
      setFailed(true)
      return
    }
    apiGet(resolved)
      .then((blob) => {
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [resolved])
  if (failed) return <p className="text-xs opacity-70">Attachment unavailable</p>
  if (!src) return <Loader2 className="h-4 w-4 animate-spin" />
  if (kind === 'IMAGE') {
    return <img src={src} alt="Shared" className="max-h-64 max-w-full rounded-xl object-cover" />
  }
  return <audio controls src={src} className="max-w-full" />
}

async function apiGet(url: string): Promise<Blob> {
  const res = await api.get(url, { responseType: 'blob' })
  return res.data as Blob
}

export function GroupChatPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id

  const [group, setGroup] = useState<ChatGroupDetail | null>(null)
  const [messages, setMessages] = useState<ChatGroupMessageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [typingNames, setTypingNames] = useState<Record<string, string>>({})
  const [membersOpen, setMembersOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const { on, emit } = useSocket({ autoConnect: true })

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!groupId) return
      try {
        const [detail, msgs] = await Promise.all([
          chatGroupApi.detail(groupId),
          chatGroupApi.messages(groupId, 1, 100),
        ])
        if (signal?.aborted) return
        setGroup(detail.data.data)
        setMessages(msgs.data.data.items ?? [])
        setError(null)
      } catch (err) {
        if (!signal?.aborted) setError(getErrorMessage(err, "We couldn't open this group."))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [groupId],
  )

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    void load(controller.signal).then(scrollToBottom)
    return () => controller.abort()
  }, [load, scrollToBottom])

  // Join the group's realtime room for typing indicators; leave on unmount.
  // Re-joins on (re)connect, because the first emit can fire before the socket
  // is up — a room that is never joined drops every typing indicator.
  useEffect(() => {
    if (!groupId) return
    emit('join_group', groupId)
    const off = on('connect', () => emit('join_group', groupId))
    return () => {
      off?.()
      emit('leave_group', groupId)
    }
  }, [groupId, emit, on])

  useEffect(() => {
    if (!groupId) return
    const offMessage = on('group_message', (data: unknown) => {
      const msg = data as ChatGroupMessageRecord
      if (!msg || msg.groupId !== groupId) return
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, { ...msg, isMine: msg.sender?.id === myId }]))
      scrollToBottom()
      chatGroupApi.markRead(groupId).catch(() => {})
    })
    const offDeleted = on('group_message_deleted', (data: unknown) => {
      const { groupId: gid, messageId } = (data || {}) as { groupId?: string; messageId?: string }
      if (gid !== groupId) return
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, content: '[deleted]', mediaUrl: null, status: 'DELETED' } : m)),
      )
    })
    const offTyping = on('group_user_typing', (data: unknown) => {
      const { groupId: gid, userId: uid } = (data || {}) as { groupId?: string; userId?: string }
      if (gid !== groupId || !uid || uid === myId) return
      setTypingNames((prev) => ({ ...prev, [uid]: prev[uid] || 'Someone' }))
    })
    const offStop = on('group_user_stopped_typing', (data: unknown) => {
      const { groupId: gid, userId: uid } = (data || {}) as { groupId?: string; userId?: string }
      if (gid !== groupId || !uid) return
      setTypingNames((prev) => {
        const next = { ...prev }
        delete next[uid]
        return next
      })
    })
    const offMembers = on('chat_group_member_added', () => void load())
    const offRemoved = on('chat_group_member_removed', () => void load())
    return () => {
      offMessage?.()
      offDeleted?.()
      offTyping?.()
      offStop?.()
      offMembers?.()
      offRemoved?.()
    }
  }, [groupId, myId, on, scrollToBottom, load])

  const send = async () => {
    const content = input.trim()
    if (!content || !groupId || sending) return
    setSending(true)
    setInput('')
    try {
      const res = await chatGroupApi.send(groupId, { content })
      const saved = res.data.data
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, { ...saved, isMine: true }]))
      scrollToBottom()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Message not sent'))
      setInput(content)
    } finally {
      setSending(false)
      emit('group_stop_typing', groupId)
    }
  }

  const sendImage = async (file: File) => {
    if (!groupId) return
    setUploading(true)
    try {
      const form = new FormData()
      const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      form.append('file', file, `chat.${ext}`)
      const up = await api.post('/messages/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      const mediaUrl = up.data?.data?.mediaUrl || up.data?.mediaUrl
      if (!mediaUrl) throw new Error('Upload failed')
      const res = await chatGroupApi.send(groupId, { messageType: 'IMAGE', mediaUrl, content: '' })
      const saved = res.data.data
      setMessages((prev) => [...prev, { ...saved, isMine: true }])
      scrollToBottom()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the photo'))
    } finally {
      setUploading(false)
    }
  }

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void sendImage(file)
  }

  const removeMessage = async (id: string) => {
    if (!groupId) return
    try {
      await chatGroupApi.removeMessage(groupId, id)
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: '[deleted]', mediaUrl: null, status: 'DELETED' } : m)))
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete the message'))
    }
  }

  const invite = async (userIds: string[]) => {
    if (!groupId) return
    setInviting(true)
    try {
      await chatGroupApi.invite(groupId, userIds)
      toast.success(userIds.length === 1 ? 'Invitation sent' : 'Invitations sent')
      setPickerOpen(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the invitation'))
    } finally {
      setInviting(false)
    }
  }

  const removeMember = async (userId: string) => {
    if (!groupId || leaving) return
    setLeaving(true)
    try {
      await chatGroupApi.removeMember(groupId, userId)
      await load()
      toast.success('Member removed')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not remove the member'))
    } finally {
      setLeaving(false)
    }
  }

  const leave = async () => {
    if (!groupId || leaving) return
    setLeaving(true)
    try {
      await chatGroupApi.leave(groupId)
      toast.success('You left the group')
      navigate('/messages?tab=groups')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not leave the group'))
      setLeaving(false)
    }
  }

  const deleteGroup = async () => {
    if (!groupId || leaving) return
    setLeaving(true)
    try {
      await chatGroupApi.remove(groupId)
      toast.success('Group deleted')
      navigate('/messages?tab=groups')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete the group'))
      setLeaving(false)
    }
  }

  const canManage = group?.myRole === 'OWNER' || group?.myRole === 'ADMIN'
  const existingMemberIds = useMemo(() => group?.members.map((m) => m.userId) ?? [], [group])
  const typingList = Object.values(typingNames)

  if (loading) {
    return (
      <div className="mx-auto flex h-[70vh] max-w-3xl items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <ScreenState
          kind="error"
          title="Group unavailable"
          message={error || 'This group could not be opened.'}
          onRetry={() => void load()}
        />
        <div className="mt-4 text-center">
          <Link to="/messages" className="text-sm font-semibold text-primary-600 dark:text-primary-300">
            Back to messages
          </Link>
        </div>
      </div>
    )
  }

  // chat-viewport is the same derived height the 1:1 thread uses: the old
  // `100vh-8rem` was ~6.5rem taller than the space the shell leaves on a phone,
  // so the composer sat below the fold and behind the tab bar.
  return (
    <div className="mx-auto flex max-w-3xl flex-col chat-viewport">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-surface-200 pb-3 dark:border-surface-800">
        <Link
          to="/messages?tab=groups"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <button type="button" onClick={() => setMembersOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <Avatar src={group.avatarUrl} name={group.name} className="h-11 w-11 rounded-2xl" textClassName="text-sm" />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-surface-900 dark:text-white">{group.name}</p>
            <p className="truncate text-xs text-surface-500 dark:text-surface-400">
              {typingList.length > 0
                ? `${typingList.slice(0, 2).join(', ')} ${typingList.length === 1 ? 'is' : 'are'} typing…`
                : `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-700 transition hover:bg-primary-500/25 dark:text-primary-300"
          aria-label="Invite people"
        >
          <UserPlus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => setMembersOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Members"
        >
          <Users className="h-5 w-5" />
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-surface-300" />
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">No messages yet</p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">Say hello to the group.</p>
          </div>
        ) : (
          messages.map((msg) => {
            const mine = msg.isMine || msg.sender?.id === myId
            const deleted = msg.status === 'DELETED'
            return (
              <div key={msg.id} className={`group flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                {!mine && (
                  <Avatar
                    src={msg.sender?.avatarUrl}
                    name={msg.sender?.fullName}
                    className="h-8 w-8 flex-shrink-0 rounded-full"
                    textClassName="text-[10px]"
                  />
                )}
                <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!mine && (
                    <span className="mb-0.5 px-1 text-[11px] font-semibold text-surface-500 dark:text-surface-400">
                      {msg.sender?.fullName || 'Member'}
                    </span>
                  )}
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? 'bg-gradient-to-br from-violet-500 to-primary-600 text-white'
                        : 'bg-surface-100 text-surface-800 dark:bg-surface-800 dark:text-surface-100'
                    } ${deleted ? 'italic opacity-70' : ''}`}
                  >
                    {msg.mediaUrl && (msg.messageType === 'IMAGE' || msg.messageType === 'VOICE') ? (
                      <GroupAttachment mediaUrl={msg.mediaUrl} kind={msg.messageType} />
                    ) : (
                      <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                    )}
                  </div>
                </div>
                {mine && !deleted && (
                  <button
                    type="button"
                    onClick={() => void removeMessage(msg.id)}
                    className="mb-1 opacity-0 transition group-hover:opacity-100"
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-surface-400 hover:text-red-500" />
                  </button>
                )}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-surface-200 pt-3 dark:border-surface-800">
        <label className="flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          <input type="file" accept="image/*" className="hidden" onChange={onPickImage} disabled={uploading} />
        </label>
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (groupId) emit('group_typing', groupId)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Message the group…"
          className="input flex-1"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !input.trim()}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 text-white transition active:scale-[0.98] disabled:opacity-50"
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
      {/* Mirrors the 1:1 composer hint: the group send path runs the same
          server-side personal-data guard, so say so before the first attempt. */}
      <p className="mt-2 pb-[var(--safe-bottom,0px)] text-center text-[11px] leading-relaxed text-surface-400 dark:text-surface-500">
        Don&rsquo;t share your phone number, OTP or address &mdash; messages with personal details are blocked.
      </p>

      {/* Members / actions */}
      <Modal open={membersOpen} onClose={() => setMembersOpen(false)} title={group.name} description={`${group.memberCount} members`}>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {group.members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 rounded-2xl px-2 py-2">
              <Avatar src={m.user?.avatarUrl} name={m.user?.fullName} className="h-10 w-10 rounded-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                  {m.user?.fullName || 'Nabri member'}
                  {m.userId === myId ? ' (you)' : ''}
                </p>
                <p className="text-xs capitalize text-surface-400">{m.role.toLowerCase()}</p>
              </div>
              {canManage && m.role !== 'OWNER' && m.userId !== myId && (
                <button
                  type="button"
                  onClick={() => void removeMember(m.userId)}
                  disabled={leaving}
                  className="rounded-full px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => setPickerOpen(true)} className="btn btn-primary btn-sm">
            <UserPlus className="h-4 w-4" /> Invite people
          </button>
          <button type="button" onClick={() => void leave()} disabled={leaving} className="btn btn-ghost btn-sm">
            <LogOut className="h-4 w-4" /> Leave group
          </button>
          {group.myRole === 'OWNER' && (
            <button
              type="button"
              onClick={() => void deleteGroup()}
              disabled={leaving}
              className="btn btn-sm text-red-600 hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete group
            </button>
          )}
        </div>
      </Modal>

      <GroupMemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => void invite(ids)}
        title={`Invite to ${group.name}`}
        excludeIds={existingMemberIds}
        confirmLabel="Invite"
        busy={inviting}
      />
    </div>
  )
}

export default GroupChatPage
