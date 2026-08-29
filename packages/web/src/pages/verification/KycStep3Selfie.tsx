import { getErrorMessage } from '../../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Camera } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function KycStep3Selfie() {
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
      toast.error('Please upload a selfie image')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('selfie', file)

      await api.post('/verification/selfie', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      toast.success('Selfie uploaded successfully')
      navigate('/verification/step4')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to upload selfie'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification/step2')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Selfie Verification</h1>
            <p className="text-sm text-surface-500">Step 3 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <Camera className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Take a selfie</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Upload a clear selfie photo to verify your identity. Make sure your face is clearly visible.
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
                <img src={preview} alt="Selfie Preview" className="w-full h-64 object-cover" />
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
                  <Camera className="w-8 h-8 text-surface-400 mb-2" />
                  <p className="text-sm font-medium text-surface-900 dark:text-white">Click to upload</p>
                  <p className="text-xs text-surface-500 mt-1">PNG, JPG, GIF up to 5MB</p>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  required
                />
              </label>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/verification/step2')}
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
        <GlassCard variant="elevated" padding="lg" className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500">
          <h3 className="font-bold text-amber-900 dark:text-amber-300 mb-3">Selfie Guidelines:</h3>
          <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
            <li>âœ“ Face clearly visible - no glasses or head coverings</li>
            <li>âœ“ Good lighting - avoid harsh shadows</li>
            <li>âœ“ Natural expression - neutral face expression</li>
            <li>âœ“ Recent photo - taken within last 3 months</li>
            <li>âœ“ Plain background - avoid cluttered backgrounds</li>
            <li>âœ— No filters - must be original, unedited photo</li>
          </ul>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}