import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function SplashPage() {
  const navigate = useNavigate()
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const onboardingComplete = localStorage.getItem('onboarding_complete')
    const profileComplete = localStorage.getItem('profile_complete') === 'true'

    const timer = setTimeout(() => {
      setFadeOut(true)
      setTimeout(() => {
        if (!onboardingComplete) {
          navigate('/onboarding', { replace: true })
        } else if (token) {
          if (profileComplete) {
            navigate('/dashboard', { replace: true })
          } else {
            navigate('/profile/complete', { replace: true })
          }
        } else {
          navigate('/account-type', { replace: true })
        }
      }, 500)
    }, 2000)

    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <>
      <style>{`
        @keyframes blob-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.1; }
          50% { transform: translate(-50%, -50%) scale(1.15); opacity: 0.18; }
        }
        @keyframes blob-pulse-2 {
          0%, 100% { transform: scale(1); opacity: 0.08; }
          50% { transform: scale(1.2); opacity: 0.14; }
        }
        @keyframes shimmer {
          0% { transform: translateX(-120%) rotate(25deg); }
          100% { transform: translateX(220%) rotate(25deg); }
        }
        @keyframes particle-drift-1 {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 0.6; }
          85% { opacity: 0.6; }
          100% { transform: translateY(-120px) translateX(12px); opacity: 0; }
        }
        @keyframes particle-drift-2 {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 0.5; }
          85% { opacity: 0.5; }
          100% { transform: translateY(-140px) translateX(-18px); opacity: 0; }
        }
        @keyframes particle-drift-3 {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 0.4; }
          85% { opacity: 0.4; }
          100% { transform: translateY(-100px) translateX(8px); opacity: 0; }
        }
        @keyframes particle-drift-4 {
          0% { transform: translateY(0) translateX(0); opacity: 0; }
          15% { opacity: 0.5; }
          85% { opacity: 0.5; }
          100% { transform: translateY(-130px) translateX(-10px); opacity: 0; }
        }
        .stagger-logo { animation: stagger-scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0ms both; }
        .stagger-brand { animation: stagger-slide-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) 200ms both; }
        .stagger-tagline { animation: stagger-fade-in 0.5s ease 400ms both; }
        .stagger-spinner { animation: stagger-fade-in 0.4s ease 600ms both; }
        @keyframes stagger-scale-in {
          0% { opacity: 0; transform: scale(0.3); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes float-gentle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes stagger-slide-up {
          0% { opacity: 0; transform: translateY(24px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes stagger-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>

      <div className={`min-h-screen flex flex-col items-center justify-center bg-surface-950 transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute top-1/4 left-1/2 w-[600px] h-[600px] bg-primary-500/10 rounded-full blur-[128px]"
            style={{ transform: 'translate(-50%, -50%)', animation: 'blob-pulse 4s ease-in-out infinite' }}
          />
          <div
            className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] bg-accent-500/10 rounded-full blur-[128px]"
            style={{ animation: 'blob-pulse-2 5s ease-in-out infinite 1s' }}
          />
        </div>

        <div className="relative z-10 flex flex-col items-center">
          <div className="relative mb-6 stagger-logo">
            <div className="w-24 h-24 flex items-center justify-center">
              <img
                src="/logo-mark.svg"
                alt="RentBuddy logo"
                className="w-full h-full relative z-10 drop-shadow-2xl"
                style={{ animation: 'float-gentle 4s ease-in-out infinite' }}
              />
              <div
                className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden rounded-[28px]"
                style={{ animation: 'shimmer 1.8s ease-in-out 0.8s both' }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent" style={{ width: '40%', height: '200%', top: '-50%' }} />
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-accent-500 to-accent-400 flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 pointer-events-none" style={{ width: '120px', height: '120px' }}>
            <div className="absolute bottom-4 left-1/2 w-1.5 h-1.5 rounded-full bg-primary-400/60" style={{ animation: 'particle-drift-1 3.5s ease-in-out 0.5s infinite' }} />
            <div className="absolute bottom-6 left-1/3 w-1 h-1 rounded-full bg-accent-400/50" style={{ animation: 'particle-drift-2 4.2s ease-in-out 1.2s infinite' }} />
            <div className="absolute bottom-2 right-1/3 w-1 h-1 rounded-full bg-primary-300/40" style={{ animation: 'particle-drift-3 3.8s ease-in-out 0.8s infinite' }} />
            <div className="absolute bottom-5 left-1/2 w-1.5 h-1.5 rounded-full bg-accent-300/35" style={{ animation: 'particle-drift-4 4.5s ease-in-out 1.8s infinite' }} />
          </div>

          <h1 className="text-4xl font-bold font-display tracking-tight stagger-brand">
            <span className="text-gradient">RentBuddy</span>
          </h1>
          <p className="text-surface-500 mt-3 text-sm tracking-wide stagger-tagline">
            Trust-based social connections
          </p>
        </div>

        <div className="relative z-10 mt-16 stagger-spinner">
          <div className="w-8 h-8 rounded-full border-2 border-surface-700 border-t-primary-500 animate-spin" />
        </div>
      </div>
    </>
  )
}
