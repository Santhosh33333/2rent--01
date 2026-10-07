import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdPosition,
  BannerAdPluginEvents,
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

/**
 * True while the banner - the only ad this app serves automatically - is still
 * on Google's test unit, i.e. earning nothing.
 *
 * Deliberately judged on the banner alone: `initializeForTesting` flags the
 * whole device as a test device, so basing it on every unit (an interstitial
 * or rewarded unit an admin may never have created still falls back to the
 * test id) would silently zero out live banner earnings.
 */
export const isTestMode = (): boolean =>
  AD_UNITS.banner === TEST_IDS.banner;

export type ConsentState = 'unknown' | 'not-required' | 'obtained' | 'required' | 'refused';

let consentState: ConsentState = 'unknown';
let initialized = false;
let bannerVisible = false;
/** Live banner height in dp (= CSS px in the WebView); 0 when none is up. */
let bannerHeight = 0;
let bannerListenerAttached = false;
let canRequestAds = false;
let privacyOptionsRequired = false;

const INTERSTITIAL_MIN_GAP_MS = 4 * 60 * 1000;
let lastInterstitialAt = 0;
let interstitialReady = false;
let consentInFlight: Promise<void> | null = null;

export type AdsState = {
  initialized: boolean;
  consentState: ConsentState;
  canRequestAds: boolean;
  privacyOptionsRequired: boolean;
  isTestMode: boolean;
  bannerVisible: boolean;
  bannerHeight: number;
};

const listeners = new Set<(state: AdsState) => void>();

function snapshot(): AdsState {
  return {
    initialized,
    consentState,
    canRequestAds: canRequestAds && initialized,
    privacyOptionsRequired,
    isTestMode: isTestMode(),
    bannerVisible,
    bannerHeight,
  };
}

function notify(): void {
  const state = snapshot();
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (err) {
      // A misbehaving subscriber must not stop the others or the ad pipeline.
      console.warn('[ads] state listener threw:', err);
    }
  }
}

/**
 * Observe ad state. Consent is resolved asynchronously at boot, so a component
 * that reads isPrivacyOptionsRequired() once on mount will almost always see
 * `false` and never render its "manage ad choices" entry. Subscribing is how
 * the UI stays correct without polling.
 */
export function subscribeAdsState(listener: (state: AdsState) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

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
    } finally {
      notify();
    }
  })();

  return consentInFlight;
}

/**
 * Anchored adaptive banners are 50-90dp tall depending on what AdMob chooses
 * to fill with, and the app shell reserves a strip for the ad so page content
 * and the tab bar never sit behind it. Guessing one height either covers the
 * tab bar (too small) or wastes a band of empty space (too large), so the
 * strip follows the real size the plugin reports through
 * `bannerAdSizeChanged` - dp on Android, which equals CSS px in the WebView.
 */
async function trackBannerSize(): Promise<void> {
  if (bannerListenerAttached) return;
  bannerListenerAttached = true;
  try {
    await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (info) => {
      const height = Number(info?.height) || 0;
      if (height === bannerHeight) return;
      bannerHeight = height;
      notify();
    });
  } catch (err) {
    // Losing the size event only means the shell keeps its fallback strip.
    bannerListenerAttached = false;
    console.warn('[ads] banner size listener failed:', err);
  }
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
    // Attached before the first banner so the initial size event is not missed.
    await trackBannerSize();
  } catch (err) {
    console.warn('[ads] initialization failed:', err);
  } finally {
    notify();
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
    notify();
  } catch (err) {
    console.warn('[ads] showBanner failed:', err);
  }
}

export async function hideBanner(): Promise<void> {
  if (!bannerVisible) return;
  try {
    await AdMob.hideBanner();
    bannerVisible = false;
    bannerHeight = 0;
    notify();
  } catch (err) {
    console.warn('[ads] hideBanner failed:', err);
  }
}

export async function destroyBanner(): Promise<void> {
  if (!bannerVisible) return;
  try {
    await AdMob.removeBanner();
    bannerVisible = false;
    bannerHeight = 0;
    notify();
  } catch (err) {
    console.warn('[ads] removeBanner failed:', err);
  }
}

/** Warm the cache so an interstitial can appear without a visible delay. */
export async function prepareInterstitial(): Promise<void> {
  if (!canServeAds() || interstitialReady) return;
  try {
    await AdMob.prepareInterstitial({
      adId: AD_UNITS.interstitial,
      // Judged per unit: a live unit must never inherit the test-device flag
      // from an unrelated fallback id.
      isTesting: AD_UNITS.interstitial === TEST_IDS.interstitial,
    });
    interstitialReady = true;
  } catch (err) {
    console.warn('[ads] prepareInterstitial failed:', err);
  }
}

/**
 * Show an interstitial, subject to a frequency cap.
 *
 * Nothing calls this automatically any more: the full-screen takeover was
 * removed by request ("don't want come full page"). It stays exported only so
 * an explicitly labelled, user-initiated flow can opt back in - never on app
 * launch, resume, exit, or the confirmation step of a user action, which is
 * the accidental-click pattern AdMob policy prohibits.
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

/**
 * Rewarded video. Must only ever be called from a real, labelled opt-in ("Watch
 * a short video for a discount"), never automatically: an unprompted rewarded
 * ad violates the opt-in requirement and is a suspension risk.
 *
 * Resolves true only when the user actually earned the reward, so callers can
 * gate a discount on it without handing out rewards for skipped ads.
 */
export async function showRewardedAd(): Promise<boolean> {
  if (!canServeAds()) return false;
  try {
    await AdMob.prepareRewardVideoAd({
      adId: AD_UNITS.rewarded,
      isTesting: AD_UNITS.rewarded === TEST_IDS.rewarded,
    });
    // The plugin resolves this with an AdMobRewardItem ({ type, amount }) when
    // the user earns the reward, and rejects on dismissal/failure, so reaching
    // the return is the signal to grant whatever the caller was promising.
    const result = await AdMob.showRewardVideoAd();
    return result !== undefined && result !== null;
  } catch (err) {
    console.warn('[ads] showRewardedAd failed:', err);
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
