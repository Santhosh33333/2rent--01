import type { LucideIcon } from "lucide-react";
import {
  Home,
  Compass,
  Inbox,
  MessageCircle,
  User,
  Calendar,
  Users,
  Heart,
  Wallet,
  Ticket,
  Dumbbell,
  Clapperboard,
  Sparkles,
  Music,
  Bell,
  Settings,
  LifeBuoy,
  ShieldCheck,
  LayoutDashboard,
  ClipboardList,
  MapPin,
  Rss,
  Plus,
  BriefcaseBusiness,
} from "lucide-react";

/**
 * One place that decides what the navigation is.
 *
 * The previous layout derived its dock from `navItems.length > 5 ?
 * navItems.slice(0, 4) : navItems`, so a role with six entries silently lost
 * two of them behind an unlabelled "More" button, and the five visible slots
 * were whatever that role happened to list first. Navigation is a product
 * decision, so it is now declared rather than inferred from array length.
 */

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Longer routes (e.g. /bookings/:id) still light up their parent tab. */
  matchPrefix?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * The five customer-primary destinations. A customer account sees these; a
 * partner account gets its own set below, because a partner's job is to answer
 * requests, not to browse discovery.
 */
export const PRIMARY_TABS: NavItem[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/feed/new", label: "Create", icon: Plus, matchPrefix: "/feed/new" },
  // The Inbox tab surfaces "things waiting on me" (incoming likes + booking
  // requests). Conversations live one tap away in More → Messages, so the
  // fourth slot answers "is anything waiting for me?" rather than duplicating
  // the chat list that discovery links into directly.
  { to: "/requests", label: "Inbox", icon: Inbox, matchPrefix: "/requests" },
  { to: "/profile", label: "Profile", icon: User },
];

/**
 * Partner primary tabs (dock) for a partner-only surface.
 */
export const PARTNER_PRIMARY_TABS: NavItem[] = [
  { to: "/partner/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/partner/jobs", label: "Jobs", icon: ClipboardList, matchPrefix: "/partner/jobs" },
  { to: "/partner/map", label: "Map", icon: MapPin },
  { to: "/partner/wallet", label: "Wallet", icon: Wallet },
  { to: "/partner/profile", label: "Profile", icon: User },
];

/** Resolve the five primary tabs for a given role. */
export function primaryTabsForRole(role?: string | null): NavItem[] {
  if (role === "PARTNER") return PARTNER_PRIMARY_TABS;
  return PRIMARY_TABS;
}

/**
 * The same five destinations, declared as a drawer group.
 *
 * The dock is `lg:hidden`, so on a desktop browser the drawer is the only
 * navigation there is — and it used to start at "My activity", which left Home,
 * Discover, Create, Inbox and Profile unreachable above mobile widths. The More
 * sheet deliberately does not repeat this group: on a phone the dock already
 * carries these five, so showing them again there is just noise.
 */
export const MAIN_GROUP: NavGroup = { title: "Main", items: PRIMARY_TABS };

/**
 * The partner dock, declared as a drawer group. On a phone the dock already
 * carries these five; the drawer needs its own copy because it is `lg:block`
 * and the dock is `lg:hidden`, so a desktop partner would otherwise start at
 * "Partner" with no dashboard/jobs/map tab at all.
 */
export const PARTNER_MAIN_GROUP: NavGroup = { title: "Main", items: PARTNER_PRIMARY_TABS };

/** Consumer "More" destinations. Grouped so the sheet reads as a menu, not a dump. */
export const USER_MORE: NavGroup[] = [
  {
    title: "My activity",
    items: [
      { to: "/feed", label: "Feed", icon: Rss, matchPrefix: "/feed" },
      { to: "/messages", label: "Messages", icon: MessageCircle, matchPrefix: "/messages" },
      { to: "/bookings", label: "Bookings", icon: Calendar, matchPrefix: "/bookings" },
      { to: "/communities", label: "Communities", icon: Users, matchPrefix: "/communities" },
      { to: "/wallet", label: "Wallet", icon: Wallet, matchPrefix: "/wallet" },
    ],
  },
  {
    title: "Explore",
    items: [
      { to: "/dating", label: "Dating", icon: Heart, matchPrefix: "/dating" },
      { to: "/events", label: "Events", icon: Ticket, matchPrefix: "/events" },
      { to: "/sports", label: "Sports", icon: Dumbbell, matchPrefix: "/sports" },
      { to: "/movies", label: "Movies", icon: Clapperboard, matchPrefix: "/movies" },
      { to: "/music", label: "Music", icon: Music, matchPrefix: "/music" },
      { to: "/ai", label: "AI assistant", icon: Sparkles, matchPrefix: "/ai" },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell, matchPrefix: "/notifications" },
      { to: "/subscription", label: "Subscription", icon: ShieldCheck, matchPrefix: "/subscription" },
      { to: "/partner/apply", label: "Become a partner", icon: BriefcaseBusiness, matchPrefix: "/partner/apply" },
      { to: "/settings", label: "Settings", icon: Settings, matchPrefix: "/settings" },
      { to: "/support", label: "Help & support", icon: LifeBuoy },
    ],
  },
];

export const PARTNER_MORE: NavGroup[] = [
  {
    // Partner destinations that are NOT already dock tabs. Dashboard, Jobs,
    // Map, Wallet and Profile live in the dock, so repeating them here would
    // just show the same five links twice in the drawer and the More sheet.
    title: "Partner",
    items: [
      { to: "/partner/performance", label: "Performance", icon: ClipboardList },
      { to: "/messages", label: "Messages", icon: MessageCircle, matchPrefix: "/messages" },
    ],
  },
  {
    title: "Account",
    // An approved partner does not need the "Become a partner" call to action,
    // and has no customer subscription: both would dead-end for them, so they
    // are dropped from the shared Account group on the partner surface.
    items: USER_MORE[2].items.filter(
      (item) => item.to !== "/partner/apply" && item.to !== "/subscription",
    ),
  },
];

/** True when `pathname` should light up `item` as the active destination. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.to) return true;
  const prefix = item.matchPrefix ?? item.to;
  // Guard against `/discover` matching a hypothetical `/discovery`: require a
  // real segment boundary after the prefix.
  return pathname.startsWith(`${prefix}/`);
}