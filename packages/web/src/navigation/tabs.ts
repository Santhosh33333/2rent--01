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
  Bell,
  Settings,
  LifeBuoy,
  ShieldCheck,
  LayoutDashboard,
  ClipboardList,
  MapPin,
  Package,
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
 * The five primary destinations. These are the only things that get a tab, and
 * they are identical for every consumer role so muscle memory survives a switch
 * between user and partner preview.
 */
export const PRIMARY_TABS: NavItem[] = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/requests", label: "Requests", icon: Inbox, matchPrefix: "/requests" },
  { to: "/messages", label: "Chat", icon: MessageCircle, matchPrefix: "/messages" },
  { to: "/profile", label: "Profile", icon: User },
];

/** Consumer "More" destinations. Grouped so the sheet reads as a menu, not a dump. */
export const USER_MORE: NavGroup[] = [
  {
    title: "My activity",
    items: [
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
      { to: "/ai", label: "AI assistant", icon: Sparkles, matchPrefix: "/ai" },
    ],
  },
  {
    title: "Account",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell, matchPrefix: "/notifications" },
      { to: "/subscription", label: "Subscription", icon: ShieldCheck, matchPrefix: "/subscription" },
      { to: "/settings", label: "Settings", icon: Settings, matchPrefix: "/settings" },
      { to: "/support", label: "Help & support", icon: LifeBuoy },
    ],
  },
];

export const PARTNER_MORE: NavGroup[] = [
  {
    title: "Partner",
    items: [
      { to: "/partner/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/partner/jobs", label: "Jobs", icon: ClipboardList },
      { to: "/partner/map", label: "Live map", icon: MapPin },
      { to: "/partner/wallet", label: "Wallet", icon: Wallet },
      { to: "/partner/performance", label: "Performance", icon: ClipboardList },
      { to: "/partner/profile", label: "Partner profile", icon: User },
    ],
  },
  {
    title: "Carry buddy",
    items: [
      { to: "/carry/dashboard", label: "Carry dashboard", icon: Package },
      { to: "/carry/jobs", label: "Carry jobs", icon: ClipboardList },
      { to: "/carry/route", label: "My route", icon: MapPin },
      { to: "/carry/earnings", label: "Earnings", icon: Wallet },
    ],
  },
  {
    title: "Account",
    items: USER_MORE[2].items,
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