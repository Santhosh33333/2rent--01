/**
 * The landing page's navigation surface, in one place.
 *
 * This list is rendered twice — as the scrolling marquee under the hero and as
 * the discovery grid further down — and it used to be duplicated, which is a
 * trap: adding a route to one copy and not the other ships a tile that either
 * 404s or goes missing. One export, two consumers.
 *
 * Every entry points at a route that exists. There is no `/partners` page,
 * which is why "Partner Services" resolves to the walking-requests flow rather
 * than a link to nothing.
 */
export const DISCOVERY = [
  { label: 'Friendship', to: '/discover?intent=friendship', accent: '#EC6A9C' },
  { label: 'Dating', to: '/discover?intent=dating', accent: '#7C5CF0' },
  { label: 'Walking', to: '/walking-requests', accent: '#22B8CF' },
  { label: 'Travel', to: '/discover?intent=travel', accent: '#2B4FD8' },
  { label: 'Sports', to: '/sports', accent: '#2B4FD8' },
  { label: 'Movies', to: '/movies', accent: '#A78BFA' },
  { label: 'Gaming', to: '/discover?intent=gaming', accent: '#7C5CF0' },
  { label: 'Food & Coffee', to: '/discover?intent=food', accent: '#EC6A9C' },
  { label: 'Study', to: '/discover?intent=study', accent: '#22B8CF' },
  { label: 'Communities', to: '/communities', accent: '#A78BFA' },
  { label: 'Partner Services', to: '/walking-requests', accent: '#2B4FD8' },
  { label: 'Events', to: '/events', accent: '#EC6A9C' },
] as const;