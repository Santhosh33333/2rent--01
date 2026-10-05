/**
 * The brand mark.
 *
 * The reference design drew a script-font wordmark with a gradient heart. That
 * was a different company - Nabri's actual mark is a white "N" glyph with a
 * lime beacon, and it already exists as `logo-glyph-white.svg`, the asset the
 * rest of the app uses on dark surfaces. So this is the shipped logo rather
 * than a redrawn approximation of it.
 *
 * `logo-glyph.svg` is not used here: it fills with `currentColor`, which
 * resolves to black inside an `<img>` and disappears against a dark page.
 */
export function Brand({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`nb-logo ${className}`.trim()} style={{ ['--s' as string]: `${size}px` }}>
      <img src="/logo-glyph-white.svg" alt="" width={size} height={size} decoding="async" />
      <span>Nabri</span>
    </span>
  );
}
