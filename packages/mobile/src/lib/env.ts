// Central configuration. The API URL must be provided per environment:
//  - Expo build constant: `expo.extra.apiUrl` in app.json (used for release builds)
//  - or env var: EXPO_PUBLIC_API_URL
//  - dev fallback: http://localhost:5000/api (works for iOS sim / Android emu 10.0.2.2
//    only when proxied; physical devices MUST set apiUrl). Never hardcode a specific
//    machine's LAN IP here — it breaks on every other device.
import Constants from 'expo-constants';

const EXPO_API = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const ENV_API = process.env.EXPO_PUBLIC_API_URL as string | undefined;

export const API_URL: string = EXPO_API || ENV_API || 'http://localhost:5000/api';

export const APP_NAME = 'RentBuddy';
export const CURRENCY = 'INR';
