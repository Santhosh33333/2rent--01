import { useEffect } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Hold the user on a screen they are not allowed to leave.
 *
 * The app-lock PIN screen, an active call and an active SOS alert must not be
 * dismissable with the system Back button (hardware key or swipe gesture) - each
 * one is a barrier the user is meant to resolve through its own control (enter
 * the PIN, end the call, resolve the alert), never to escape. On Android that
 * button fires Capacitor's `backButton` event, and once a listener is registered
 * the plugin stops applying its default action (go back in history / exit the
 * app) - so swallowing the event here is exactly what pins the screen.
 *
 * On the web there is nothing to intercept: the PIN lock and the call UI are
 * overlays mounted above the router, so a browser Back changes the route
 * underneath but never removes the locked surface, and fighting the browser's
 * Back button would mean diverging from the router's history.
 */
export function useScreenLock(active: boolean): void {
  useEffect(() => {
    if (!active || !Capacitor.isNativePlatform()) return

    let handle: PluginListenerHandle | undefined
    let cancelled = false

    App.addListener('backButton', () => {
      // Intentionally empty: the locked screen owns the exit.
    }).then((h) => {
      if (cancelled) void h.remove()
      else handle = h
    })

    return () => {
      cancelled = true
      if (handle) void handle.remove()
    }
  }, [active])
}
