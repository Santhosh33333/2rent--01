/**
 * The Nabri mark.
 *
 * Original geometry: a geometric "N" whose rounded terminals read as two people
 * joined by a path, set in a soft-gradient squircle. Nothing here is derived
 * from any third-party identity, and the mark is deliberately built from plain
 * SVG geometry so it stays crisp at every size and in both themes.
 */

export type NabriLogoSize = 'sm' | 'md' | 'lg' | 'xl';

const MARK_SIZE: Record<NabriLogoSize, number> = {
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
};

export function NabriMark({
  size = 'md',
  className = '',
  title = 'Nabri',
}: {
  size?: NabriLogoSize | number;
  className?: string;
  title?: string;
}) {
  const px = typeof size === 'number' ? size : MARK_SIZE[size];
  const gradientId = `nb-mark-grad-${px}`;

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 48 48"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#2B4FD8" />
          <stop offset="52%" stopColor="#22B8CF" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />

      {/* Inner light: a single quiet depth cue rather than a full 3D treatment. */}
      <rect
        x="0.75"
        y="0.75"
        width="46.5"
        height="46.5"
        rx="13.25"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1.5"
      />

      {/* The N. Round caps and joins keep the terminals soft so they read as
          two figures rather than as hard industrial geometry. */}
      <path
        d="M15 33.5V14.5L33 33.5V14.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark. `tone` swaps the wordmark colour for dark surfaces
 * instead of inverting the mark, which would put white-on-white.
 */
export function NabriLogo({
  size = 'md',
  tone = 'light',
  showWordmark = true,
  className = '',
}: {
  size?: NabriLogoSize | number;
  tone?: 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}) {
  const px = typeof size === 'number' ? size : MARK_SIZE[size];
  const wordSize = Math.round(px * 0.62);

  if (!showWordmark) {
    return <NabriMark size={size} className={className} title="" />;
  }

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: px * 0.28 }}
    >
      <NabriMark size={px} title="" />
      <span
        style={{
          fontSize: wordSize,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: tone === 'dark' ? '#FFFFFF' : '#16233C',
          fontFamily: "'Plus Jakarta Sans', 'Inter', ui-sans-serif, system-ui, sans-serif",
        }}
      >
        Nabri
      </span>
      <span
        aria-hidden="true"
        style={{
          width: Math.max(4, Math.round(px * 0.12)),
          height: Math.max(4, Math.round(px * 0.12)),
          borderRadius: 999,
          background: 'linear-gradient(135deg,#22B8CF,#A78BFA)',
          transform: 'translateY(-0.42em)',
        }}
      />
    </span>
  );
}
