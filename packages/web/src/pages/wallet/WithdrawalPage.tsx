import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, IndianRupee, Building2, CreditCard, Loader2, CheckCircle, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { api } from '../../lib/api'

type Method = 'BANK_TRANSFER' | 'UPI'

interface FormData {
  amount: string
  accountDetail: string
}

export function WithdrawalPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [success, setSuccess] = useState(false)
  const [balance, setBalance] = useState(0)
  const [method, setMethod] = useState<Method>('BANK_TRANSFER')

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: { amount: '', accountDetail: '' },
  })

  const amountValue = watch('amount')

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await api.get('/wallet')
        setBalance(res.data.balance ?? 0)
      } catch {
        toast.error('Failed to fetch wallet balance')
      } finally {
        setBalanceLoading(false)
      }
    }
    fetchBalance()
  }, [])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      await api.post('/wallet/withdraw', {
        amount: Number(data.amount),
        method,
        accountDetail: data.accountDetail,
      })
      setSuccess(true)
      toast.success('Withdrawal request submitted successfully')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Withdrawal failed'))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <AnimatedPage>
          <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-xl shadow-emerald-500/30 mb-6 animate-bounce-in">
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-2">Request Submitted</h2>
          <p className="text-surface-500 mb-8">Your withdrawal request has been submitted for review. You'll receive a notification once it's processed.</p>
          <button onClick={() => navigate('/wallet')} className="btn-primary">
            Back to Wallet
          </button>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => navigate('/wallet')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Wallet</span>
      </button>

      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30">
              <Wallet className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Withdraw Funds</h2>
              <p className="text-sm text-surface-500">
                {balanceLoading ? 'Loading balance...' : `Available balance: ₹${balance.toLocaleString()}`}
              </p>
            </div>
          </div>

          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-primary-500/10 to-accent-500/10 dark:from-primary-900/20 dark:to-accent-900/20 border border-primary-200/50 dark:border-primary-800/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-500">Current Balance</span>
              <span className="text-2xl font-bold text-surface-900 dark:text-white">
                {balanceLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : `₹${balance.toLocaleString()}`}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="label">Amount (₹)</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                <input
                  {...register('amount', {
                    required: 'Amount is required',
                    min: { value: 100, message: 'Minimum withdrawal is ₹100' },
                    max: { value: balance, message: 'Amount exceeds available balance' },
                  })}
                  type="number"
                  className="input pl-11"
                  placeholder="Enter amount"
                />
              </div>
              {errors.amount && <p className="mt-1 text-sm text-danger-500">{errors.amount.message}</p>}
              {amountValue && Number(amountValue) > 0 && !errors.amount && (
                <p className="mt-1 text-xs text-surface-400">
                  You'll receive ₹{Number(amountValue).toLocaleString()}
                </p>
              )}
            </div>

            <div>
              <label className="label">Withdrawal Method</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMethod('BANK_TRANSFER')}
                  className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                    method === 'BANK_TRANSFER'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 text-surface-500'
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Bank Transfer</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('UPI')}
                  className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                    method === 'UPI'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 text-surface-500'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  <span className="text-sm font-medium">UPI</span>
                </button>
              </div>
            </div>

            <div>
              <label className="label">
                {method === 'BANK_TRANSFER' ? 'Bank Account Details' : 'UPI ID'}
              </label>
              <div className="relative">
                {method === 'BANK_TRANSFER' ? (
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                ) : (
                  <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                )}
                <input
                  {...register('accountDetail', { required: 'This field is required' })}
                  type="text"
                  className="input pl-11"
                  placeholder={method === 'BANK_TRANSFER' ? 'Account No + IFSC' : 'your@upi'}
                />
              </div>
              {errors.accountDetail && <p className="mt-1 text-sm text-danger-500">{errors.accountDetail.message}</p>}
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={loading || balanceLoading} className="btn-primary flex-1">
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <IndianRupee className="w-4 h-4" /> Request Withdrawal
                  </span>
                )}
              </button>
              <button type="button" onClick={() => navigate('/wallet')} className="btn-secondary">Cancel</button>
            </div>
          </form>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}