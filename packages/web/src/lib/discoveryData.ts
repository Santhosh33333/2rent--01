import type { LucideIcon } from 'lucide-react'
import {
  Heart,
  Users,
  Clapperboard,
  Footprints,
  Package,
  Plane,
  CalendarDays,
  UsersRound,
  UtensilsCrossed,
  Dumbbell,
  Gamepad2,
  BookOpen,
  BriefcaseBusiness,
  Sparkles,
  ShieldCheck,
} from 'lucide-react'

export type DiscoveryCategoryKey =
  | 'dating'
  | 'friendship'
  | 'movies'
  | 'walking-buddy'
  | 'carrybuddy'
  | 'travel'
  | 'events'
  | 'communities'
  | 'food'
  | 'fitness'
  | 'sports'
  | 'gaming'
  | 'study'
  | 'networking'
  | 'local-activities'
  | 'safety'

export interface DiscoveryCategory {
  key: DiscoveryCategoryKey
  label: string
  summary: string
  icon: LucideIcon
  accent: string
  volume: string
  filters: string[]
  safetyRules: string[]
  workflow: string[]
  // No fabricated demo content. Real recommendations, when available from a
  // backend feed, are rendered by the page; otherwise an empty state is shown.
  recommendations: Array<{
    id: string
    title: string
    subtitle: string
    details: string
    meta: string
    badge?: string
  }>
}

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  {
    key: 'dating',
    label: 'Dating',
    summary: 'Discover compatible matches with privacy-first safety controls.',
    icon: Heart,
    accent: 'from-rose-500 to-pink-600',
    volume: 'Dating',
    filters: ['Distance', 'Age range', 'Interests', 'Languages', 'Lifestyle'],
    safetyRules: ['Approximate distance only', 'No exact home location', 'Age check enforced', 'Block and report controls'],
    workflow: ['Create profile', 'Set dating preferences', 'Discover suggestions', 'Mutual match and chat'],
    recommendations: [],
  },
  {
    key: 'friendship',
    label: 'Friendship',
    summary: 'Connect with people who share passions, routines, and local interests.',
    icon: Users,
    accent: 'from-blue-500 to-cyan-600',
    volume: 'Social',
    filters: ['Interests', 'Languages', 'Distance', 'Activities', 'Availability'],
    safetyRules: ['Share only what is comfortable', 'Never expose private contact details', 'Easy block and report flow'],
    workflow: ['Build social profile', 'Choose interests', 'Browse nearby connections', 'Send request and connect'],
    recommendations: [],
  },
  {
    key: 'movies',
    label: 'Movies',
    summary: 'Explore screenings, watchlists, and movie meetups that fit your plans.',
    icon: Clapperboard,
    accent: 'from-violet-500 to-purple-600',
    volume: 'Entertainment',
    filters: ['Genre', 'Language', 'Release date', 'Rating', 'Theatre'],
    safetyRules: ['No ticket guarantees until API connection', 'Use real listings or empty states', 'Meetup privacy controls'],
    workflow: ['Pick a movie', 'Check screening details', 'Create meetup or invite friends', 'RSVP'],
    recommendations: [],
  },
  {
    key: 'walking-buddy',
    label: 'Walking Buddy',
    summary: 'Book safe walking sessions with verified profiles and local routes.',
    icon: Footprints,
    accent: 'from-emerald-500 to-teal-600',
    volume: 'Active',
    filters: ['Distance', 'Time', 'Route type', 'Availability', 'Rating'],
    safetyRules: ['Walking booking stays separate from social activities', 'Share only general location', 'Emergency contact visibility can be managed'],
    workflow: ['Choose time and route', 'Confirm partner availability', 'Track ride progress', 'Complete and rate'],
    recommendations: [],
  },
  {
    key: 'carrybuddy',
    label: 'CarryBuddy',
    summary: 'Match with trusted helpers for errands, pickups, and drop-offs.',
    icon: Package,
    accent: 'from-amber-500 to-orange-600',
    volume: 'Errands',
    filters: ['Trip type', 'Distance', 'Schedule', 'Price', 'Verification'],
    safetyRules: ['Do not expose exact home address', 'Use booking contracts for value-based tasks', 'Report suspicious activity quickly'],
    workflow: ['Create task request', 'Approve helper', 'Track progress', 'Rate after completion'],
    recommendations: [],
  },
  {
    key: 'travel',
    label: 'Travel',
    summary: 'Find compatible travel buddies for destinations, trips, and group plans.',
    icon: Plane,
    accent: 'from-sky-500 to-indigo-600',
    volume: 'Trips',
    filters: ['Destination', 'Dates', 'Budget', 'Travel style', 'Group size'],
    safetyRules: ['Never expose exact home location', 'Travel verification and reporting enabled', 'Trip sharing can be managed'],
    workflow: ['Create trip', 'Set destination and budget', 'Match with compatible travelers', 'Plan and share'],
    recommendations: [],
  },
  {
    key: 'events',
    label: 'Events',
    summary: 'Join social, sport, movie, and city events created by the community.',
    icon: CalendarDays,
    accent: 'from-fuchsia-500 to-pink-600',
    volume: 'Events',
    filters: ['Category', 'Date', 'Distance', 'Privacy', 'RSVP'],
    safetyRules: ['Use the official event details', 'Capacity and privacy must be clear', 'Moderation for harmful or spam listings'],
    workflow: ['Browse event categories', 'Review details and capacity', 'RSVP or invite friends', 'Check in'],
    recommendations: [],
  },
  {
    key: 'communities',
    label: 'Communities',
    summary: 'Find local groups for interests, conversations, and social activity.',
    icon: UsersRound,
    accent: 'from-cyan-500 to-blue-600',
    volume: 'Groups',
    filters: ['Category', 'Members', 'Privacy', 'Location', 'Interests'],
    safetyRules: ['Moderation for spam and abuse', 'Private communities can restrict access', 'Members can block and report abuse'],
    workflow: ['Join a community', 'Browse posts or events', 'Join discussions', 'Create or host an activity'],
    recommendations: [],
  },
  {
    key: 'food',
    label: 'Food',
    summary: 'Discover new places, food events, and local hangouts with friends.',
    icon: UtensilsCrossed,
    accent: 'from-orange-500 to-amber-600',
    volume: 'Food',
    filters: ['Cuisine', 'Distance', 'Price', 'Rating', 'Timing'],
    safetyRules: ['Use real place data only', 'No invented venues', 'Review support only when available'],
    workflow: ['Search local spots', 'Save favorites', 'Invite friends to a meet-up', 'Review if supported'],
    recommendations: [],
  },
  {
    key: 'fitness',
    label: 'Fitness',
    summary: 'Find trainers, workout partners, and active social sessions.',
    icon: Dumbbell,
    accent: 'from-lime-500 to-green-600',
    volume: 'Fitness',
    filters: ['Activity', 'Time', 'Location', 'Skill level', 'RSVP'],
    safetyRules: ['Workout activities remain separate from booking services', 'Clear location and timing required', 'Respect safety and consent'],
    workflow: ['Choose activity type', 'Set date and location', 'Find partners', 'Join and RSVP'],
    recommendations: [],
  },
  {
    key: 'sports',
    label: 'Sports',
    summary: 'Play, train, and connect with people who enjoy local sports and active weekends.',
    icon: Dumbbell,
    accent: 'from-emerald-500 to-lime-600',
    volume: 'Sports',
    filters: ['Sport', 'Time', 'Location', 'Skill level', 'Level of play'],
    safetyRules: ['Use verified organizers when possible', 'Match on skill and availability', 'Respect time slots and consent'],
    workflow: ['Choose sport', 'Pick a time slot', 'Get matched to a group', 'Join and RSVP'],
    recommendations: [],
  },
  {
    key: 'gaming',
    label: 'Gaming',
    summary: 'Find gaming friends, communities, and sessions by platform and skill level.',
    icon: Gamepad2,
    accent: 'from-indigo-500 to-violet-600',
    volume: 'Gaming',
    filters: ['Game', 'Platform', 'Skill level', 'Availability', 'Language'],
    safetyRules: ['Create clear expectations for sessions', 'Avoid exposing private accounts without permission', 'Report abusive behavior'],
    workflow: ['Choose preferred game', 'Filter by skill and platform', 'Create or join a session', 'Play together'],
    recommendations: [],
  },
  {
    key: 'study',
    label: 'Study',
    summary: 'Connect with peers for courses, groups, revision sessions, and learning plans.',
    icon: BookOpen,
    accent: 'from-teal-500 to-cyan-600',
    volume: 'Study',
    filters: ['Subject', 'Course', 'Languages', 'Mode', 'Availability'],
    safetyRules: ['Online or offline mode should be explicit', 'Respect boundaries and privacy', 'Use group rules for study sessions'],
    workflow: ['Select subject or course', 'Choose availability', 'Create or join a study group', 'Stay accountable'],
    recommendations: [],
  },
  {
    key: 'networking',
    label: 'Networking',
    summary: 'Meet people by skills, interests, and professional goals without oversharing.',
    icon: BriefcaseBusiness,
    accent: 'from-slate-500 to-slate-700',
    volume: 'Professional',
    filters: ['Industry', 'Skills', 'Experience', 'Languages', 'Goals'],
    safetyRules: ['Do not expose private employment info without permission', 'Keep messages intentional and respectful', 'Event hosts can moderate access'],
    workflow: ['Set professional interests', 'Browse profiles', 'Connect and message', 'Join or host an event'],
    recommendations: [],
  },
  {
    key: 'local-activities',
    label: 'Local Activities',
    summary: 'Discover the city through meetups, tours, and weekend activities.',
    icon: Sparkles,
    accent: 'from-pink-500 to-rose-600',
    volume: 'City',
    filters: ['Activity type', 'Theme', 'Distance', 'Date', 'Language'],
    safetyRules: ['Only share approximate location details', 'Meetup organizers are responsible for safety info', 'Report unsafe events immediately'],
    workflow: ['Browse city activities', 'Read host and venue details', 'RSVP or invite friends', 'Show up prepared'],
    recommendations: [],
  },
  {
    key: 'safety',
    label: 'Safety Center',
    summary: 'Manage safety controls, reports, and account protection in one place.',
    icon: ShieldCheck,
    accent: 'from-red-500 to-rose-600',
    volume: 'Protection',
    filters: ['Report type', 'Urgency', 'Privacy', 'Account security'],
    safetyRules: ['Use verified emergency contacts', 'Block, report, and share only with purpose', 'Stay aware of dating and meetup safety guidance'],
    workflow: ['Review safety settings', 'Set emergency contact', 'Use privacy controls', 'Report issues when needed'],
    recommendations: [],
  },
]

export const DISCOVERY_BY_KEY = Object.fromEntries(
  DISCOVERY_CATEGORIES.map((category) => [category.key, category]),
) as Record<DiscoveryCategoryKey, DiscoveryCategory>

export const QUICK_ACTIONS = [
  { key: 'dating', label: '❤️ Dating', route: '/discover/dating' },
  { key: 'friendship', label: '🤝 Friendship', route: '/discover/friendship' },
  { key: 'movies', label: '🎬 Movies', route: '/discover/movies' },
  { key: 'walking-buddy', label: '🚶 Walking Buddy', route: '/discover/walking-buddy' },
  { key: 'carrybuddy', label: '📦 CarryBuddy', route: '/discover/carrybuddy' },
  { key: 'travel', label: '✈️ Travel', route: '/discover/travel' },
  { key: 'events', label: '🎉 Events', route: '/discover/events' },
  { key: 'communities', label: '👥 Communities', route: '/discover/communities' },
  { key: 'food', label: '🍔 Food', route: '/discover/food' },
  { key: 'fitness', label: '🏃 Fitness', route: '/discover/fitness' },
  { key: 'sports', label: '⚽ Sports', route: '/discover/sports' },
  { key: 'gaming', label: '🎮 Gaming', route: '/discover/gaming' },
  { key: 'study', label: '📚 Study', route: '/discover/study' },
  { key: 'networking', label: '💼 Networking', route: '/discover/networking' },
  { key: 'local-activities', label: '🌆 Local Activities', route: '/discover/local-activities' },
]
