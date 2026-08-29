import { getErrorMessage } from '../../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CreditCard, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function KycStep2GovId() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [docType, setDocType] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    // Validate file size (max 5MB)
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB')
      return
    }

    // Validate file type
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

    if (!file || !docType) {
      toast.error('Please select document type and upload an image')
      return
    }

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('govId', file)
      formData.append('govIdType', docType)

      await api.post('/verification/gov-id', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      toast.success('Government ID uploaded successfully')
      navigate('/verification/step3')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to upload government ID'))
    } finally {
      setLoading(false)
    }
  }

  const docTypes = [
    { id: 'AADHAAR', label: 'Aadhaar Card', description: 'Indian unique identification' },
    { id: 'PASSPORT', label: 'Passport', description: 'International travel document' },
    { id: 'DRIVING_LICENSE', label: 'Driving License', description: 'Valid driving license' },
    { id: 'VOTER_ID', label: 'Voter ID', description: 'Voter identification card' },
    { id: 'PAN', label: 'PAN Card', description: 'Permanent Account Number (Optional)' },
  ]

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification/step1')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Government ID</h1>
            <p className="text-sm text-surface-500">Step 2 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Upload your government-issued ID</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Please upload a clear photo of your ID document. Make sure it's visible and legible.
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Document Type Selection */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-3">
                Select Document Type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {docTypes.map(doc => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setDocType(doc.id)}
                    className={`p-4 rounded-2xl text-left transition-all border-2 ${
                      docType === doc.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-surface-200 dark:border-surface-700 hover:border-primary-500/50'
                    }`}
                  >
                    <p className="font-medium text-sm text-surface-900 dark:text-white">{doc.label}</p>
                    <p className="text-xs text-surface-500 mt-1">{doc.description}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-3">
                Upload Document <span className="text-red-500">*</span>
              </label>
              
              {preview ? (
                <div className="relative rounded-2xl overflow-hidden mb-3">
                  <img src={preview} alt="Preview" className="w-full h-64 object-cover" />
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
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/verification/step1')}
                className="flex-1 btn-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={loading || !file || !docType}
                className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '...' : <>Next <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </form>
        </GlassCard>
      </AnimatedPage>

      {/* Tips */}
      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg" className="bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-500">
          <h3 className="font-bold text-amber-900 dark:text-amber-300 mb-3">Tips for a clear photo:</h3>
          <ul className="space-y-2 text-sm text-amber-800 dark:text-amber-200">
            <li>âœ“ Good lighting - avoid shadows and glare</li>
            <li>âœ“ All corners visible - entire document in frame</li>
            <li>âœ“ In focus - sharp and clear image</li>
            <li>âœ“ Color - original colors, not black & white</li>
            <li>âœ“ Recent - valid and not expired</li>
          </ul>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}