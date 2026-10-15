// Friendship categories shown on the first step of the booking wizard.
//
// The backend prices and matches by *service* (the five keys in
// ../lib/serviceCatalog.ts), so every category here carries a `service` — the
// booking is still created against a real service. The categories are the
// customer-facing granularity: they say what kind of company someone wants,
// and the wizard derives the service(s) from whatever is selected.
//
// This is presentation content, not data: nothing is persisted per category
// beyond the derived service. Keep `service` values inside the live catalogue.
export interface FriendshipCategory {
  key: string
  title: string
  description: string
  icon: string // emoji glyph
  service: string // one of the SERVICE_CATALOG keys
  badge?: string // e.g. 'FRIENDS ONLY' for the platonic date categories
}

export const FRIENDSHIP_CATEGORIES: FriendshipCategory[] = [
  // Talk — conversation
  { key: 'late-night-talks', title: 'Late-night talks', description: "Long chats when you can't sleep", icon: '🌙', service: 'TALK' },
  { key: 'deep-conversations', title: 'Deep conversations', description: 'Life, ideas and everything else', icon: '🧠', service: 'TALK' },
  { key: 'career-talk', title: 'Career talk', description: 'A sounding board for work', icon: '💼', service: 'TALK' },
  { key: 'language-practice', title: 'Language practice', description: 'Practise a language patiently', icon: '🗣️', service: 'TALK' },
  { key: 'everyday-chat', title: 'Everyday chat', description: 'Just a friendly conversation', icon: '💬', service: 'TALK' },

  // Vent — emotional support
  { key: 'vent-be-heard', title: 'Vent & be heard', description: 'Say it all to someone who listens', icon: '👂', service: 'VENT' },
  { key: 'anxiety-support', title: 'Anxiety support', description: 'Calm company when your mind races', icon: '🌊', service: 'VENT' },
  { key: 'heartbreak-support', title: 'Heartbreak support', description: 'Talk through a breakup', icon: '💔', service: 'VENT' },
  { key: 'stress-relief', title: 'Stress relief', description: 'Unwind and let it out', icon: '😮‍💨', service: 'VENT' },
  { key: 'feeling-lonely', title: 'Feeling lonely', description: 'Company when you feel alone', icon: '🫂', service: 'VENT' },

  // Time-pass — company
  { key: 'coffee-company', title: 'Coffee company', description: 'Share a coffee and pass the time', icon: '☕', service: 'TIME_PASS' },
  { key: 'shopping-company', title: 'Shopping company', description: 'Company while you run errands', icon: '🛍️', service: 'TIME_PASS' },
  { key: 'movie-company', title: 'Movie company', description: 'Chat about a film together', icon: '🎬', service: 'TIME_PASS' },
  { key: 'gaming-buddy', title: 'Gaming buddy', description: 'Team up for a game', icon: '🎮', service: 'TIME_PASS' },
  { key: 'walk-and-talk', title: 'Walk & talk', description: 'A friendly chat on a walk', icon: '🚶', service: 'TIME_PASS' },
  { key: 'chores-company', title: 'Company for chores', description: 'Someone to keep you company', icon: '🧹', service: 'TIME_PASS' },

  // Date — friendly, explicitly platonic
  { key: 'coffee-date', title: 'Coffee date', description: 'A friendly coffee meet-up', icon: '☕', service: 'DATE', badge: 'FRIENDS ONLY' },
  { key: 'dinner-date', title: 'Dinner date', description: 'Share a meal and talk', icon: '🍽️', service: 'DATE', badge: 'FRIENDS ONLY' },
  { key: 'movie-date', title: 'Movie date', description: 'Watch something together', icon: '🍿', service: 'DATE', badge: 'FRIENDS ONLY' },
  { key: 'city-walk', title: 'City walk', description: 'Explore the city with company', icon: '🌆', service: 'DATE', badge: 'FRIENDS ONLY' },
  { key: 'dating-practice', title: 'Dating practice', description: 'Practise conversation, no pressure', icon: '🎯', service: 'DATE', badge: 'FRIENDS ONLY' },

  // Friends — making friends
  { key: 'make-new-friends', title: 'Make new friends', description: 'Meet someone new', icon: '🤝', service: 'FRIENDS' },
  { key: 'activity-partner', title: 'Activity partner', description: 'Find someone for your hobby', icon: '🏸', service: 'FRIENDS' },
  { key: 'gym-buddy', title: 'Gym buddy', description: 'A partner to keep you going', icon: '🏋️', service: 'FRIENDS' },
  { key: 'travel-buddy', title: 'Travel buddy', description: 'Company for a trip', icon: '✈️', service: 'FRIENDS' },
  { key: 'study-buddy', title: 'Book & study buddy', description: 'Read or study together', icon: '📚', service: 'FRIENDS' },
]

/** The service(s) covered by a set of selected category keys, in first-seen order. */
export function servicesForCategories(keys: string[]): string[] {
  const seen: string[] = []
  for (const key of keys) {
    const service = FRIENDSHIP_CATEGORIES.find((c) => c.key === key)?.service
    if (service && !seen.includes(service)) seen.push(service)
  }
  return seen
}
