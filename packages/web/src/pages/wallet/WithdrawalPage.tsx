import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, IndianRupee, Building2, CreditCard, Loader2, CheckCircle, Wallet, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { api } from '../../lib/api'

type Method = 'BANK_TRANSFER' | 'UPI'

interface FormData {
  amount: string
  accountNumber: string
  ifsc: string
  upiId: string
  accountHolderName: string
}

type Register = ReturnType<typeof useForm<FormData>>['register']

function HolderNameField({ register, autoFilled, verified }: { register: Register; autoFilled?: boolean; verified?: boolean }) {
  return (
    <div className="pt-1">
      <label className="label">Account Holder Name</label>
      <input
        {...register('accountHolderName')}
        type="text"
        className="input"
        placeholder="Name as per your bank / UPI ID"
      />
      <p className="text-xs text-surface-500 mt-1">
        {autoFilled
          ? `Filled in automatically${verified ? ' (verified at your bank)' : ' from your UPI ID'} — please correct it if wrong.`
          : 'Helps us pay the right account. Auto-filled for UPI once your UPI ID is valid.'}
      </p>
    </div>
  )
}

export function WithdrawalPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [success, setSuccess] = useState(false)
  const [balance, setBalance] = useState(0)
  const [method, setMethod] = useState<Method>('BANK_TRANSFER')
  // Auto-fill from IFSC / UPI lookups (bank name + account holder name).
  const [ifscLookup, setIfscLookup] = useState<{ loading: boolean; bankName: string | null; error: string }>({ loading: false, bankName: null, error: '' })
  const [upiLookup, setUpiLookup] = useState<{ loading: boolean; bank: string | null; name: string | null; verified: boolean; error: string }>({ loading: false, bank: null, name: null, verified: false, error: '' })

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    defaultValues: { amount: '', accountNumber: '', ifsc: '', upiId: '', accountHolderName: '' },
  })

  const amountValue = watch('amount')
  const ifscValue = watch('ifsc')
  const upiValue = watch('upiId')

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await api.get('/wallet')
        setBalance(res.data.data?.balance ?? res.data.balance ?? 0)
      } catch {
        toast.error('Failed to fetch wallet balance')
      } finally {
        setBalanceLoading(false)
      }
    }
    fetchBalance()
  }, [])

  // IFSC -> bank name, as soon as the code is complete.
  useEffect(() => {
    const code = (ifscValue || '').trim().toUpperCase()
    if (code.length < 11) {
      setIfscLookup((p) => (p.bankName || p.error ? { loading: false, bankName: null, error: '' } : p))
      return
    }
    let cancelled = false
    setIfscLookup({ loading: true, bankName: null, error: '' })
    const timer = setTimeout(() => {
      api.get('/wallet/bank-info', { params: { ifsc: code }, timeout: 10000 })
        .then((res) => {
          if (cancelled) return
          const d = res.data?.data || res.data
          setIfscLookup({ loading: false, bankName: d?.bankName || null, error: d?.bankName ? '' : 'Bank not recognised for this IFSC' })
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setIfscLookup({ loading: false, bankName: null, error: getErrorMessage(err, 'Could not verify IFSC') })
        })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [ifscValue])

  // UPI ID -> holder name + bank/app, once the handle looks complete.
  useEffect(() => {
    const upi = (upiValue || '').trim()
    if (!upi.includes('@') || !/^[\w.\-]+@[a-zA-Z]{2,}$/.test(upi)) {
      setUpiLookup((p) => (p.bank || p.name || p.error ? { loading: false, bank: null, name: null, verified: false, error: '' } : p))
      return
    }
    let cancelled = false
    setUpiLookup({ loading: true, bank: null, name: null, verified: false, error: '' })
    const timer = setTimeout(() => {
      api.get('/wallet/upi-info', { params: { upiId: upi }, timeout: 12000 })
        .then((res) => {
          if (cancelled) return
          const d = res.data?.data || res.data
          const name = d?.suggestedName || null
          setUpiLookup({ loading: false, bank: d?.bank || null, name, verified: !!d?.verified, error: '' })
          if (name) setValue('accountHolderName', name, { shouldValidate: true, shouldDirty: true })
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setUpiLookup({ loading: false, bank: null, name: null, verified: false, error: getErrorMessage(err, 'Could not verify UPI ID') })
        })
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [upiValue, setValue])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      const accountDetail = method === 'BANK_TRANSFER'
        ? {
            accountNumber: data.accountNumber,
            ifsc: (data.ifsc || '').trim().toUpperCase(),
            ...(ifscLookup.bankName ? { bankName: ifscLookup.bankName } : {}),
            ...(data.accountHolderName ? { accountHolderName: data.accountHolderName } : {}),
          }
        : {
            upiId: (data.upiId || '').trim().toLowerCase(),
            ...(upiLookup.bank ? { upiBank: upiLookup.bank } : {}),
            ...(data.accountHolderName ? { accountHolderName: data.accountHolderName } : {}),
          }
      await api.post('/wallet/withdraw', {
        amount: Number(data.amount),
        method,
        accountDetail,
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
                {balanceLoading ? 'Loading balance...' : `Available balance: ₹${balance.toLocaleString('en-IN')}`}
              </p>
            </div>
          </div>

          <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-primary-500/10 to-accent-500/10 dark:from-primary-900/20 dark:to-accent-900/20 border border-primary-200/50 dark:border-primary-800/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-500">Current Balance</span>
              <span className="text-2xl font-bold text-surface-900 dark:text-white">
                {balanceLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : `₹${balance.toLocaleString('en-IN')}`}
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
                  You'll receive ₹{Number(amountValue).toLocaleString('en-IN')}
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
              {method === 'BANK_TRANSFER' ? (
                <div className="space-y-3">
                  <div className="relative">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                    <input
                      {...register('accountNumber', { required: 'Account number is required' })}
                      type="text"
                      className="input pl-11"
                      placeholder="Account Number"
                    />
                  </div>
                  {errors.accountNumber && <p className="mt-1 text-sm text-danger-500">{errors.accountNumber.message}</p>}
                  <div className="relative">
                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                    <input
                      {...register('ifsc', { required: 'IFSC code is required', minLength: { value: 11, message: 'IFSC must be 11 characters' } })}
                      type="text"
                      className="input pl-11"
                      placeholder="IFSC Code"
                      maxLength={11}
                    />
                    {ifscLookup.loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 animate-spin" />}
                  </div>
                  {errors.ifsc && <p className="mt-1 text-sm text-danger-500">{errors.ifsc.message}</p>}
                  {ifscLookup.bankName && (
                    <p className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      Bank found automatically: <span className="font-semibold">{ifscLookup.bankName}</span>
                    </p>
                  )}
                  {ifscLookup.error && <p className="mt-1 text-xs text-surface-500">{ifscLookup.error}</p>}
                  <HolderNameField register={register} />
                </div>
              ) : (
                <>
                  <div className="relative">
                    <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                    <input
                      {...register('upiId', { required: 'UPI ID is required' })}
                      type="text"
                      className="input pl-11"
                      placeholder="your@upi"
                    />
                    {upiLookup.loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 animate-spin" />}
                  </div>
                  {errors.upiId && <p className="mt-1 text-sm text-danger-500">{errors.upiId.message}</p>}
                  {upiLookup.error && <p className="mt-1 text-xs text-danger-500">{upiLookup.error}</p>}
                  {upiLookup.bank && (
                    <p className="mt-2 flex items-center gap-2 rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-sm text-sky-700 dark:text-sky-300">
                      <Search className="w-4 h-4 shrink-0" />
                      Detected: <span className="font-semibold">{upiLookup.bank}</span>
                    </p>
                  )}
                  <HolderNameField register={register} autoFilled={!!upiLookup.name} verified={upiLookup.verified} />
                </>
              )}
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