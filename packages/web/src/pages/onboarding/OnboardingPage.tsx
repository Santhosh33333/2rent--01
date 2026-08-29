import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Users, Shield, Sparkles, ChevronRight, ArrowRight, ChevronLeft } from 'lucide-react'

const steps = [
  {
    icon: MapPin,
    title: 'Discover Nearby',
    description: 'Find walking partners, travel buddies, and communities around you in real-time.',
    gradient: 'from-primary-500 to-primary-700',
    bg: 'from-primary-500/10 via-transparent to-primary-600/5',
    blobGradient: 'from-primary-500 to-primary-600',
  },
  {
    icon: Users,
    title: 'Build Trust',
    description: 'Verified profiles, trust scores, and community reviews keep you safe.',
    gradient: 'from-accent-400 to-accent-600',
    bg: 'from-accent-400/10 via-transparent to-accent-500/5',
    blobGradient: 'from-accent-400 to-accent-500',
  },
  {
    icon: Shield,
    title: 'Stay Safe',
    description: 'KYC verification, emergency SOS, and AI-powered safety monitoring.',
    gradient: 'from-emerald-500 to-emerald-700',
    bg: 'from-emerald-500/10 via-transparent to-emerald-600/5',
    blobGradient: 'from-emerald-500 to-emerald-600',
  },
  {
    icon: Sparkles,
    title: 'Get Started',
    description: 'Join thousands of people making real connections every day.',
    gradient: 'from-primary-500 to-accent-500',
    bg: 'from-primary-500/10 via-transparent to-accent-500/5',
    blobGradient: 'from-primary-500 to-accent-500',
  },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [animating, setAnimating] = useState(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const goToStep = useCallback((target: number) => {
    if (animating || target === currentStep || target < 0 || target >= steps.length) return
    setDirection(target > currentStep ? 'forward' : 'backward')
    setAnimating(true)
    setTimeout(() => {
      setCurrentStep(target)
      setAnimating(false)
    }, 350)
  }, [currentStep, animating])

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      goToStep(currentStep + 1)
    } else {
      localStorage.setItem('onboarding_complete', 'true')
      navigate('/account-type', { replace: true })
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      goToStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    localStorage.setItem('onboarding_complete', 'true')
    navigate('/account-type', { replace: true })
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current
    const deltaY = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX < 0) handleNext()
      else handlePrev()
    }
  }

  const step = steps[currentStep]
  const Icon = step.icon
  const progress = ((currentStep + 1) / steps.length) * 100

  return (
    <>
      <style>{`
        @keyframes float-icon {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes slide-out-left {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(-60px); }
        }
        @keyframes slide-out-right {
          0% { opacity: 1; transform: translateX(0); }
          100% { opacity: 0; transform: translateX(60px); }
        }
        @keyframes slide-in-right {
          0% { opacity: 0; transform: translateX(60px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-left {
          0% { opacity: 0; transform: translateX(-60px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        .slide-content-out-left {
          animation: slide-out-left 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .slide-content-out-right {
          animation: slide-out-right 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .slide-content-in-right {
          animation: slide-in-right 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.05s both;
        }
        .slide-content-in-left {
          animation: slide-in-left 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.05s both;
        }
        .float-bob {
          animation: float-icon 3s ease-in-out infinite;
        }
      `}</style>

      <div
        className={`min-h-screen flex flex-col bg-gradient-to-br ${step.bg} transition-all duration-700`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className={`absolute w-96 h-96 bg-gradient-to-br ${step.blobGradient} rounded-full blur-[128px] opacity-20 transition-all duration-[1200ms] ease-out`}
            style={{
              top: currentStep % 2 === 0 ? '-8rem' : '10%',
              right: currentStep % 2 === 0 ? '-8rem' : 'auto',
              left: currentStep % 2 !== 0 ? '-8rem' : 'auto',
            }}
          />
          <div
            className={`absolute w-96 h-96 bg-gradient-to-br ${step.blobGradient} rounded-full blur-[128px] opacity-10 transition-all duration-[1200ms] ease-out`}
            style={{
              bottom: currentStep % 2 === 0 ? '-8rem' : '15%',
              left: currentStep % 2 === 0 ? '-8rem' : 'auto',
              right: currentStep % 2 !== 0 ? '-8rem' : 'auto',
            }}
          />
        </div>

        <div className="relative z-10 flex justify-end p-6">
          <button
            onClick={handleSkip}
            className="text-sm font-medium text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors px-4 py-2 rounded-xl hover:bg-white/50 dark:hover:bg-surface-800/50"
          >
            Skip
          </button>
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8">
          <div
            key={currentStep}
            className={`w-full max-w-sm text-center ${
              animating
                ? direction === 'forward'
                  ? 'slide-content-out-left'
                  : 'slide-content-out-right'
                : direction === 'forward'
                ? 'slide-content-in-right'
                : 'slide-content-in-left'
            }`}
          >
            <div
              className={`inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br ${step.gradient} shadow-lg mb-10 float-bob`}
              style={{ boxShadow: '0 20px 60px -15px rgba(99, 102, 241, 0.3)' }}
            >
              <Icon className="w-12 h-12 text-white" />
            </div>

            <h1 className="text-3xl sm:text-4xl font-bold text-surface-900 dark:text-white font-display tracking-tight mb-4">
              {step.title}
            </h1>

            <p className="text-base text-surface-500 dark:text-surface-400 leading-relaxed">
              {step.description}
            </p>
          </div>
        </div>

        <div className="relative z-10 p-8 pb-12">
          <div className="w-full max-w-sm mx-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-surface-400 dark:text-surface-500">
                {currentStep + 1} / {steps.length}
              </span>
            </div>
            <div className="w-full h-1 bg-surface-200 dark:bg-surface-700 rounded-full mb-8 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="w-full mb-3 py-3 rounded-xl text-sm font-medium text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors flex items-center justify-center gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}

            <button
              onClick={handleNext}
              className="btn-gradient w-full btn-lg group"
            >
              {currentStep === steps.length - 1 ? (
                <span className="flex items-center justify-center gap-2">
                  Get Started
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Continue
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

