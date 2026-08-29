import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Upload, CheckCircle, ArrowLeft, FileCheck, Shield, Clock, AlertTriangle, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { AuthImage } from '../../components/AuthImage'

const GOV_ID_TYPES = [
  { value: 'PASSPORT', label: 'Passport' },
  { value: 'DRIVERS_LICENSE', label: "Driver's License" },
  { value: 'NATIONAL_ID', label: 'National ID' },
  { value: 'OTHER', label: 'Other' },
] as const

type OverallStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED'

export function VerifyGovIdPage() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [govIdType, setGovIdType] = useState<string>('PASSPORT')
  const [statusLoading, setStatusLoading] = useState(true)
  const [govIdUrl, setGovIdUrl] = useState<string | null>(null)
  const [submittedGovIdType, setSubmittedGovIdType] = useState<string | null>(null)
  const [overallStatus, setOverallStatus] = useState<OverallStatus>('UNVERIFIED')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await api.get('/verification/status')
        if (res.data.success) {
          const data = res.data.data
          setGovIdUrl(data.govIdUrl || null)
          setSubmittedGovIdType(data.govIdType || null)
          setOverallStatus(data.status || 'UNVERIFIED')
          if (data.govIdType) setGovIdType(data.govIdType)
        }
      } catch {
      } finally {
        setStatusLoading(false)
      }
    }
    checkStatus()
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be under 5MB')
      return
    }

    setSelectedFile(file)
    if (file.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(file))
    } else {
      setPreviewUrl(null)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append('govId', selectedFile)
    formData.append('govIdType', govIdType)

    try {
      const res = await api.post('/verification/gov-id', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      toast.success('Government ID uploaded successfully')
      const newUrl = res.data?.data?.govIdUrl || res.data?.govIdUrl
      setGovIdUrl(newUrl || govIdUrl)
      setSubmittedGovIdType(govIdType)
      setOverallStatus('PENDING')
      setSelectedFile(null)
      setPreviewUrl(null)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.delete('/verification/document/govId')
      setGovIdUrl(null)
      setSubmittedGovIdType(null)
      setOverallStatus('UNVERIFIED')
      toast.success('Government ID removed')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to remove government ID'))
    } finally {
      setDeleting(false)
    }
  }

  const hasSubmitted = !!govIdUrl
  const canResubmit = overallStatus === 'REJECTED'

  const govIdTypeLabel = (t: string) => GOV_ID_TYPES.find(x => x.value === t)?.label || t

  if (statusLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-2">
          <Link to="/verification" className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-500" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold font-display text-surface-900 dark:text-white">Government ID Verification</h2>
              <p className="text-sm text-surface-500">Submit a valid government-issued ID document</p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      {hasSubmitted && !canResubmit && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex flex-col items-center text-center py-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${
                overallStatus === 'VERIFIED'
                  ? 'bg-emerald-50 dark:bg-emerald-500/10'
                  : 'bg-amber-50 dark:bg-amber-500/10'
              }`}>
                {overallStatus === 'VERIFIED' ? (
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                ) : (
                  <Clock className="w-8 h-8 text-amber-500" />
                )}
              </div>
              <h3 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-1">
                {overallStatus === 'VERIFIED' ? 'Verified' : 'Under Review'}
              </h3>
              <span className={`mb-2 ${
                overallStatus === 'VERIFIED' ? 'badge-success' : 'badge-warning'
              }`}>
                {overallStatus === 'VERIFIED' ? 'Verified' : 'Pending Review'}
              </span>
              {submittedGovIdType && (
                <p className="text-xs text-surface-500 mb-2">Type: {govIdTypeLabel(submittedGovIdType)}</p>
              )}
              <p className="text-sm text-surface-500 mb-6">
                {overallStatus === 'VERIFIED'
                  ? 'Your government ID has been verified.'
                  : 'Your government ID has been submitted and is being reviewed.'}
              </p>
              {govIdUrl && (
                <div className="mb-6">
                  <AuthImage url={govIdUrl} alt="Submitted ID" className="w-40 h-28 rounded-2xl object-cover border-2 border-surface-200 dark:border-surface-700" />
                </div>
              )}
              <Link to="/verification" className="btn-primary">
                <ArrowLeft className="w-4 h-4" /> Back to Verification
              </Link>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      {(canResubmit || !hasSubmitted) && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            {canResubmit && govIdUrl && (
              <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h4 className="font-bold text-red-700 dark:text-red-400 text-sm">Previous submission was rejected</h4>
                    <p className="text-sm text-red-600 dark:text-red-300 mt-1">Please upload a new document to resubmit for verification.</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <AuthImage url={govIdUrl} alt="Rejected ID" className="w-16 h-12 rounded-xl object-cover border border-red-200 dark:border-red-500/30" />
                  <div className="flex-1">
                    <p className="text-xs text-red-500">Current document</p>
                    {submittedGovIdType && <p className="text-xs text-red-400">Type: {govIdTypeLabel(submittedGovIdType)}</p>}
                  </div>
                  <button onClick={handleDelete} disabled={deleting} className="btn-danger btn-xs">
                    <Trash2 className="w-3 h-3" /> {deleting ? 'Removing...' : 'Remove'}
                  </button>
                </div>
              </div>
            )}

            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <FileCheck className="w-5 h-5 text-primary-500" />
                <h3 className="font-bold font-display text-surface-900 dark:text-white">
                  {canResubmit ? 'Upload New Government ID' : 'Upload Government ID'}
                </h3>
              </div>
              <p className="text-sm text-surface-500">
                Upload a clear photo or scan of your government-issued ID. All four corners must be visible and text must be readable.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">ID Type</label>
                <select
                  value={govIdType}
                  onChange={(e) => setGovIdType(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                >
                  {GOV_ID_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div className="border-2 border-dashed border-surface-200 dark:border-surface-700 rounded-2xl p-8 text-center hover:border-primary-400 dark:hover:border-primary-500 transition-colors">
                {previewUrl ? (
                  <div className="space-y-4">
                    <img src={previewUrl} alt="Preview" className="w-48 h-32 rounded-2xl object-cover mx-auto border-2 border-surface-200 dark:border-surface-700" />
                    <p className="text-sm text-surface-600 dark:text-surface-400 font-medium">{selectedFile?.name}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto">
                      <Upload className="w-7 h-7 text-surface-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-surface-700 dark:text-surface-300">Click to select or drag and drop</p>
                      <p className="text-xs text-surface-400 mt-1">JPG, PNG, PDF up to 5MB</p>
                    </div>
                  </div>
                )}
              </div>

              <input
                type="file"
                accept="image/*,.pdf"
                onChange={handleFileSelect}
                className="block w-full text-sm text-surface-500 file:mr-4 file:py-2.5 file:px-5 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 dark:file:bg-primary-500/10 dark:file:text-primary-400 hover:file:bg-primary-100 dark:hover:file:bg-primary-500/20 file:cursor-pointer file:transition-colors"
              />

              {selectedFile && !uploading && (
                <button onClick={handleUpload} className="btn-primary w-full">
                  <Upload className="w-4 h-4" /> {canResubmit ? 'Upload New Government ID' : 'Upload Government ID'}
                </button>
              )}

              {uploading && (
                <div className="space-y-2">
                  <div className="w-full h-2.5 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-surface-500 text-center">Uploading... {progress}%</p>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-surface-100 dark:border-surface-800">
              <Link to="/verification" className="text-sm text-surface-500 hover:text-primary-500 transition-colors flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> Back to Verification
              </Link>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}
    </div>
  )
}