import { Router } from 'express'
import { authenticateToken } from '../middleware/auth'
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  registerDevice,
} from '../controllers/notificationController'

const router = Router()

// All notification endpoints require an authenticated user
router.use(authenticateToken)

/**
 * Get user notifications with pagination and filtering
 * GET /notifications?page=1&limit=20&read=false
 */
router.get('/', getNotifications)

/**
 * Mark a specific notification as read
 * POST /notifications/:id/read
 */
router.post('/:id/read', markAsRead)

/**
 * Mark all unread notifications as read
 * POST /notifications/mark-all-read
 */
router.post('/mark-all-read', markAllAsRead)

/**
 * Register / refresh a device push token (mobile calls on launch + refresh)
 * POST /notifications/device { deviceType, fcmToken, deviceToken?, name? }
 */
router.post('/device', registerDevice)

/**
 * Delete a specific notification
 * DELETE /notifications/:id
 */
router.delete('/:id', deleteNotification)

/**
 * Clear all read notifications
 * DELETE /notifications/clear-read
 */
router.delete('/clear-read', clearReadNotifications)

export default router
