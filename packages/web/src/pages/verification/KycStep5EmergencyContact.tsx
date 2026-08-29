import { getErrorMessage } from '../../lib/error'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function KycStep5EmergencyContact() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    relation: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.phone || !formData.relation) {
      toast.error('Please fill all required fields')
      return
    }

    setLoading(true)
    try {
      await api.post('/verification/emergency-contact', formData)
      toast.success('Emergency contact saved')
      navigate('/verification/step6')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save emergency contact'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification/step4')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Emergency Contact</h1>
            <p className="text-sm text-surface-500">Step 5 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <Phone className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Emergency contact information</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                We keep this information safe to contact your emergency contact in urgent situations.
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="John Doe"
                className="input w-full"
                required
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+91 98765 43210"
                className="input w-full"
                required
              />
              <p className="text-xs text-surface-500 mt-1">Include country code</p>
            </div>

            {/* Relationship */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Relationship <span className="text-red-500">*</span>
              </label>
              <select
                name="relation"
                value={formData.relation}
                onChange={handleChange}
                className="input w-full"
                required
              >
                <option value="">Select Relationship</option>
                <option value="PARENT">Parent</option>
                <option value="SIBLING">Sibling</option>
                <option value="SPOUSE">Spouse</option>
                <option value="CHILD">Child</option>
                <option value="FRIEND">Friend</option>
                <option value="COLLEAGUE">Colleague</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Submit */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/verification/step4')}
                className="flex-1 btn-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                {loading ? '...' : <>Next <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </form>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg" className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500">
          <h3 className="font-bold text-green-900 dark:text-green-300 mb-3">Why we need this:</h3>
          <ul className="space-y-2 text-sm text-green-800 dark:text-green-200">
            <li>â€¢ To contact in case of emergency or safety concerns</li>
            <li>â€¢ Your emergency contact will only be contacted with your permission</li>
            <li>â€¢ This information is encrypted and securely stored</li>
            <li>â€¢ You can update this anytime from your profile</li>
          </ul>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}