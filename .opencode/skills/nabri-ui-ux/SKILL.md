---
name: nabri-ui-ux
description: Premium UI/UX work on the Nabri app — home screen, responsive layouts, bottom navigation, accessible components, light/dark theming, reusable design primitives and mobile performance. Load this before changing any screen, layout, navigation or visual styling in packages/web.
---

# Nabri UI/UX

## When to use this skill

Any change that touches how a screen looks or is arranged: new pages, redesigns,
navigation changes, theme/accent work, responsive breakpoints, motion, or
component-level visual polish. If the change is purely business logic with no
visual surface, do not load this.

## Design system (read before inventing anything)

The system already exists. Extend it, do not fork it.

- **Tokens** — `packages/web/tailwind.config.js` exposes a `surface` colour ramp
  and `primary` accent scale. `darkMode: 'class'`.
- **Accents** — CSS variables `--c-50 … --c-950` on `html[data-accent]`, defined
  in `packages/web/src/styles/globals.css`. Default is navy; coral is the legacy
  accent. Never hardcode a hex accent colour in a component.
- **Theme** — `src/lib/themeContext.tsx` toggles `dark` on `<html>`, persists
  `theme` and `accent` in localStorage, and honours `prefers-reduced-motion`
  where used. Respect it; do not read `window.matchMedia` directly.
- **Safe areas** — use `--safe-bottom`, `--safe-left`, `--safe-right`, `--safe-top`
  (Capacitor injects `--safe-area-inset-*` on Android WebView, where `env()` is
  unreliable). The tab bar already does this — copy that pattern.
- **Existing primitives** — reuse, never re-create:
  `GlassCard` (`variant`, `padding`), `AnimatedPage` (stagger), `Reveal`
  (scroll reveal), `Tilt` (pointer parallax), `PageHeader`, `EmptyState`,
  `SkeletonLoader`, `Modal`, `BottomSheet`, `ScreenState`, and `components/ui/*`.

## Rules for screens

1. **Mobile first.** The primary target is a 360–430 px viewport inside a
   Capacitor WebView. Design the single column first, then widen. `lg:` is the
   desktop/desktop-web breakpoint; the bottom tab bar is `lg:hidden`.
2. **Never crowd the first screen.** Home shows a greeting, one search field,
   one primary action row and at most two content blocks above the fold.
   Everything else scrolls.
3. **Every async block needs four states**: loading (skeleton, matching the
   final layout's size), empty (a real explanation and a next step), offline,
   error (with a retry). `components/ui/ScreenState` exists for this.
4. **No fabricated content.** Never render a placeholder name, avatar, rating,
   event or count as if it were real. An honest empty state always beats a
   convincing fake. This is a product rule, not a style preference.
5. **Motion is a garnish.** Use the existing `Reveal`/`AnimatedPage` and keep
   transitions ≤ 300 ms. Wrap non-essential motion in
   `motion-reduce:` variants. Never animate layout in a way that delays a tap.
6. **Accessibility.** Icons never carry meaning alone — pair with a label or
   `aria-label`. Use `aria-current` on active nav. Test at 200 % text zoom; the
   phone font scale injects `--app-font-base`, so avoid fixed px heights on
   text containers.

## Navigation

Navigation is declared, not inferred. `src/navigation/tabs.ts` is the single
source of truth for the bottom tabs and the "More" sheet groups. Add destinations
there rather than hardcoding links in a layout. `isNavItemActive` lights up a
tab for child routes via `matchPrefix`.

## Performance budget

- The home screen must render without waiting on every request: fetch
  independently with `Promise.allSettled` and degrade to empty blocks. A
  failing widget must never blank the page.
- Lazy-load anything heavy (`React.lazy` for routes is already wired in
  `App.tsx`). Do not import `three`, `leaflet` or `jspdf` at module top level
  on a hot path.
- Images: always `loading="lazy"` offscreen, explicit dimensions to avoid CLS,
  and route binaries through `assetUrl()`.
- Never poll. Use `useSocket` for live updates; a 10-second `setInterval`
  against the API is a defect.

## Verify

`npm run typecheck` and `npm run build` from `packages/web` must both pass
before declaring a UI change done. There is no web test suite — say so rather
than implying tests cover it.
