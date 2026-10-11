import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.rentbuddy.app',
  appName: 'Nabri',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#0B256A',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#6366f1',
    },
    SystemBars: {
      // index.html already declares `viewport-fit=cover`; telling the built-in
      // SystemBars plugin up front avoids the one-frame layout shift it would
      // otherwise produce while reading the meta tag after page commit.
      initialViewportFitValueHint: 'cover',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#6366f1',
    },
  },
};

export default config;
