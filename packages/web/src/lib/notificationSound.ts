const SOUND_KEY = 'notification-sound-enabled'
const GLOBAL_NOTIFICATIONS_KEY = 'notifications-enabled'

let context: AudioContext | null = null
let listenersInstalled = false
const recentlyPlayed = new Set<string>()

function unlockAudio() {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) return
  context ??= new AudioContextClass()
  if (context.state === 'suspended') void context.resume().catch(() => {})
}

export function installNotificationAudioUnlock() {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  const unlock = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    listenersInstalled = false
  }
  window.addEventListener('pointerdown', unlock, { once: true, passive: true })
  window.addEventListener('keydown', unlock, { once: true })
}

export function playNotificationSound(notificationId?: string) {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SOUND_KEY) === 'false' || localStorage.getItem(GLOBAL_NOTIFICATIONS_KEY) === 'false') return

  if (notificationId) {
    if (recentlyPlayed.has(notificationId)) return
    recentlyPlayed.add(notificationId)
    window.setTimeout(() => recentlyPlayed.delete(notificationId), 60_000)
  }

  if (!context || context.state !== 'running') return
  const start = context.currentTime
  for (const [index, frequency] of [784, 1046.5].entries()) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const onset = start + index * 0.11
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, onset)
    gain.gain.exponentialRampToValueAtTime(0.12, onset + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, onset + 0.16)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(onset)
    oscillator.stop(onset + 0.17)
  }
}
