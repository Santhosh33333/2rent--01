import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Send, Loader2, AlertTriangle,
  MoreVertical, Phone, Video,
  CheckCheck, MessageCircle
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useChat } from '../../hooks/useSocket'

interface Message {
  id: string
  senderId: string
  receiverId?: string
  content: string
  status?: string
  createdAt: string
  sender?: { fullName: string; avatarUrl?: string }
}

export function ConversationPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id

  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [partnerName, setPartnerName] = useState<string>('Chat')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [otherTyping, setOtherTyping] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const convIdRef = useRef<string | null>(null)
  const chat = useChat(conversationId ?? '')
  const chatRef = useRef(chat)
  chatRef.current = chat

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => { convIdRef.current = conversationId }, [conversationId])

  // Initial load + safety-net poll (every 15s). Real-time socket events update the
  // list immediately; the poll only catches anything a dropped socket frame missed.
  const fetchMessages = useCallback(async () => {
    if (!userId) return
    try {
      const response = await api.get(`/messages/${userId}`)
      const result = response.data
      if (result.success) {
        const items: Message[] = result.data?.items || []
        const cid = (items as any[]).find((m: any) => m.conversationId)?.conversationId
        if (cid) {
          convIdRef.current = cid
          setConversationId((prev) => prev ?? cid)
        }
        const theirs = items.find((m) => m.senderId === userId && (m as any).sender?.fullName)
        if (theirs) setPartnerName((theirs as any).sender.fullName)

        setMessages((prev) => {
          const serverIds = new Set(items.map((m) => m.id))
          const temps = prev.filter((m) => m.id.startsWith('temp-'))
          const merged = [...items]
          for (const t of temps) if (!serverIds.has(t.id)) merged.push(t)
          return merged
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
    const poll = setInterval(fetchMessages, 15000)
    return () => { clearInterval(poll); if (typingTimer.current) clearTimeout(typingTimer.current) }
  }, [fetchMessages])

  useEffect(() => { scrollToBottom() }, [messages])

  // message_sent is always-on: for a brand-new thread conversationId is still null,
  // so we MUST hear this to learn the new conversationId and reconcile the optimistic
  // message. The other listeners are scoped to the active conversation below.
  useEffect(() => {
    const offs: Array<(() => void) | undefined> = []
    offs.push(chat.listenToMessageSent((data) => {
      if (data.conversationId) {
        convIdRef.current = data.conversationId
        setConversationId((prev) => prev ?? data.conversationId)
      }
      setMessages((prev) => {
        const idx = [...prev].reverse().findIndex((m) => m.id.startsWith('temp-'))
        if (idx === -1) return prev
        const realIdx = prev.length - 1 - idx
        const copy = [...prev]
        copy[realIdx] = { ...copy[realIdx], id: data.messageId }
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
      setMessages((prev) => {
        if (prev.some((m) => m.id === msgId)) return prev
        const incoming: Message = {
          id: msgId,
          senderId: data.senderId,
          content: data.content,
          status: 'SENT',
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

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
    if (conversationId) chat.setTyping(true)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      if (conversationId) chat.setTyping(false)
    }, 1500)
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !userId) return
    setSending(true)
    const tempId = `temp-${Date.now()}`
    const content = text
    setMessages((prev) => [
      ...prev,
      { id: tempId, senderId: myId || 'me', content, createdAt: new Date().toISOString(), status: 'SENT' },
    ])
    setText('')
    if (conversationId) chat.setTyping(false)
    try {
      // Real-time send. For a brand-new thread we pass receiverId so the server
      // creates the conversation; message_sent returns the real conversationId.
      chat.sendMessage(content, conversationId ? undefined : userId)
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    } finally {
      setSending(false)
    }
  }

  const isOwn = (senderId: string) => senderId === myId || senderId === 'me'

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto h-[calc(100vh-12rem)] flex flex-col animate-fadeInUp">
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
    <div className="max-w-3xl mx-auto h-[calc(100vh-12rem)] flex flex-col animate-fadeInUp">
      {/* Chat Header */}
      <div className="glass-card p-4 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/messages')}
          className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
          {partnerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-surface-900 dark:text-white truncate">
            {partnerName}
          </h3>
          <p className="text-xs text-emerald-500">
            {otherTyping ? 'typing…' : 'Online'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-9 h-9 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center justify-center text-surface-500 dark:text-surface-400 transition-colors">
            <Phone className="w-4 h-4" />
          </button>
          <button className="w-9 h-9 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center justify-center text-surface-500 dark:text-surface-400 transition-colors">
            <Video className="w-4 h-4" />
          </button>
          <button className="w-9 h-9 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 flex items-center justify-center text-surface-500 dark:text-surface-400 transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 glass-card mt-4 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 flex items-center justify-center mb-4">
                <MessageCircle className="w-8 h-8 text-primary-500/50" />
              </div>
              <p className="text-surface-500 dark:text-surface-400 font-medium">No messages yet</p>
              <p className="text-sm text-surface-400 dark:text-surface-500 mt-1">
                Send a message to start the conversation
              </p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const own = isOwn(msg.senderId)
              const showAvatar = idx === 0 || isOwn(messages[idx - 1]?.senderId) !== own
              return (
                <div key={msg.id} className={`flex ${own ? 'justify-end' : 'justify-start'} items-end gap-2 ${showAvatar ? 'mt-4' : 'mt-0.5'}`}>
                  {!own && showAvatar && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 text-xs font-semibold flex-shrink-0">
                      {partnerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
                    </div>
                  )}
                  {!own && !showAvatar && <div className="w-8 flex-shrink-0" />}
                  <div className={`max-w-[75%] group relative ${own ? 'order-1' : 'order-0'}`}>
                    <div className={`px-4 py-2.5 rounded-2xl ${
                      own
                        ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-br-md'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-white rounded-bl-md'
                    }`}>
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    </div>
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
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 text-xs font-semibold flex-shrink-0">
                      {user?.name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2) || 'M'}
                    </div>
                  )}
                  {own && !showAvatar && <div className="w-8 flex-shrink-0" />}
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-surface-100 dark:border-surface-800">
          <form onSubmit={sendMessage} className="flex items-end gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={text}
                onChange={handleInput}
                placeholder="Type a message..."
                className="input pr-20 py-3"
                disabled={sending}
              />
              <div className="absolute right-2 bottom-1/2 translate-y-1/2 flex items-center gap-1">
              </div>
            </div>
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="w-11 h-11 rounded-2xl bg-gradient-to-r from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
