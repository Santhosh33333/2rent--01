/**
 * Integration Tests for RentBuddy
 * Tests core user flows: KYC, Search, Notifications, Bookings, Wallet
 * Run with: npx ts-node tests/integration.test.ts
 */

import axios, { AxiosInstance } from 'axios'

const API_URL = process.env.API_URL || 'http://localhost:3000/api'
const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  validateStatus: () => true, // Don't throw on any status
})

// Test state
let authToken: string
let userId: string
let partnerId: string
let bookingId: string
let notificationId: string

// Test utilities
const log = (test: string, result: boolean, message?: string) => {
  const icon = result ? '✓' : '✗'
  console.log(`${icon} ${test}${message ? ': ' + message : ''}`)
}

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

// ============== AUTH & USER TESTS ==============

async function testAuthFlow() {
  console.log('\n=== Testing Auth Flow ===')
  
  try {
    // Register
    const registerRes = await api.post('/auth/register', {
      email: `test-${Date.now()}@rentbuddy.com`,
      password: 'Test@1234',
      name: 'Test User',
      phone: '+91-9999999999',
    })
    log('Register user', registerRes.status === 201, `Status: ${registerRes.status}`)
    
    if (registerRes.data?.data?.accessToken) {
      authToken = registerRes.data.data.accessToken
      userId = registerRes.data.data.user?.id
    }

    // Login
    const loginRes = await api.post('/auth/login', {
      email: registerRes.data?.data?.user?.email,
      password: 'Test@1234',
    })
    log('Login user', loginRes.status === 200, `Status: ${loginRes.status}`)
    
    if (loginRes.data?.data?.accessToken) {
      authToken = loginRes.data.data.accessToken
      api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`
    }

    // Get profile
    const profileRes = await api.get('/users/profile')
    log('Get user profile', profileRes.status === 200, `Status: ${profileRes.status}`)
    
  } catch (error: any) {
    log('Auth flow', false, error.message)
  }
}

// ============== KYC TESTS ==============

async function testKycFlow() {
  console.log('\n=== Testing KYC Flow ===')
  
  if (!authToken) {
    log('KYC flow', false, 'No auth token')
    return
  }

  try {
    // Start verification
    const startRes = await api.post('/verification/start', {})
    log('Start verification', startRes.status === 200, `Status: ${startRes.status}`)

    // Get verification status
    const statusRes = await api.get('/verification/status')
    log('Get verification status', statusRes.status === 200, `Status: ${statusRes.status}`)
    
    // Submit personal details (step 1)
    const step1Res = await api.post('/verification/step1', {
      firstName: 'Test',
      lastName: 'User',
      dateOfBirth: '1990-01-01',
      gender: 'MALE',
      nationality: 'INDIAN',
    })
    log('Submit KYC step 1 (personal details)', step1Res.status === 200, `Status: ${step1Res.status}`)

    // Submit gov ID (step 2)
    const step2Res = await api.post('/verification/step2', {
      idType: 'AADHAR',
      idNumber: '123456789012',
      documentUrl: 'https://example.com/aadhar.jpg',
    })
    log('Submit KYC step 2 (gov ID)', step2Res.status === 200, `Status: ${step2Res.status}`)

    // Submit selfie (step 3)
    const step3Res = await api.post('/verification/step3', {
      selfieUrl: 'https://example.com/selfie.jpg',
    })
    log('Submit KYC step 3 (selfie)', step3Res.status === 200, `Status: ${step3Res.status}`)

    // Submit address (step 4)
    const step4Res = await api.post('/verification/step4', {
      addressType: 'CURRENT',
      address: '123 Test Street',
      city: 'Mumbai',
      state: 'MH',
      zipCode: '400001',
      country: 'INDIA',
      documentUrl: 'https://example.com/address.jpg',
    })
    log('Submit KYC step 4 (address)', step4Res.status === 200, `Status: ${step4Res.status}`)

    // Submit emergency contact (step 5)
    const step5Res = await api.post('/verification/step5', {
      contactName: 'Emergency Contact',
      relationship: 'FAMILY',
      phone: '+91-9999999998',
    })
    log('Submit KYC step 5 (emergency contact)', step5Res.status === 200, `Status: ${step5Res.status}`)

    // Review and submit (step 6)
    const step6Res = await api.post('/verification/step6', {
      agreeToTerms: true,
      agreeToPrivacy: true,
    })
    log('Submit KYC step 6 (review)', step6Res.status === 200, `Status: ${step6Res.status}`)

  } catch (error: any) {
    log('KYC flow', false, error.message)
  }
}

// ============== SEARCH TESTS ==============

async function testSearchFlow() {
  console.log('\n=== Testing Search Flow ===')
  
  if (!authToken) {
    log('Search flow', false, 'No auth token')
    return
  }

  try {
    // Global search
    const searchRes = await api.get('/search', {
      params: { q: 'test', type: 'all', limit: 10 }
    })
    log('Global search', searchRes.status === 200, `Status: ${searchRes.status}`)

    // Get trending
    const trendingRes = await api.get('/search/trending', {
      params: { limit: 10 }
    })
    log('Get trending search results', trendingRes.status === 200, `Status: ${trendingRes.status}`)

    // Get suggestions
    const suggestRes = await api.get('/search/suggest', {
      params: { q: 'test', limit: 5 }
    })
    log('Get search suggestions', suggestRes.status === 200, `Status: ${suggestRes.status}`)

  } catch (error: any) {
    log('Search flow', false, error.message)
  }
}

// ============== NOTIFICATION TESTS ==============

async function testNotificationFlow() {
  console.log('\n=== Testing Notification Flow ===')
  
  if (!authToken) {
    log('Notification flow', false, 'No auth token')
    return
  }

  try {
    // Get notifications
    const getRes = await api.get('/notifications', {
      params: { limit: 50 }
    })
    log('Get notifications', getRes.status === 200, `Status: ${getRes.status}`)

    const notifications = getRes.data?.data?.notifications || []
    if (notifications.length > 0) {
      notificationId = notifications[0].id

      // Mark as read
      const readRes = await api.post(`/notifications/${notificationId}/read`)
      log('Mark notification as read', readRes.status === 200, `Status: ${readRes.status}`)

      // Delete notification
      const deleteRes = await api.delete(`/notifications/${notificationId}`)
      log('Delete notification', deleteRes.status === 200, `Status: ${deleteRes.status}`)
    }

    // Mark all as read
    const markAllRes = await api.post('/notifications/mark-all-read')
    log('Mark all notifications as read', markAllRes.status === 200, `Status: ${markAllRes.status}`)

    // Clear read notifications
    const clearRes = await api.delete('/notifications/clear-read')
    log('Clear read notifications', clearRes.status === 200, `Status: ${clearRes.status}`)

  } catch (error: any) {
    log('Notification flow', false, error.message)
  }
}

// ============== WALLET TESTS ==============

async function testWalletFlow() {
  console.log('\n=== Testing Wallet Flow ===')
  
  if (!authToken) {
    log('Wallet flow', false, 'No auth token')
    return
  }

  try {
    // Get wallet
    const walletRes = await api.get('/wallet')
    log('Get wallet', walletRes.status === 200, `Status: ${walletRes.status}`)

    // Add money (mock payment)
    const topupRes = await api.post('/wallet/topup', {
      amount: 500,
      paymentMethod: 'CARD',
      orderId: `order_${Date.now()}`,
    })
    log('Top up wallet', topupRes.status === 200, `Status: ${topupRes.status}`)

    // Get transactions
    const txRes = await api.get('/wallet/transactions', {
      params: { limit: 10 }
    })
    log('Get transaction history', txRes.status === 200, `Status: ${txRes.status}`)

  } catch (error: any) {
    log('Wallet flow', false, error.message)
  }
}

// ============== COMMUNITY TESTS ==============

async function testCommunityFlow() {
  console.log('\n=== Testing Community Flow ===')
  
  if (!authToken) {
    log('Community flow', false, 'No auth token')
    return
  }

  try {
    // Get communities
    const getRes = await api.get('/communities', {
      params: { limit: 10 }
    })
    log('Get communities', getRes.status === 200, `Status: ${getRes.status}`)

    if (getRes.data?.data?.length > 0) {
      const communityId = getRes.data.data[0].id

      // Get community detail
      const detailRes = await api.get(`/communities/${communityId}`)
      log('Get community detail', detailRes.status === 200, `Status: ${detailRes.status}`)

      // Join community
      const joinRes = await api.post(`/communities/${communityId}/join`)
      log('Join community', joinRes.status === 200 || joinRes.status === 400, `Status: ${joinRes.status}`)

      // Get members
      const membersRes = await api.get(`/communities/${communityId}/members`)
      log('Get community members', membersRes.status === 200, `Status: ${membersRes.status}`)
    }

  } catch (error: any) {
    log('Community flow', false, error.message)
  }
}

// ============== EVENT TESTS ==============

async function testEventFlow() {
  console.log('\n=== Testing Event Flow ===')
  
  if (!authToken) {
    log('Event flow', false, 'No auth token')
    return
  }

  try {
    // Get events
    const getRes = await api.get('/events', {
      params: { limit: 10 }
    })
    log('Get events', getRes.status === 200, `Status: ${getRes.status}`)

    if (getRes.data?.data?.length > 0) {
      const eventId = getRes.data.data[0].id

      // Get event detail
      const detailRes = await api.get(`/events/${eventId}`)
      log('Get event detail', detailRes.status === 200, `Status: ${detailRes.status}`)

      // Register for event
      const registerRes = await api.post(`/events/${eventId}/register`)
      log('Register for event', registerRes.status === 200 || registerRes.status === 400, `Status: ${registerRes.status}`)

      // Get attendees
      const attendeesRes = await api.get(`/events/${eventId}/attendees`)
      log('Get event attendees', attendeesRes.status === 200, `Status: ${attendeesRes.status}`)
    }

  } catch (error: any) {
    log('Event flow', false, error.message)
  }
}

// ============== BOOKING TESTS ==============

async function testBookingFlow() {
  console.log('\n=== Testing Booking Flow ===')
  
  if (!authToken) {
    log('Booking flow', false, 'No auth token')
    return
  }

  try {
    // Create booking
    const createRes = await api.post('/bookings', {
      partnerId: partnerId || 'test-partner-id',
      serviceType: 'DELIVERY',
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      pickupLocation: '123 Test Street',
      dropoffLocation: '456 Test Avenue',
      description: 'Test booking',
      amount: 500,
    })
    log('Create booking', createRes.status === 201, `Status: ${createRes.status}`)

    if (createRes.data?.data?.id) {
      bookingId = createRes.data.data.id

      // Get booking detail
      const detailRes = await api.get(`/bookings/${bookingId}`)
      log('Get booking detail', detailRes.status === 200, `Status: ${detailRes.status}`)

      // Get bookings list
      const listRes = await api.get('/bookings', {
        params: { limit: 10 }
      })
      log('Get bookings list', listRes.status === 200, `Status: ${listRes.status}`)

      // Cancel booking
      const cancelRes = await api.post(`/bookings/${bookingId}/cancel`)
      log('Cancel booking', cancelRes.status === 200 || cancelRes.status === 400, `Status: ${cancelRes.status}`)
    }

  } catch (error: any) {
    log('Booking flow', false, error.message)
  }
}

// ============== MESSAGE TESTS ==============

async function testMessageFlow() {
  console.log('\n=== Testing Message Flow ===')
  
  if (!authToken) {
    log('Message flow', false, 'No auth token')
    return
  }

  try {
    // Get conversations
    const conversationsRes = await api.get('/messages/conversations', {
      params: { limit: 10 }
    })
    log('Get conversations', conversationsRes.status === 200, `Status: ${conversationsRes.status}`)

    // Send message (if conversation exists)
    if (conversationsRes.data?.data?.length > 0) {
      const conversationId = conversationsRes.data.data[0].id

      const sendRes = await api.post('/messages/send', {
        conversationId,
        content: 'Test message',
        type: 'TEXT',
      })
      log('Send message', sendRes.status === 200 || sendRes.status === 201, `Status: ${sendRes.status}`)

      // Get messages
      const getRes = await api.get(`/messages/conversation/${conversationId}`, {
        params: { limit: 10 }
      })
      log('Get messages', getRes.status === 200, `Status: ${getRes.status}`)
    }

  } catch (error: any) {
    log('Message flow', false, error.message)
  }
}

// ============== HEALTH CHECK ==============

async function testHealthCheck() {
  console.log('\n=== Testing Health Check ===')
  
  try {
    const res = await api.get('/health')
    log('Health check', res.status === 200, `Status: ${res.status}`)
  } catch (error: any) {
    log('Health check', false, error.message)
  }
}

// ============== MAIN RUNNER ==============

async function runTests() {
  console.log('🧪 Starting RentBuddy Integration Tests')
  console.log(`📡 API URL: ${API_URL}`)
  
  try {
    await testHealthCheck()
    await testAuthFlow()
    await testKycFlow()
    await testSearchFlow()
    await testNotificationFlow()
    await testWalletFlow()
    await testCommunityFlow()
    await testEventFlow()
    await testBookingFlow()
    await testMessageFlow()
    
    console.log('\n✨ All tests completed!')
    process.exit(0)
  } catch (error) {
    console.error('❌ Test suite failed:', error)
    process.exit(1)
  }
}

runTests()
