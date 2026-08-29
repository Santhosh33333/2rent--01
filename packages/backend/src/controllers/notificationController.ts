import { Response } from 'express'
import { prisma } from '../config/database'
import { sendPushNotification } from '../services/notificationService'
import { AuthedRequest } from '../middleware/authTypes'

/**
 * Get user notifications with pagination
 * GET /notifications?page=1&limit=20&read=false
 */
export async function getNotifications(req: AuthedRequest, res: Response) {
  try {
    const userId = req.user!.userId
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const { page = 1, limit = 20, read } = req.query
    const pageNum = Math.max(1, Number(page) || 1)
    const limitNum = Math.min(100, Number(limit) || 20)
    const skip = (pageNum - 1) * limitNum

    // Build where clause
    const where: any = { userId }
    if (read === 'true') where.isRead = true
    else if (read === 'false') where.isRead = false

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        skip,
      }),
      prisma.notification.count({ where }),
    ])

    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    })

    return res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
        unreadCount,
      },
    })
  } catch (error) {
    console.error('Get notifications error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Mark notification as read
 * POST /notifications/:id/read
 */
export async function markAsRead(req: AuthedRequest, res: Response) {
  try {
    const userId = req.user!.userId
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const { id } = req.params

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' })
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return res.json({ success: true, data: updated })
  } catch (error) {
    console.error('Mark as read error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Mark all notifications as read
 * POST /notifications/mark-all-read
 */
export async function markAllAsRead(req: AuthedRequest, res: Response) {
  try {
    const userId = req.user!.userId
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })

    return res.json({
      success: true,
      data: { updated: result.count },
    })
  } catch (error) {
    console.error('Mark all as read error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Delete a notification
 * DELETE /notifications/:id
 */
export async function deleteNotification(req: AuthedRequest, res: Response) {
  try {
    const userId = req.user!.userId
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const { id } = req.params

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' })
    }

    await prisma.notification.delete({ where: { id } })

    return res.json({ success: true, message: 'Notification deleted' })
  } catch (error) {
    console.error('Delete notification error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Clear all read notifications
 * DELETE /notifications/clear-read
 */
export async function clearReadNotifications(req: AuthedRequest, res: Response) {
  try {
    const userId = req.user!.userId
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' })
    }

    const result = await prisma.notification.deleteMany({
      where: { userId, isRead: true },
    })

    return res.json({
      success: true,
      data: { deleted: result.count },
    })
  } catch (error) {
    console.error('Clear read notifications error:', error)
    return res.status(500).json({
      success: false,
      message: 'Failed to clear notifications',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

/**
 * Internal: Create notification for user
 * Used by other controllers
 */
export async function createNotification(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, any>
) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: data ? JSON.stringify(data) : null,
        isRead: false,
      },
    })
  } catch (error) {
    console.error('Create notification error:', error)
    return null
  }
}

/**
 * Internal: Send booking status notifications
 */
export async function notifyBookingStatusChange(
  bookingId: string,
  userId: string,
  status: string
) {
  const messages: Record<string, { title: string; body: string }> = {
    PENDING: {
      title: 'Booking Confirmed',
      body: 'Your booking has been received and is pending partner confirmation',
    },
    CONFIRMED: {
      title: 'Booking Confirmed',
      body: 'Your booking has been confirmed by the system',
    },
    PARTNER_ACCEPTED: {
      title: 'Partner Accepted',
      body: 'A partner has accepted your booking request',
    },
    IN_PROGRESS: {
      title: 'Booking Started',
      body: 'Your booking has started. Track your partner in real-time',
    },
    COMPLETED: {
      title: 'Booking Completed',
      body: 'Your booking has been completed. Please rate your partner',
    },
    CANCELLED: {
      title: 'Booking Cancelled',
      body: 'Your booking has been cancelled',
    },
    PAYMENT_PENDING: {
      title: 'Payment Required',
      body: 'Your booking is awaiting payment completion',
    },
  }

  const msg = messages[status]
  if (!msg) return

  void sendPushNotification(userId, msg.title, msg.body, { bookingId, status })

  return createNotification(
    userId,
    msg.title,
    msg.body,
    { bookingId, status }
  )
}

/**
 * Internal: Send event notifications
 */
export async function notifyEventUpdate(
  eventId: string,
  eventName: string,
  type: string,
  userIds: string[]
) {
  const messages: Record<string, { title: string; body: string }> = {
    EVENT_CREATED: {
      title: 'New Event',
      body: `A new event "${eventName}" has been created in your community`,
    },
    EVENT_UPDATED: {
      title: 'Event Updated',
      body: `The event "${eventName}" has been updated`,
    },
    EVENT_CANCELLED: {
      title: 'Event Cancelled',
      body: `The event "${eventName}" has been cancelled`,
    },
    UPCOMING_EVENT: {
      title: 'Event Starting Soon',
      body: `The event "${eventName}" starts in 24 hours`,
    },
  }

  const msg = messages[type]
  if (!msg) return

  return Promise.all(
    userIds.map(userId =>
      createNotification(
        userId,
        msg.title,
        msg.body,
        { eventId, type }
      )
    )
  )
}

/**
 * Internal: Send community notifications
 */
export async function notifyCommunityUpdate(
  communityId: string,
  communityName: string,
  type: string,
  userIds: string[]
) {
  const messages: Record<string, { title: string; body: string }> = {
    MEMBER_JOINED: {
      title: 'New Member Joined',
      body: `A new member has joined "${communityName}"`,
    },
    NEW_POST: {
      title: 'New Post',
      body: `A new post has been shared in "${communityName}"`,
    },
    COMMUNITY_UPDATED: {
      title: 'Community Updated',
      body: `"${communityName}" has been updated with new details`,
    },
  }

  const msg = messages[type]
  if (!msg) return

  return Promise.all(
    userIds.map(userId =>
      createNotification(
        userId,
        msg.title,
        msg.body,
        { communityId, type }
      )
    )
  )
}
