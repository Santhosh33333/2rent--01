/// <reference types="vite/client" />

/** Injected by vite.config.ts at build time; identifies the deployed version. */
declare const __BUILD_ID__: string

/**
 * Injected by vite.config.ts at build time: whether an APK was actually present
 * when this bundle was built. `*.apk` is gitignored, so deploys frequently have
 * no APK — the UI must say NOT CONFIGURED rather than link to a 404.
 */
declare const __APK_AVAILABLE__: boolean

/** Real size in MB of the APK shipped with this build, or null if none. */
declare const __APK_SIZE_MB__: number | null
