# Nabri — zero-budget growth plan

The goal: more people install and use Nabri without spending money on ads.
Everything here is either already in the app or is an action in the Play
Console, social channels, or the ground game around your existing users.

---

## 0. What was just fixed in the app (the foundation)

Growth only works if the invite actually works. Two real bugs were in the way:

- **Invite links were dead.** The share button built the link from
  `window.location.origin`. Inside the installed app the WebView is served from
  `https://localhost`, so every shared link was `https://localhost/register?ref=…`
  — unusable for anyone else. Links now always point at the public site
  (`https://2rent-01.vercel.app`, override with `VITE_PUBLIC_WEB_ORIGIN`).
- **Sharing was web-only and buried.** Share now uses the native Android share
  sheet (so WhatsApp / Telegram / SMS appear), adds a one-tap **Share on
  WhatsApp** button, shows a copyable link, and offers a **scannable QR**.
- **Discoverability.** A gift icon now sits in the app header on every screen,
  plus "Invite & earn" in the side menu, plus a dedicated `/invite` page.

That is the loop. The rest of this document is how you turn the loop on.

---

## 1. Unblock production: finish the Play testing requirement

**This is the single biggest growth blocker right now.** The app is only in
closed testing, so nobody outside your tester list can install it — no amount of
sharing changes that until it is on production.

For personal Google Play developer accounts, Google requires an app to run in
**closed testing with at least 12 testers who opted in, continuously for 14
days**, before you can apply for production access.

Actions:
1. Recruit 15–20 testers (friends, family, a WhatsApp group, college contacts).
   More than 12 so drop-outs don't reset the clock.
2. Send them the opt-in link: `https://play.google.com/apps/testing/app.rentbuddy.app`
3. Get them to **opt in, install, and open the app at least once** — an install
   without an opt-in does not count.
4. Track the 14-day window, then apply for production in the Console.

Until this is done, treat every other item as preparation.

---

## 2. Play Store listing (free, and it compounds)

Most installs come from search and browsing inside Play. Treat the listing as a
landing page.

- **Title (30 chars):** lead with the word people search. e.g.
  `Nabri: Meet People Nearby`
- **Short description (80 chars):** one clear promise, not a feature list. e.g.
  `Make friends, plan meetups, and find events around you.`
- **Full description:** first two lines carry the value (walks, events, dating,
  communities, chat, music rooms, movies). Put keywords people actually type:
  *make friends, meet people nearby, social meetup, dating, events near me*.
- **Screenshots (min 4, ideally 8):** show the best screens — Discover, a music
  room, an event, chat. Add short captions on the images.
- **Feature graphic (1024×500):** required; make it show the product, not the
  logo alone.
- **Category:** Social (or Dating if you lean that way — pick one and be honest).
- **Content rating + data safety form:** fill them properly; a missing form
  blocks rollout.

---

## 3. Make the referral loop actually move

The reward currently unlocks after the referee's **first completed booking**.
That is a high bar for a social app — most new users won't book quickly.

Consider, over time:
- A **signup-day reward** (small wallet credit on verified signup) so the first
  share feels worth it, with the booking reward as a bonus.
- Set amounts in the admin pricing config (`REFERRAL_BONUS_REFERRER` /
  `REFERRAL_BONUS_REFEREE`) — no code change needed.
- Add a **leaderboard / "you've invited 3 friends"** nudge on the invite page.

Measure: `GET /api/referrals` already returns invited/completed counts — watch
whether sharing converts into *installs*, not just clicks. If clicks are high and
installs are low, the landing/Play step is the leak.

---

## 4. The channels that cost nothing

Ranked by effort-to-reward for an India-first social app:

1. **WhatsApp Status + groups.** Your existing users' status is the highest-reach
   free channel. Give them something worth posting: the invite page already
   produces a link + message + QR. Consider a shareable "card" image later.
2. **College / hostel / apartment groups.** Where the early audience is. One
   enthusiastic person per group, with the invite link.
3. **Instagram Reels / YouTube Shorts.** 15–30s screen recordings of a music
   room syncing, a dating match, an event. Hook in the first 2 seconds. Post
   consistently; one reel that lands beats ten ads.
4. **Your event hosts and community admins.** They already bring groups. Turn
   them into distribution: every event page should have a share button (Event
   pages already use `navigator.share` — make it native + WhatsApp like the
   invite page).
5. **Local businesses / venues.** A cafe or activity host that lists an event on
   Nabri brings their whole customer base. Free for you, exposure for them.
6. **Content + SEO.** The public landing page and event pages are indexable. Write
   a handful of posts ("things to do in <city> this weekend") that link to the app.

---

## 5. In-app hooks worth adding next

Small, high-leverage, all zero-cost:

- **Rating prompt** after a positive moment (completed booking, accepted match) —
  drives Play ratings, which drive discovery.
- **Share button on profiles, posts, events, and music rooms** — reuse the same
  native-share + WhatsApp pattern as the invite page.
- **Push re-engagement** — "3 people near you joined this week", "an event
  starts tonight". Push is already wired (`pushNotifications.ts`).
- **"Invite 3 friends, unlock X"** progress on the invite page.

---

## 6. Measure the right things

- Referral **shares** vs. **installs** vs. **completed bookings**.
- Play Console → **Acquisition reports** (where installs come from).
- Retention: day-1 and day-7 return. Growth with no retention is a leaky bucket —
  fix week-1 retention before scaling spend of any kind.

---

## Order of operations

1. Finish the Play **12-testers / 14-days** requirement → get to production.
2. Fill out the **Play listing** properly (title, screenshots, feature graphic).
3. Push the **invite loop** to your testers and ask each to invite one person.
4. Post on **WhatsApp / Instagram** consistently for 30 days.
5. Turn **event hosts and communities** into distribution partners.
6. Add the in-app hooks in section 5 once the funnel is proven.
