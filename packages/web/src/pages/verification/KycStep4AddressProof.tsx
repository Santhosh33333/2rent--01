import { getErrorMessage } from '../../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, MapPin, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function KycStep4AddressProof() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB')
      return
    }

    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Please upload an image file')
      return
    }

    setFile(selectedFile)
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreview(reader.result as string)
    }
    reader.readAsDataURL(selectedFile)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!file) {
      toast.error('Please upload an address proof document')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('addressProof', file)

      await api.post('/verification/address', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      toast.success('Address proof uploaded successfully')
      navigate('/verification/step5')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to upload address proof'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification/step3')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Address Proof</h1>
            <p className="text-sm text-surface-500">Step 4 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <MapPin className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Upload address proof</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Provide proof of your current address. Utility bill, rental agreement, or government letter accepted.
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <form onSubmit={handleSubmit} className="space-y-5">
            {preview ? (
              <div className="relative rounded-2xl overflow-hidden mb-3">
                <img src={preview} alt="Address Proof Preview" className="w-full h-64 object-cover" />
                <button
                  type="button"
                  onClick={() => { setFile(null); setPreview(null) }}
                  className="absolute top-3 right-3 bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-lg text-sm font-medium transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full p-8 border-2 border-dashed border-surface-300 dark:border-surface-600 rounded-2xl hover:border-primary-500 transition-colors cursor-pointer">
                <div className="flex flex-col items-center justify-center">
                  <Upload className="w-8 h-8 text-surface-400 mb-2" />
                  <p className="text-sm font-medium text-surface-900 dark:text-white">Click to upload</p>
                  <p className="text-xs text-surface-500 mt-1">PNG, JPG, PDF up to 5MB</p>
                </div>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  required
                />
              </label>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/verification/step3')}
                className="flex-1 btn-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={loading || !file}
                className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : <>Next <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </form>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg" className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500">
          <h3 className="font-bold text-blue-900 dark:text-blue-300 mb-3">Accepted Documents:</h3>
          <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200 mb-4">
            <li>âœ“ Utility Bill (electricity, water, gas)</li>
            <li>âœ“ Rental Agreement or Lease</li>
            <li>âœ“ Government Letter with address</li>
            <li>âœ“ Bank Statement with address</li>
            <li>âœ“ Insurance Policy Document</li>
          </ul>
          <p className="text-xs text-blue-700 dark:text-blue-400">Must be dated within last 3 months and clearly show your name and address.</p>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}