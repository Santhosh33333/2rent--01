import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, MessageCircle, Plus, Users, X } from 'lucide-react'
import { chatGroupApi, type ChatGroupInviteRecord, type ChatGroupRecord } from '../../lib/api'
import { useSocket } from '../../hooks/useSocket'
import { Avatar } from '../../components/Avatar'
import { GroupMemberPicker } from '../../components/GroupMemberPicker'
import { Input, ListSkeleton, Modal, ScreenState } from '../../components/ui'
import { getErrorMessage } from '../../lib/error'

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

interface GroupsSectionProps {
  search: string
  /** Lifted so the "Groups" tab can show a pending-invitation badge. */
  onInviteCountChange?: (count: number) => void
}

/**
 * Group chat list: the groups you belong to plus any invitations waiting for an
 * answer. Kept separate from the 1:1 conversation list so the two models (and
 * their very different membership rules) never blend in the UI either.
 */
export function GroupsSection({ search, onInviteCountChange }: GroupsSectionProps) {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<ChatGroupRecord[]>([])
  const [invites, setInvites] = useState<ChatGroupInviteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyInvite, setBusyInvite] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    const [g, i] = await Promise.allSettled([chatGroupApi.list(), chatGroupApi.invites()])
    if (signal?.aborted) return
    if (g.status === 'fulfilled') setGroups(g.value.data.data.items ?? [])
    if (i.status === 'fulfilled') setInvites(i.value.data.data.items ?? [])
    setError(g.status === 'rejected' && i.status === 'rejected' ? "We couldn't load your groups." : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    onInviteCountChange?.(invites.length)
  }, [invites.length, onInviteCountChange])

  // Live refresh on group events, plus a slow safety-net poll behind the socket.
  const { on } = useSocket({ autoConnect: true })
  useEffect(() => {
    const refresh = () => void load()
    const events = [
      'chat_group_invite',
      'chat_group_added',
      'chat_group_deleted',
      'chat_group_removed',
      'chat_group_member_added',
      'chat_group_member_removed',
      'chat_group_updated',
      'group_message',
    ]
    const offs = events.map((e) => on(e, refresh))
    const poll = window.setInterval(() => {
      if (!document.hidden) refresh()
    }, 30000)
    return () => {
      offs.forEach((off) => off?.())
      window.clearInterval(poll)
    }
  }, [on, load])

  const respond = async (invite: ChatGroupInviteRecord, action: 'accept' | 'decline') => {
    if (busyInvite) return
    setBusyInvite(invite.inviteId)
    try {
      await chatGroupApi.respond(invite.inviteId, action)
      setInvites((prev) => prev.filter((i) => i.inviteId !== invite.inviteId))
      if (action === 'accept') {
        toast.success(`Joined ${invite.groupName}`)
        navigate(`/messages/group/${invite.groupId}`)
      } else {
        toast.success('Invitation declined.')
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not answer the invitation'))
    } finally {
      setBusyInvite(null)
    }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) {
      toast.error('Give the group a name')
      return
    }
    setCreating(true)
    try {
      const res = await chatGroupApi.create({ name, memberIds: newMembers })
      const id = (res.data as { data?: { id?: string } })?.data?.id
      toast.success('Group created')
      setCreateOpen(false)
      setNewName('')
      setNewMembers([])
      if (id) navigate(`/messages/group/${id}`)
      else void load()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not create the group'))
    } finally {
      setCreating(false)
    }
  }

  const filtered = groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))

  if (loading) {
    return <ListSkeleton count={4} />
  }

  if (error) {
    return (
      <ScreenState
        kind="error"
        title="Couldn't load groups"
        message={error}
        onRetry={() => void load()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-surface-900 dark:text-white">Your groups</h2>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-violet-500 to-primary-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" aria-hidden /> New group
        </button>
      </div>

      {invites.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-surface-400">Invitations</h3>
          <ul className="space-y-2">
            {invites.map((invite) => (
              <li
                key={invite.inviteId}
                className="rounded-3xl border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-500/30 dark:bg-primary-500/10"
              >
                <div className="flex items-center gap-3">
                  <Avatar
                    src={invite.groupAvatar}
                    name={invite.groupName}
                    className="h-11 w-11 rounded-2xl"
                    textClassName="text-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-surface-900 dark:text-white">{invite.groupName}</p>
                    <p className="truncate text-xs text-surface-500 dark:text-surface-400">
                      {invite.inviter?.fullName || 'Someone'} invited you · {invite.memberCount} members
                    </p>
                  </div>
                </div>
                {invite.message ? (
                  <p className="mt-2 rounded-2xl bg-white/70 px-3 py-2 text-sm text-surface-600 dark:bg-surface-900/40 dark:text-surface-300">
                    &ldquo;{invite.message}&rdquo;
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void respond(invite, 'accept')}
                    disabled={busyInvite !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" aria-hidden /> Join
                  </button>
                  <button
                    type="button"
                    onClick={() => void respond(invite, 'decline')}
                    disabled={busyInvite !== null}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-surface-200 bg-white px-4 py-2.5 text-sm font-semibold text-surface-600 transition hover:bg-surface-50 active:scale-[0.98] disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
                  >
                    <X className="h-4 w-4" aria-hidden /> Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="glass-elevated overflow-hidden divide-y divide-surface-100 dark:divide-surface-800">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Users className="mx-auto mb-2 h-6 w-6 text-surface-300" />
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">
              {search ? 'No groups match that search' : 'No groups yet'}
            </p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
              {search ? 'Try a different name' : 'Create a group and invite people to chat together.'}
            </p>
          </div>
        ) : (
          filtered.map((group) => (
            <Link
              key={group.groupId}
              to={`/messages/group/${group.groupId}`}
              className="block p-4 transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/50"
            >
              <div className="flex items-center gap-4">
                <Avatar
                  src={group.avatarUrl}
                  name={group.name}
                  className="h-12 w-12 rounded-2xl"
                  textClassName="text-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center justify-between">
                    <h3 className={`truncate text-sm font-bold ${group.unreadCount > 0 ? 'text-surface-900 dark:text-white' : 'text-surface-700 dark:text-surface-300'}`}>
                      {group.name}
                    </h3>
                    <span className="ml-2 flex items-center gap-1 text-xs text-surface-400">
                      <MessageCircle className="h-3 w-3" /> {timeAgo(group.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={`truncate text-sm ${group.unreadCount > 0 ? 'font-medium text-surface-700 dark:text-surface-300' : 'text-surface-500 dark:text-surface-400'}`}>
                      {group.lastMessage
                        ? `${group.lastSenderName ? `${group.lastSenderName.split(' ')[0]}: ` : ''}${group.lastMessage}`
                        : `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
                    </p>
                    <div className="ml-2 flex items-center gap-2">
                      {group.unreadCount > 0 && (
                        <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-500 px-1.5 text-xs font-bold text-white">
                          {group.unreadCount > 99 ? '99+' : group.unreadCount}
                        </span>
                      )}
                      <span className="text-[11px] text-surface-400">{group.memberCount} members</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New group"
        description="Name the group, add people, and invite more later."
        footer={
          <>
            <button type="button" onClick={() => setCreateOpen(false)} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button type="button" onClick={() => void create()} disabled={creating} className="btn btn-primary btn-sm">
              {creating ? 'Creating…' : 'Create group'}
            </button>
          </>
        }
      >
        <label className="mb-1.5 block text-xs font-semibold text-surface-500 dark:text-surface-400">Group name</label>
        <Input
          autoFocus
          value={newName}
          maxLength={60}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="e.g. Movie night crew"
        />

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs font-semibold text-surface-500 dark:text-surface-400">
            {newMembers.length > 0 ? `${newMembers.length} selected` : 'Add people (optional)'}
          </p>
          <button type="button" onClick={() => setPickerOpen(true)} className="text-xs font-semibold text-primary-600 dark:text-primary-300">
            + Add people
          </button>
        </div>
        {newMembers.length > 0 && (
          <p className="mt-1 text-xs text-surface-400">
            They are added straight to the group. Anyone can also be invited later, and they accept first.
          </p>
        )}
      </Modal>

      <GroupMemberPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(ids) => {
          setNewMembers((prev) => [...new Set([...prev, ...ids])])
          setPickerOpen(false)
        }}
        title="Add people to the group"
        confirmLabel="Add"
      />
    </div>
  )
}
