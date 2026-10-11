import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Keep the Android system-bar icons legible with respect to the *in-app* theme.
 *
 * Because the app targets SDK 36 the WebView is laid out edge-to-edge behind the
 * status bar. Android picks the icon colour from the OS theme, which can
 * disagree with the app's own light/dark toggle: a dark app on a light phone got
 * dark-on-dark icons that were effectively invisible. Drive the appearance from
 * the app theme instead.
 *
 * `Style.Dark` = dark icons for a light background; `Style.Light` = light icons
 * for a dark background. No-op on web and on shells without the plugin.
 */
export async function syncStatusBar(theme: 'light' | 'dark'): Promise<void> {
  try {
    if (!Capacitor.isNativePlatform()) return;
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Light : Style.Dark });
  } catch {
    // StatusBar is unavailable on web / older shells; not worth surfacing.
  }
}
