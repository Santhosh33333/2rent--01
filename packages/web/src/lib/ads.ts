import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdPosition,
  BannerAdSize,
  MaxAdContentRating,
} from '@capacitor-community/admob';

/**
 * Google AdMob monetisation.
 *
 * Two rules are load-bearing and should not be relaxed:
 *
 *  1. Consent (UMP) is resolved before any ad is requested. Serving a
 *     personalised ad without consent is a policy violation, not a style issue.
 *  2. Nothing here throws. AdMob is revenue, not a feature the booking flow
 *     depends on, so a failure must never break a page.
 *
 * Until real ad unit ids are configured this runs on Google's public test
 * units, which serve test ads and earn nothing. That is deliberate: it keeps
 * the integration exercised without risking invalid traffic before the app is
 * approved for Monetisation.
 */

const env = import.meta.env as unknown as Record<string, string | undefined>;

// Google's official test units. Safe to ship: they are not secrets and cannot
// serve a real paid impression.
const TEST_IDS = {
  banner: 'ca-app-pub-3940256099942544/6308257974',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  rewardedInterstitial: 'ca-app-pub-3940256099942544/5354046379',
} as const;

export const AD_UNITS = {
  banner: env.VITE_ADMOB_BANNER_ID || TEST_IDS.banner,
  interstitial: env.VITE_ADMOB_INTERSTITIAL_ID || TEST_IDS.interstitial,
  rewarded: env.VITE_ADMOB_REWARDED_ID || TEST_IDS.rewarded,
  rewardedInterstitial: env.VITE_ADMOB_REWARDED_INTERSTITIAL_ID || TEST_IDS.rewardedInterstitial,
} as const;

/** True while we are still on Google's test units, i.e. earning nothing. */
export const isTestMode = (): boolean =>
  AD_UNITS.banner === TEST_IDS.banner || AD_UNITS.interstitial === TEST_IDS.interstitial;

export type ConsentState = 'unknown' | 'not-required' | 'obtained' | 'required' | 'refused';

let consentState: ConsentState = 'unknown';
let initialized = false;
let bannerVisible = false;
let canRequestAds = false;
let privacyOptionsRequired = false;

const INTERSTITIAL_MIN_GAP_MS = 4 * 60 * 1000;
let lastInterstitialAt = 0;
let interstitialReady = false;
let consentInFlight: Promise<void> | null = null;

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getConsentState(): ConsentState {
  return consentState;
}

export function canServeAds(): boolean {
  return initialized && canRequestAds;
}

export function isPrivacyOptionsRequired(): boolean {
  return privacyOptionsRequired;
}

/** AdMob runs on the native build only; there is no browser equivalent. */
function pluginAvailable(): boolean {
  if (!isNative()) return false;
  const platform = Capacitor.getPlatform();
  return platform === 'android' || platform === 'ios';
}

async function resolveConsent(): Promise<void> {
  if (consentInFlight) return consentInFlight;

  consentInFlight = (async () => {
    try {
      let info = await AdMob.requestConsentInfo();
      if (info.status === 'REQUIRED' && info.isConsentFormAvailable) {
        info = await AdMob.showConsentForm();
      }
      consentState = info.status === 'OBTAINED' ? 'obtained'
        : info.status === 'NOT_REQUIRED' ? 'not-required'
        : info.status === 'REQUIRED' ? 'required'
        : 'unknown';
      canRequestAds = Boolean(info.canRequestAds);
      privacyOptionsRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
    } catch (err) {
      // No consent information means we do not serve ads. Fail closed.
      consentState = 'unknown';
      canRequestAds = false;
      console.warn('[ads] consent check failed, ads disabled:', err);
    }
  })();

  return consentInFlight;
}

/**
 * Idempotent. Call once at app start. Resolves even if ads end up disabled.
 */
export async function initializeAds(): Promise<void> {
  if (initialized || !pluginAvailable()) return;
  try {
    await resolveConsent();
    await AdMob.initialize({
      // Flag the device as a test device so an unreviewed build cannot produce
      // the invalid traffic that gets an AdMob account suspended.
      initializeForTesting: isTestMode(),
      maxAdContentRating: MaxAdContentRating.ParentalGuidance,
    });
    initialized = true;
  } catch (err) {
    console.warn('[ads] initialization failed:', err);
  }
}

export async function showBanner(position: BannerAdPosition = BannerAdPosition.BOTTOM_CENTER): Promise<void> {
  if (!canServeAds() || bannerVisible) return;
  try {
    await AdMob.showBanner({
      adId: AD_UNITS.banner,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position,
      isTesting: isTestMode(),
    });
    bannerVisible = true;
  } catch (err) {
    console.warn('[ads] showBanner failed:', err);
  }
}

export async function hideBanner(): Promise<void> {
  if (!bannerVisible) return;
  try {
    await AdMob.hideBanner();
    bannerVisible = false;
  } catch (err) {
    console.warn('[ads] hideBanner failed:', err);
  }
}

export async function destroyBanner(): Promise<void> {
  if (!bannerVisible) return;
  try {
    await AdMob.removeBanner();
    bannerVisible = false;
  } catch (err) {
    console.warn('[ads] removeBanner failed:', err);
  }
}

/** Warm the cache so an interstitial can appear without a visible delay. */
export async function prepareInterstitial(): Promise<void> {
  if (!canServeAds() || interstitialReady) return;
  try {
    await AdMob.prepareInterstitial({ adId: AD_UNITS.interstitial, isTesting: isTestMode() });
    interstitialReady = true;
  } catch (err) {
    console.warn('[ads] prepareInterstitial failed:', err);
  }
}

/**
 * Show an interstitial, subject to a frequency cap.
 *
 * Deliberately does NOT fire on: app launch or resume, app exit, immediately
 * after another interstitial, or on the confirmation step of any user action.
 * Interstitials at those points are the accidental-click pattern AdMob policy
 * prohibits, and they are the fastest way to get an account suspended.
 */
export async function maybeShowInterstitial(): Promise<boolean> {
  if (!canServeAds() || !interstitialReady) return false;
  const now = Date.now();
  if (now - lastInterstitialAt < INTERSTITIAL_MIN_GAP_MS) return false;
  try {
    await AdMob.showInterstitial({ adId: AD_UNITS.interstitial });
    lastInterstitialAt = now;
    interstitialReady = false;
    return true;
  } catch (err) {
    console.warn('[ads] showInterstitial failed:', err);
    return false;
  }
}

/** Opens the "privacy options" sheet so a user can change their choice later. */
export async function showPrivacyOptionsForm(): Promise<void> {
  if (!initialized || !privacyOptionsRequired) return;
  try {
    await AdMob.showPrivacyOptionsForm();
  } catch (err) {
    console.warn('[ads] privacy options form failed:', err);
  }
}

/** For a "manage ad choices" entry in Settings. */
export async function resetConsent(): Promise<void> {
  if (!initialized) return;
  try {
    await AdMob.resetConsentInfo();
    await resolveConsent();
  } catch (err) {
    console.warn('[ads] resetConsent failed:', err);
  }
}
