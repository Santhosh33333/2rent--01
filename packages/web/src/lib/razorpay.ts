import { api } from './api'

interface RazorpaySuccessResponse {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayError {
  message: string
  code?: string
  description?: string
  source?: string
}

interface RazorpayFailureResponse {
  error: RazorpayError
}

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open: () => void
      on: (event: string, handler: (response: RazorpayFailureResponse) => void) => void
    }
  }
}

interface RazorpayOptions {
  amount: number
  description?: string
  notes?: Record<string, string>
  onSuccess: (paymentId: string, orderId: string, signature: string) => void
  onError: (error: RazorpayError) => void
}

interface RazorpayBookingOptions {
  amount: number
  bookingId: string
  onSuccess: (paymentId: string, orderId: string, signature: string) => void
  onError: (error: RazorpayError) => void
}

/**
 * Open Razorpay checkout for wallet top-up
 */
export async function openRazorpayCheckout({
  amount,
  description = 'Wallet Top-Up',
  notes = {},
  onSuccess,
  onError,
}: RazorpayOptions) {
  try {
    const orderRes = await api.post('/payments/create-order', { amount })
    const orderData = orderRes.data.data
    const { orderId, currency } = orderData

    if (!window.Razorpay) {
      throw new Error('Razorpay script not loaded')
    }

    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_placeholder',
      amount: amount * 100,
      currency: currency || 'INR',
      name: 'RentBuddy',
      description,
      order_id: orderId,
      notes,
      handler: (response: RazorpaySuccessResponse) => {
        onSuccess(response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature)
      },
      modal: {
        ondismiss: () => {
          onError({ message: 'Payment cancelled by user' })
        },
      },
      prefill: {},
      theme: {
        color: '#6366f1',
      },
      retry: {
        enabled: true,
        max_count: 3,
      },
    }

    const rzp = new window.Razorpay(options)

    rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
      onError(response.error)
    })

    rzp.open()
  } catch (err) {
    console.error('Razorpay checkout error:', err)
    onError({ message: err instanceof Error ? err.message : 'Payment failed' })
  }
}

/**
 * Open Razorpay checkout for booking payment
 */
export async function openRazorpayBookingCheckout({
  amount,
  bookingId,
  onSuccess,
  onError,
}: RazorpayBookingOptions) {
  try {
    const initiateRes = await api.post(`/bookings/${bookingId}/pay`)
    const { orderId, currency } = initiateRes.data.data

    if (!window.Razorpay) {
      throw new Error('Razorpay script not loaded')
    }

    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_placeholder',
      amount: amount * 100,
      currency: currency || 'INR',
      name: 'RentBuddy',
      description: `Booking Payment - ${bookingId}`,
      order_id: orderId,
      notes: {
        bookingId,
      },
      handler: (response: RazorpaySuccessResponse) => {
        onSuccess(response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature)
      },
      modal: {
        ondismiss: () => {
          onError({ message: 'Payment cancelled by user' })
        },
      },
      prefill: {},
      theme: {
        color: '#6366f1',
      },
      retry: {
        enabled: true,
        max_count: 3,
      },
    }

    const rzp = new window.Razorpay(options)
    
    rzp.on('payment.failed', (response: RazorpayFailureResponse) => {
      onError(response.error)
    })

    rzp.open()
  } catch (err) {
    console.error('Razorpay booking checkout error:', err)
    onError({ message: err instanceof Error ? err.message : 'Payment failed' })
  }
}
