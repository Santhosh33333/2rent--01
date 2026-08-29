# Implementation Plan: RentBuddy 2026 Enterprise Rebuild

## Overview

This plan covers the complete rebuild of the RentBuddy platform across 17 phases, migrating from SQLite/Clerk to PostgreSQL/Firebase Auth with Clean Architecture. The implementation uses TypeScript (Node.js/Express backend), React Native (mobile), and Next.js 14 (admin panel). Each phase builds on the previous, with database models and infrastructure established before services, and services before UI.

## Tasks

---

### Phase 1 — Project Foundation & Architecture

- [ ] 1. Initialize monorepo and shared infrastructure
  - [-] 1.1 Set up monorepo with packages/backend, packages/mobile, packages/admin-web
    - Initialize root `package.json` with workspaces config
    - Create `packages/backend` (Node.js/Express/TypeScript), `packages/mobile` (React Native/Expo), `packages/admin-web` (Next.js 14)
    - Add shared `tsconfig.base.json` with strict TypeScript settings
    - _Requirements: 22.1, 22.6, 22.7_

  - [x] 1.2 Implement backend Clean Architecture skeleton with all 15 feature module folders
    - Create `src/modules/` with subfolders: auth, users, kyc, bookings, partners, wallet, chat, communities, events, notifications, safety, rewards, search, ai, admin
    - Each module gets: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.routes.ts`, `*.dto.ts`, `*.types.ts` (stub files)
    - Create `src/config/`, `src/middleware/`, `src/jobs/`, `src/utils/` directories
    - _Requirements: 22.6, 22.7, 22.8_

  - [x] 1.3 Configure environment validation with Zod and set up Express app with core middleware
    - Write `src/config/env.ts` with Zod schema for all required env vars (DATABASE_URL, REDIS_URL, FIREBASE_*, RAZORPAY_*, LOCATIONIQ_API_KEY)
    - Write `src/app.ts` with Helmet, CORS, Morgan, express.json, and route mounting stubs
    - Write `src/utils/response.ts` with unified `{success, data, message, code}` envelope helpers
    - _Requirements: 20.5, 22.10_

  - [x] 1.4 Set up PostgreSQL with Prisma and implement the full schema (all 20+ models)
    - Configure `prisma/schema.prisma` with PostgreSQL provider
    - Define all models: User, Partner, KYC, KYCHistory, Booking, Wallet, Transaction, WithdrawalRequest, PaymentOrder, Event, EventAttendee, Community, CommunityMember, Friendship, UserBlock, Reward, SosIncident, AuditLog, Notification, PartnerLevel, PartnerEarnings, LoginHistory, Device, Session, EmergencyContact, AdminUser, Referral, FeatureFlag, BackupRecord
    - Add all indexes on FK, status, and timestamp fields
    - Run `prisma migrate dev --name init`
    - _Requirements: 22.1, 22.3, 19.7_

  - [ ]* 1.5 Write property test: round-trip serialization for all domain models
    - **Property 1 (Req 22.11): Serializing any domain model to JSON and deserializing back produces an object equal to the original**
    - Test User, Booking, Wallet, Transaction, KYC, Event, Community models
    - _Requirements: 22.11_

  - [~] 1.6 Initialize Firebase Admin SDK, Redis, and Bull queue infrastructure
    - Write `src/config/firebase.ts` — Admin SDK init from env vars
    - Write `src/config/redis.ts` — Redis client + Bull queue definitions (notifications, payouts, reports, booking, cron)
    - Write `src/jobs/config.ts` with default job options (3 retries, exponential backoff)
    - _Requirements: 22.2, 22.5, 19.8_

  - [~] 1.7 Implement auth middleware, RBAC middleware, rate limiter, request validator, and audit logger
    - Write `src/middleware/auth.ts` — Firebase ID token verification via `admin.auth().verifyIdToken()`
    - Write `src/middleware/rbac.ts` — `requirePermission()` factory with USER/PARTNER/ADMIN/SUPER_ADMIN permission map
    - Write `src/middleware/rateLimiter.ts` — 100/min auth, 20/min unauth using express-rate-limit + Redis store
    - Write `src/middleware/validate.ts` — Zod schema request validator returning VALIDATION_ERROR on failure
    - Write `src/middleware/auditLogger.ts` — writes AuditLog on successful write operations
    - _Requirements: 19.6, 20.2, 20.4, 20.6_

- [~] 2. Checkpoint — Foundation complete
  - Ensure all packages compile, Prisma migrations run clean, middleware chain loads without errors.


---

### Phase 2 — Authentication & User Onboarding

- [ ] 3. Implement auth module and user onboarding backend
  - [~] 3.1 Implement Firebase Auth integration: register, OTP verify, login, refresh, logout, forgot/reset password
    - Write `auth.service.ts`: `register()` creates Firebase Auth user + PostgreSQL User record + sends phone OTP
    - Write `auth.service.ts`: `verifyOtp()` checks OTP, marks `phoneVerified`, locks after 5 failed attempts (OTP_MAX_ATTEMPTS_EXCEEDED)
    - Write `auth.service.ts`: `login()`, `refresh()`, `logout()`, `forgotPassword()`, `resetPassword()`
    - Write `auth.controller.ts` and `auth.routes.ts` for all 8 auth endpoints
    - _Requirements: 1.3, 1.4, 1.5, 1.10, 1.11, 1.12, 1.13_

  - [ ]* 3.2 Write property test: session token round-trip
    - **Property 2 (Req 1.15): Encoding user credentials then decoding the session token produces a User object with the same userId**
    - _Requirements: 1.15_

  - [~] 3.3 Implement user module: profile CRUD, emergency contacts, account selection, suspicious login detection
    - Write `users.repository.ts` with Prisma CRUD for User model
    - Write `users.service.ts`: profile setup (displayName, avatarUrl via Firebase Storage, city, bio), emergency contact CRUD
    - Implement suspicious login detection (new device / new IP country) → security alert FCM + email
    - Write `users.controller.ts` and `users.routes.ts`
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 1.14, 20.7_

  - [ ]* 3.4 Write unit tests for auth edge cases
    - Test OTP lockout after 5 attempts, duplicate phone/email registration errors, session expiry
    - _Requirements: 1.5, 1.10, 1.11_

- [ ] 4. Implement React Native auth screens and design system
  - [~] 4.1 Set up React Native design system tokens and core components
    - Create `src/design-system/tokens/` with colors.ts, typography.ts, spacing.ts, radii.ts, shadows.ts per design spec
    - Create `theme.ts` with light and dark theme objects
    - Implement `GlassCard`, `Button`, `Input`, `Avatar`, `Skeleton`, `EmptyState`, `Toast`, `OtpInput` components
    - _Requirements: 21.1, 21.2, 21.4, 21.5, 21.6, 21.9_

  - [~] 4.2 Implement auth screens: Splash, Onboarding, Login, Register, OTP, Profile Setup, Emergency Contact, Account Selection, Permissions
    - Create `SplashScreen.tsx` (max 3s → navigate to Onboarding on first launch)
    - Create `OnboardingScreen.tsx` (3-slide carousel with feature descriptions)
    - Create `LoginScreen.tsx`, `RegisterScreen.tsx`, `OtpVerifyScreen.tsx`
    - Create `ProfileSetupScreen.tsx`, `EmergencyContactScreen.tsx`, `AccountSelectionScreen.tsx`, `PermissionsScreen.tsx`
    - Wire up `AuthStack.tsx` navigator and Zustand `authStore`
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8, 1.9, 1.14_

  - [ ]* 4.3 Write unit tests for auth screen navigation flows
    - Test splash → onboarding → register → OTP → profile setup sequence
    - _Requirements: 1.1, 1.2, 1.6_

- [~] 5. Checkpoint — Auth and onboarding complete
  - Ensure registration → OTP → profile setup flow works end-to-end. All auth API endpoints return correct error codes.


---

### Phase 3 — KYC System

- [ ] 6. Implement KYC backend module
  - [~] 6.1 Implement KYC service, repository, controller, and routes with status machine
    - Write `kyc.repository.ts` for KYC and KYCHistory Prisma CRUD
    - Write `kyc.service.ts`: 5-step wizard progress (20% per step), document upload to Firebase Storage (JPEG/PNG/PDF ≤5MB), selfie upload
    - Implement KYC status machine: NOT_STARTED → DRAFT → SUBMITTED → PENDING_REVIEW → UNDER_VERIFICATION → APPROVED | REJECTED | RESUBMIT_REQUIRED
    - Write `kyc.controller.ts` and `kyc.routes.ts` for all 6 KYC endpoints
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8, 2.9, 2.10_

  - [~] 6.2 Implement admin KYC review: approve/reject with reason, queue endpoint, notification dispatch
    - Implement approve flow: transition to APPROVED, ungate protected actions, send FCM push via Notification_Service
    - Implement reject flow: transition to REJECTED, record rejection reason, send FCM with reason
    - Write `GET /kyc/queue` endpoint sorted by submission date (oldest first)
    - _Requirements: 2.6, 2.7_

  - [ ]* 6.3 Write property test: KYC document URL round-trip
    - **Property 3 (Req 2.11): For all valid KYC document uploads, the document URL stored in Firestore is retrievable using the same path**
    - _Requirements: 2.11_

- [ ] 7. Implement KYC React Native screens
  - [~] 7.1 Build KYC wizard screens (5 steps with progress indicator)
    - Create 5 KYC step screens: document type selection, document front upload, document back upload, selfie capture, review & submit
    - Implement progress indicator showing 20% per completed step
    - Display "Verification in Progress" state while PENDING_REVIEW / UNDER_VERIFICATION
    - _Requirements: 2.2, 2.3, 2.4, 2.10_

  - [ ]* 7.2 Write unit tests for KYC status transitions
    - Test all valid transitions, test re-submission after REJECTED, test guard against re-submit during PENDING_REVIEW
    - _Requirements: 2.5, 2.8, 2.10_

- [~] 8. Checkpoint — KYC system complete
  - Verify document upload to Firebase Storage succeeds, status machine transitions correctly, admin review queue works.


---

### Phase 4 — Core Booking System (8-Step Flow)

- [ ] 9. Implement booking backend module
  - [~] 9.1 Implement booking repository, service, controller, and routes
    - Write `bookings.repository.ts` for Booking Prisma CRUD with cursor-based pagination
    - Write `bookings.service.ts`: KYC gate check, price estimation via LocationIQ + PricingService, Razorpay order creation
    - Write `bookings.controller.ts` and `bookings.routes.ts` for all 13 booking endpoints
    - Implement `POST /bookings/estimate` for pre-booking price calculation with optional coupon validation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [~] 9.2 Implement Razorpay webhook handler and booking payment flow
    - Write `payments.routes.ts` with `POST /payments/webhook` (HMAC signature verification)
    - On verified webhook: update Booking status to PAYMENT_SUCCESSFUL, debit user wallet, write to Firestore `activeBookings`, enqueue `partnerSearch` Bull job
    - Write `PaymentGateway` class wrapping Razorpay SDK for order creation and webhook verification
    - _Requirements: 5.5, 5.6, 5.7_

  - [~] 9.3 Implement booking state machine: all 12 statuses, dual OTP generation and verification
    - Implement all status transitions with guards (BOOKING_STATE_INVALID error on invalid transitions)
    - Write `utils/otp.ts`: generate two 6-digit OTPs (otpStart, otpEnd), verify OTP against booking record
    - Implement `POST /bookings/:id/start-otp` (partner enters start OTP → IN_PROGRESS + startedAt)
    - Implement `POST /bookings/:id/end-otp` (user enters end OTP → COMPLETED + completedAt + earnings credit)
    - _Requirements: 5.8, 5.9_

  - [~] 9.4 Implement partner matching, FCM notifications, 90-second timer, and 10-minute search timeout
    - Write `jobs/partnerSearchTimeout.ts` Bull job: geo-radius query for available/approved KYC partners within 10km, FCM to each, 10-min timeout auto-cancel with full refund
    - Implement `POST /bookings/:id/accept` (atomic DB transaction lock, cancel FCM to other partners, update Firestore)
    - Implement `POST /bookings/:id/reject` with 90-second timer enforcement
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7_

  - [~] 9.5 Implement invoice PDF generation, cancellation policy, refund logic, and Firestore activeBookings sync
    - Write `utils/invoice.ts`: pdfmake invoice with booking ID, service type, locations, duration, fare breakdown, partner name; upload to Firebase Storage
    - Implement cancellation policy: 100% refund before PARTNER_ACCEPTED; partial refund (cancellation fee) after PARTNER_ACCEPTED
    - Implement real-time `activeBookings/{bookingId}` Firestore sync on every status transition
    - _Requirements: 5.10, 5.12, 5.13_

  - [ ]* 9.6 Write property test: financial invariant for completed bookings
    - **Property 4 (Req 5.14): For all completed bookings, partnerEarning + platformFee + discountAmount === finalAmount**
    - Use fast-check to generate random fare amounts and verify the invariant holds
    - _Requirements: 5.14_

  - [~] 9.7 Implement partner location streaming to Firestore and real-time partner location updates
    - Backend: write `partnerLocations/{partnerId}` on every 5-second location update from partner app during IN_PROGRESS
    - Implement `PATCH /partners/availability` to toggle isAvailable and sync Firestore `partnerLocations`
    - _Requirements: 4.1, 4.2, 4.8_

  - [~] 9.8 Implement partner earnings crediting and PartnerEarnings record updates on booking completion
    - On COMPLETED: calculate `partnerEarning = finalAmount - platformFee`, credit Partner wallet with EARNING transaction
    - Update `PartnerEarnings` record (today/weekly/monthly/lifetime earnings, completedJobs)
    - Update `Partner.averageRating` when rating submitted
    - Write `utils/trustScore.ts` for deterministic TrustScore computation
    - _Requirements: 4.9, 5.11_

  - [ ]* 9.9 Write integration tests for the full 8-step booking flow
    - Test create → payment webhook → partner search → partner accept → start OTP → end OTP → completed
    - Test timeout flow: no partner in 10 min → cancelled + refund
    - _Requirements: 5.1 through 5.14_

- [ ] 10. Implement React Native booking screens
  - [~] 10.1 Build the 8-step booking wizard screens
    - Create Step1_ServiceSelect.tsx, Step2_LocationSchedule.tsx, Step3_PriceEstimate.tsx, Step4_Payment.tsx
    - Create Step5_PartnerMatching.tsx (searching animation), Step6_LiveTracking.tsx (MapView + partner pin via Firestore listener)
    - Create Step7_ServiceDelivery.tsx (OTP entry), Step8_Completion.tsx (invoice + rating)
    - Wire up `useBookingFlow.ts` multi-step state machine and `useActiveBooking.ts` Firestore listener
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 10.2 Write unit tests for booking wizard step validation
    - Test required field validation on Step 2, coupon validation on Step 3, OTP entry on Steps 6 and 7
    - _Requirements: 5.2, 5.4, 5.8, 5.9_

- [~] 11. Checkpoint — Booking system complete
  - Run full booking flow end-to-end. Verify Razorpay webhook processes correctly, partner matching works, invoices generate to Firebase Storage.


---

### Phase 5 — Wallet & Payments

- [ ] 12. Implement wallet and payments backend module
  - [~] 12.1 Implement wallet repository, service, controller, and routes
    - Write `wallet.repository.ts` for Wallet, Transaction, WithdrawalRequest, PaymentOrder Prisma CRUD
    - Write `wallet.service.ts`: top-up flow (Razorpay order create → webhook → credit), booking debit/refund, non-negative balance enforcement
    - Write `wallet.controller.ts` and `wallet.routes.ts` for all 6 wallet endpoints
    - _Requirements: 6.1, 6.2, 6.3, 6.8, 6.9, 6.10_

  - [~] 12.2 Implement withdrawal request lifecycle and Razorpay Payout API integration
    - Implement `POST /wallet/withdraw`: create WithdrawalRequest (PENDING), deduct from withdrawableBalance immediately, return INSUFFICIENT_BALANCE if amount > withdrawableBalance
    - Write `jobs/payoutProcessing.ts` Bull job: call Razorpay Payout API, update status to COMPLETED or FAILED + refund on failure
    - Implement admin approve/reject endpoints: approve triggers payout job; reject refunds amount to partner wallet
    - _Requirements: 6.4, 6.5, 6.6, 6.7_

  - [ ]* 12.3 Write property test: balance invariant for wallet transactions
    - **Property 5 (Req 6.11): For all wallet transactions, sum(credits) - sum(debits) applied to initial balance equals final balance**
    - Use fast-check to generate sequences of transactions and verify ledger integrity
    - _Requirements: 6.11_

  - [ ]* 12.4 Write property test: PaymentOrder round-trip serialization
    - **Property 6 (Req 6.12): Serializing a PaymentOrder to JSON and deserializing back produces an equivalent PaymentOrder**
    - _Requirements: 6.12_

- [ ] 13. Implement React Native wallet screens
  - [~] 13.1 Build wallet, transaction history, top-up, and withdraw screens
    - Create `WalletScreen.tsx` (balance overview, withdrawable balance, pending balance)
    - Create `TransactionHistoryScreen.tsx` with FlashList, filter by type and date range
    - Create `TopUpScreen.tsx` (Razorpay payment sheet integration)
    - Create `WithdrawScreen.tsx` (amount entry, bank/UPI selection)
    - _Requirements: 6.9_

  - [ ]* 13.2 Write unit tests for wallet UI edge cases
    - Test insufficient balance error display, zero balance state, pagination of transaction history
    - _Requirements: 6.5, 6.9_

- [~] 14. Checkpoint — Wallet and payments complete
  - Verify top-up credits wallet, withdrawal deducts withdrawableBalance, Razorpay payout job runs, balance invariant holds.


---

### Phase 6 — Real-Time Chat

- [ ] 15. Implement chat backend module
  - [~] 15.1 Implement ChatRequest gate, Firestore message delivery, and message operations
    - Write `chat.service.ts`: ChatRequest CRUD (send/accept/reject), gate enforcement before messaging
    - Implement Firestore-backed message delivery: write to `messages/{conversationId}/messages`, update `conversations/{conversationId}` lastMessage fields
    - Implement message operations: delete (replace with "Message deleted"), reply (replyToId reference), pin (max 3 per conversation)
    - Write `chat.controller.ts` and `chat.routes.ts` for all 10 chat endpoints
    - _Requirements: 7.1, 7.2, 7.6, 7.7, 7.8_

  - [~] 15.2 Implement typing indicators, read receipts, message reporting, and user blocking
    - Typing indicator: Firestore write to `typingIndicators/{conversationId}/users/{userId}` with 5s TTL
    - Read receipts: batch update message status to READ when ChatScreen mounts or message scrolls into view
    - Message reporting: create ChatReport record (PENDING), surface in admin moderation queue
    - User blocking: create UserBlock record, remove Friendship, prevent messages/calls/requests from blocked user
    - _Requirements: 7.4, 7.5, 7.11, 7.13_

  - [~] 15.3 Implement WebRTC call signaling via Firestore and message search
    - Write `callSignaling/{callId}` Firestore document for voice/video call lifecycle (ringing → accepted → ended)
    - Implement in-conversation message search endpoint
    - Wire AI spam detection hook on message send
    - _Requirements: 7.9, 7.10, 7.14_

  - [ ]* 15.4 Write property test: message round-trip storage
    - **Property 7 (Req 7.15): Storing a message then retrieving it by ID returns a message with the same senderId, content, and timestamp**
    - _Requirements: 7.15_

- [ ] 16. Implement React Native chat screens
  - [~] 16.1 Build conversations list, chat screen, and chat request screens
    - Create `ConversationsScreen.tsx` with FlashList and last message preview
    - Create `ChatScreen.tsx` with Firestore `onSnapshot` listener, message bubbles, media picker, voice note recorder
    - Create `ChatRequestsScreen.tsx` (sent/received request list with accept/reject actions)
    - Implement `useMessages.ts` Firestore listener and `useTypingIndicator.ts`
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [~] 16.2 Build voice note recorder, media message rendering, and call screens
    - Implement voice note recording (expo-av), playback with waveform display
    - Create `VoiceNotePlayer.tsx`, `MediaMessage.tsx` components
    - Create call screens: VoiceCallScreen.tsx, VideoCallScreen.tsx with WebRTC peer connection setup
    - Prevent screen sleep during active call, display call duration
    - _Requirements: 7.3, 7.10, 7.14_

  - [ ]* 16.3 Write unit tests for chat message type rendering
    - Test text, image, voice note, file, location, and deleted message bubble rendering
    - _Requirements: 7.3, 7.6_

- [~] 17. Checkpoint — Chat system complete
  - Verify message delivery under 2 seconds, typing indicators clear after 5 seconds, call signaling establishes WebRTC connection.


---

### Phase 7 — Communities

- [ ] 18. Implement communities backend module
  - [~] 18.1 Implement Community, CommunityMember, and CommunityPost models with CRUD and member lifecycle
    - Write `communities.repository.ts` for Community, CommunityMember Prisma CRUD
    - Write `communities.service.ts`: Community CRUD (KYC-gated creation, PUBLIC/PRIVATE), creator auto-assigned as OWNER
    - Implement join/leave: PUBLIC → add MEMBER + atomic increment; PRIVATE → create join request → OWNER/ADMIN approval
    - Implement remove member + LAST_OWNER_PROTECTION guard; mute member for configurable duration
    - Write `communities.controller.ts` and `communities.routes.ts` for all 10 community endpoints
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.10_

  - [~] 18.2 Implement community posts (text, image, poll, announcement, pinned) and cascade delete
    - Implement community post CRUD with post types: text, image, poll, announcement
    - Implement pin post (pinned posts sorted to top of feed)
    - Implement cascade delete on Community deletion (memberships, posts, associated data)
    - Implement atomic memberCount increment/decrement using Prisma transactions
    - _Requirements: 8.7, 8.8, 8.11_

  - [ ]* 18.3 Write property test: memberCount invariant
    - **Property 8 (Req 8.12): For all Communities, count of CommunityMember records with MEMBER/ADMIN/OWNER role equals Community.memberCount**
    - Use fast-check to simulate join/leave sequences and verify count consistency
    - _Requirements: 8.12_

- [ ] 19. Implement React Native community screens
  - [~] 19.1 Build communities list, community detail, create community, and feed screens
    - Create `CommunitiesListScreen.tsx`, `CommunityDetailScreen.tsx`, `CreateCommunityScreen.tsx`, `CommunityFeedScreen.tsx`
    - Implement join/leave actions, member list with role badges, post feed with pin indicators
    - _Requirements: 8.2, 8.3, 8.4_

  - [ ]* 19.2 Write unit tests for community membership edge cases
    - Test LAST_OWNER_PROTECTION error, duplicate join request prevention, PRIVATE community join request flow
    - _Requirements: 8.4, 8.6_

- [~] 20. Checkpoint — Communities complete
  - Verify memberCount stays consistent after concurrent joins/leaves, cascade delete removes all related records.

---

### Phase 8 — Events

- [ ] 21. Implement events backend module
  - [~] 21.1 Implement Event and EventAttendee models, CRUD, registration, QR ticket generation, and check-in
    - Write `events.repository.ts` for Event, EventAttendee Prisma CRUD
    - Write `events.service.ts`: Event CRUD (KYC-gated), INVALID_EVENT_DATES guard (end ≤ start)
    - Implement attendee registration: create EventAttendee, atomic attendeeCount increment, EVENT_CAPACITY_REACHED guard
    - Implement QR ticket generation: base64 JSON `{eventId, userId, attendeeId}`
    - Implement QR check-in: validate ticket, mark checkedIn=true, record checkedInAt
    - Write `events.controller.ts` and `events.routes.ts` for all 10 event endpoints
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [~] 21.2 Implement event cancellation with attendee FCM notifications and organizer analytics
    - Event cancellation: transition to CANCELLED, send FCM to all registered attendees via Notification_Service
    - Organizer analytics: total registrations, check-in count, check-in rate, attendee demographics
    - Implement cancel registration: delete EventAttendee, decrement attendeeCount
    - _Requirements: 9.7, 9.8, 9.9, 9.10_

  - [ ]* 21.3 Write property test: event capacity invariant
    - **Property 9 (Req 9.11): For all Events, count of EventAttendee records in REGISTERED or ATTENDED status ≤ Event.capacity when capacity is set**
    - Use fast-check to simulate concurrent registrations and verify capacity invariant
    - _Requirements: 9.11_

- [ ] 22. Implement React Native event screens
  - [~] 22.1 Build events list, event detail, create event, my ticket (QR display), and check-in scanner screens
    - Create `EventsListScreen.tsx`, `EventDetailScreen.tsx`, `CreateEventScreen.tsx`
    - Create `MyTicketScreen.tsx` (QR code display using react-native-qrcode-svg)
    - Create `CheckInScreen.tsx` (QR scanner using expo-camera/barcode-scanner)
    - Implement countdown timer showing time until event starts
    - _Requirements: 9.2, 9.4, 9.6, 9.7_

  - [ ]* 22.2 Write unit tests for event registration edge cases
    - Test capacity enforcement, duplicate registration prevention, cancellation decrements count
    - _Requirements: 9.4, 9.5, 9.10_

- [~] 23. Checkpoint — Events complete
  - Verify QR ticket generation and scanning work end-to-end, capacity limit enforced, cancellation FCM triggers.


---

### Phase 9 — Notifications System

- [ ] 24. Implement notifications backend module
  - [~] 24.1 Implement notification service with FCM token management, per-category delivery, and mute preferences
    - Write `notifications.service.ts`: FCM token registration/update in Firestore `fcmTokens/{userId}`, per-category notification dispatch
    - Implement category mute preferences: store in Firestore per-user settings, check before dispatching
    - Implement in-app Notification record creation and `mark-read` endpoints
    - Write `notifications.controller.ts` and `notifications.routes.ts` for all 5 notification endpoints
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.8_

  - [~] 24.2 Implement broadcast notification fan-out Bull job and stale FCM token cleanup cron
    - Write `jobs/notificationBroadcast.ts`: fan-out in batches of 500 to FCM `sendMulticast`, update BroadcastCampaign totalSent/totalDelivered
    - Write `jobs/fcmTokenCleanup.ts` cron (daily 03:00 IST): validate tokens with FCM dry-run, delete stale tokens from Firestore and Device table
    - _Requirements: 10.3, 10.9_

  - [ ]* 24.3 Write property test: broadcast sending invariant
    - **Property 10 (Req 10.10): For all broadcast campaigns, count of notifications in SENT status ≤ totalTargeted**
    - _Requirements: 10.10_

- [ ] 25. Implement React Native notification screens
  - [~] 25.1 Build notifications screen and notification preferences screen
    - Create `NotificationsScreen.tsx` with FlashList, per-category grouping, unread badge count
    - Create `NotificationPrefsScreen.tsx` with per-category mute toggles and quiet hours config
    - Implement `useNotifications.ts` hook and unread count badge on tab navigator
    - _Requirements: 10.4, 10.7, 10.8_

  - [ ]* 25.2 Write unit tests for notification preference persistence
    - Test mute toggle persists across app restarts, quiet hours suppresses in-app badge
    - _Requirements: 10.4, 10.7_

- [~] 26. Checkpoint — Notifications complete
  - Verify FCM delivery within 10 seconds, broadcast fan-out processes batches correctly, stale token cleanup runs.

---

### Phase 10 — Safety Center

- [ ] 27. Implement safety backend module
  - [~] 27.1 Implement SOS incident, trusted contacts, safety timer, live location sharing, and incident reporting
    - Write `safety.repository.ts` for SosIncident, EmergencyContact (TrustedContact) Prisma CRUD
    - Write `safety.service.ts`: trusted contact CRUD (max 5), SOS trigger (capture GPS, create SosIncident HIGH severity, write Firestore `sosAlerts`, FCM critical-priority to all online admins within 5s)
    - Implement safety timer: set/check-in/auto-SOS on expiry
    - Implement live location sharing with configurable TTL (15 min to 8 hours), auto-expiry
    - Implement incident report: category, description, optional photo evidence upload
    - Write `safety.controller.ts` and `safety.routes.ts` for all 8 safety endpoints
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9_

- [ ] 28. Implement React Native safety screens
  - [~] 28.1 Build safety center, SOS button, trusted contacts, and safety timer screens
    - Create `SafetyCenterScreen.tsx` with persistent shortcut on booking tracking screen during IN_PROGRESS
    - Create `SosScreen.tsx` (large SOS button → SMS to trusted contacts + admin alert)
    - Create `EmergencyContactsScreen.tsx` (add/remove trusted contacts, max 5)
    - Create `SafetyTimerScreen.tsx` (set timer, check-in, auto-SOS on expiry)
    - Implement `EmergencyCall` button → `Linking.openURL('tel:112')`
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 11.8_

  - [ ]* 28.2 Write unit tests for SOS trigger sequence
    - Test GPS capture, SosIncident creation, FCM admin alert, Firestore sosAlerts write
    - _Requirements: 11.2, 11.7_

- [~] 29. Checkpoint — Safety center complete
  - Verify SOS alert reaches admin panel within 5 seconds, safety timer auto-triggers SOS on expiry, live location sharing expires correctly.


---

### Phase 11 — Rewards & Gamification

- [ ] 30. Implement rewards backend module
  - [~] 30.1 Implement reward service with daily login, weekly streak, referral bonus, and milestone badges
    - Write `rewards.repository.ts` for Reward, PartnerLevel, PartnerEarnings Prisma CRUD
    - Write `rewards.service.ts`: daily login reward (once per IST calendar day, configurable points), weekly streak bonus (7 consecutive days)
    - Implement referral bonus: credit to referrer on referee's first booking completion
    - Implement milestone badges: FIRST_BOOKING, 10_BOOKINGS, 50_BOOKINGS, 100_BOOKINGS (award only once per milestone)
    - Implement retry on failure: up to 3 attempts before marking FAILED, log all failures
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.9_

  - [~] 30.2 Implement partner level recalculation, leaderboard refresh cron, and incentive multiplier updates
    - Partner level recalculation after each points event: BRONZE (0–499), SILVER (500–1999), GOLD (2000–4999), PLATINUM (5000+)
    - On level up: update incentiveMultiplier, send congratulatory FCM push
    - Write `jobs/leaderboardRefresh.ts` cron (every 60 min): aggregate top-100 users/partners by points, store in Redis with 65-min TTL
    - Write `jobs/dailyLoginRewards.ts` cron (00:00 IST): query eligible users, credit points, check streak
    - _Requirements: 12.5, 12.6, 12.8_

  - [ ]* 30.3 Write property test: partner level monotonic invariant
    - **Property 11 (Req 12.10): For all Partner level transitions, Partner.points ≥ minimum threshold for the new level at time of transition**
    - _Requirements: 12.10_

- [ ] 31. Implement React Native rewards screens
  - [~] 31.1 Build achievement gallery, leaderboard, and reward history screens
    - Create `AchievementGallery.tsx`: earned badges (with earned date) and locked badges (with unlock criteria)
    - Create `LeaderboardScreen.tsx`: top 100 users and partners, Redis-cached data
    - Create `RewardHistoryScreen.tsx`: paginated list of Reward records with type and points
    - Display partner level with progress bar to next level on PartnerDashboard
    - _Requirements: 12.7, 12.8_

  - [ ]* 31.2 Write unit tests for reward credit and retry logic
    - Test daily login idempotency (only one reward per day), streak reset on missed day, retry marks FAILED after 3 attempts
    - _Requirements: 12.1, 12.2, 12.9_

- [~] 32. Checkpoint — Rewards complete
  - Verify daily login cron runs once per day, leaderboard refreshes from Redis cache, milestone badges awarded exactly once per milestone.


---

### Phase 12 — Universal Search & AI Features

- [ ] 33. Implement search backend module
  - [~] 33.1 Implement universal search service with multi-entity results, geo-proximity sort, and block filtering
    - Write `search.service.ts`: query Partners (isAvailable, isApproved), Users (public profiles), Communities (PUBLIC only), Events (PUBLISHED only) in a single response
    - Apply block-aware filtering: exclude profiles blocked by or blocking the searcher
    - Apply geo-proximity sort for Partner results using LocationIQ distance
    - Implement type, city, date-range, and service-type filters
    - Write `search.controller.ts` and `search.routes.ts` for `GET /search` and `GET /search/autocomplete`
    - _Requirements: 13.1, 13.3, 13.4, 13.5, 13.7_

  - [~] 33.2 Implement autocomplete suggestions with Redis caching
    - Implement `GET /search/autocomplete?q=` returning suggestions after ≥2 chars, within 500ms
    - Cache autocomplete results per query prefix in Redis with 1-min TTL
    - _Requirements: 13.6_

  - [ ]* 33.3 Write property test: idempotent search
    - **Property 12 (Req 13.8): Applying the same search query twice in sequence returns results containing the same set of entity IDs**
    - _Requirements: 13.8_

- [ ] 34. Implement AI features backend module
  - [~] 34.1 Implement partner recommendation, friend suggestion, and route optimization
    - Write `ai.service.ts`: partner recommendation scoring (proximity × 0.4 + rating × 0.3 + booking history compatibility × 0.3), top 5 results
    - Implement friend suggestion scoring (mutual connections + shared communities + shared events + city), top 10 results
    - Implement route optimization for IN_PROGRESS bookings using LocationIQ routing with traffic data
    - _Requirements: 16.1, 16.2, 16.3_

  - [~] 34.2 Implement fraud risk scoring, spam detection, fake profile detection, and AI chatbot
    - Fraud risk score on registration: evaluate profile completeness, phone verification, device fingerprint; flag account for admin review if threshold exceeded
    - Spam detection on chat messages: analyze for spam patterns, suppress message and increment sender's spam score
    - Selfie duplicate detection during KYC: compare selfie against existing profile photos
    - AI customer support chatbot: knowledge base Q&A for top-50 FAQ
    - _Requirements: 16.4, 16.5, 16.6, 16.7, 16.8, 16.9_

  - [ ]* 34.3 Write unit tests for AI scoring functions
    - Test partner recommendation score ordering (higher proximity + rating = higher rank)
    - Test fraud score threshold flagging, spam score increment
    - _Requirements: 16.1, 16.4, 16.6_

- [ ] 35. Implement React Native search screen
  - [~] 35.1 Build search screen with autocomplete, filter chips, and entity-type result sections
    - Create `SearchScreen.tsx` with debounced autocomplete (200ms), multi-entity results (tabbed or sectioned)
    - Implement filter chips: All, Partners, Users, Communities, Events; city filter; date picker for events
    - Display "No results found" empty state with alternative query suggestions
    - _Requirements: 13.1, 13.3, 13.7_

  - [ ]* 35.2 Write unit tests for search filter state management
    - Test filter chip selection updates results, autocomplete debounce fires after 2 chars
    - _Requirements: 13.3, 13.6_

- [~] 36. Checkpoint — Search and AI complete
  - Verify multi-entity search returns results within 1 second, autocomplete within 500ms, fraud scoring flags test accounts correctly.


---

### Phase 13 — Partner Dashboard

- [ ] 37. Implement partner dashboard backend and React Native screens
  - [~] 37.1 Implement partner dashboard API: earnings chart data, bank details management, tax summary
    - Write `GET /partners/dashboard` endpoint: today/weekly/monthly/lifetime earnings, pending earnings, withdrawable balance, completed/cancelled jobs, average rating, current level, points to next level, acceptance rate
    - Implement earnings chart data endpoint (7/30/90-day daily bar chart data from PartnerEarnings)
    - Implement `PATCH /partners/bank-details` for bank account and UPI details management
    - _Requirements: 24.1, 24.2, 24.3, 24.7, 24.8_

  - [~] 37.2 Build React Native partner dashboard, job request overlay, earnings chart, and bank details screens
    - Create `PartnerDashboardScreen.tsx` with earnings summary cards, performance badges, level progress bar
    - Create `JobRequestScreen.tsx`: full-screen overlay with service type, pickup/destination, distance, estimated fare, 90-second countdown timer; overlaid above all other screens
    - Create `EarningsChartScreen.tsx`: bar chart using react-native-chart-kit or Victory Native (7/30/90-day toggle)
    - Create `BankDetailsScreen.tsx` with form for bank account name, account number, IFSC, UPI ID
    - Create `PartnerBottomTabs` navigator
    - _Requirements: 24.2, 24.3, 24.5, 24.6, 24.7, 24.8_

  - [ ]* 37.3 Write unit tests for partner dashboard data aggregation
    - Test earnings rollup calculation, acceptance rate computation, level progress percentage
    - _Requirements: 24.2, 24.3_

- [~] 38. Checkpoint — Partner dashboard complete
  - Verify job request overlay appears above all screens, earnings chart data matches PostgreSQL aggregates, bank details save and load correctly.

---

### Phase 14 — Admin Panel (Next.js Web)

- [ ] 39. Set up Next.js 14 admin panel and implement core admin backend endpoints
  - [~] 39.1 Initialize Next.js 14 project with App Router, TypeScript, Tailwind, Firebase Auth (Admin 2FA with TOTP)
    - Create `packages/admin-web` Next.js 14 app with App Router, TypeScript, Tailwind CSS
    - Implement admin login with Firebase Auth + TOTP 2FA (otplib) when twoFactorEnabled=true
    - Create admin layout with sidebar navigation, dark/light theme toggle
    - Implement RBAC-aware navigation (hide Super Admin sections from regular admins)
    - _Requirements: 14.10, 20.3_

  - [~] 39.2 Implement live dashboard page with auto-refresh and user management page
    - Create `/dashboard` page: fetch `GET /admin/dashboard` metrics, auto-refresh every 60 seconds without page reload
    - Metrics: total Users, Partners, active bookings, revenue today/month, KYC queue count, pending withdrawals, open SOS incidents, recent error rates
    - Create `/users` page: search by name/email/phone, results within 2 seconds, user detail page with KYC status, TrustScore, wallet balance, booking history, report count
    - Implement user status update (ACTIVE/SUSPENDED/BANNED), internal notes
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [~] 39.3 Implement KYC review queue, withdrawal approval queue, and booking management pages
    - Create `/kyc` page: queue sorted oldest-first, Approve and Reject (with mandatory reason) actions
    - Create `/withdrawals` page: queue sorted oldest-first, Approve and Reject actions
    - Create `/bookings` page: list with cancel-booking and manual-refund actions
    - _Requirements: 14.7, 14.8, 14.9_

  - [~] 39.4 Implement support ticket management, broadcast campaign creator, report export, audit log viewer, and system health monitor
    - Create `/broadcast` page (CONTENT_MANAGEMENT permission required): target audience selector, immediate/scheduled send
    - Create `/reports` page: all 13 report types, date-range filter, PDF/Excel/CSV export (background job for >90-day ranges)
    - Create `/audit-log` page: filter by actorType, action, entityType, date range; 50 records per page pagination
    - Create `/health` page: API latency, Redis, DB, queue status indicators
    - _Requirements: 14.10, 23.1, 23.2, 23.3, 23.4, 23.5_

  - [ ]* 39.5 Write integration tests for admin dashboard metrics refresh
    - Test auto-refresh triggers `GET /admin/dashboard` every 60 seconds
    - Test RBAC blocks non-CONTENT_MANAGEMENT admin from broadcast page
    - _Requirements: 14.2, 14.10_

- [~] 40. Checkpoint — Admin panel complete
  - Verify 2FA login, live dashboard refreshes, KYC approve/reject updates user records and sends FCM, report export generates file to Firebase Storage.


---

### Phase 15 — Super Admin Panel

- [ ] 41. Implement super admin backend endpoints and panel pages
  - [~] 41.1 Implement super admin: admin account CRUD, feature flag management, and maintenance mode
    - Implement `POST /admin/admins` (Super Admin only): create admin account, assign role, send invitation email, log to AuditLog
    - Implement `DELETE /admin/admins/:id`: revoke all AdminSessions, reassign pending work items to Super Admin queue
    - Implement `GET/PATCH /admin/feature-flags/:key`: toggle per-platform (Android/iOS/Web) with rollout percentage and target role filter
    - Implement maintenance mode toggle: when ACTIVE, block all API endpoints except `GET /health`, return maintenance response
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.7_

  - [~] 41.2 Implement blocklist management, database backup, Razorpay credential management, and global analytics
    - Implement `POST /admin/blocklist`: add IP/phone/email domain with optional expiry; enforce blocklist on auth endpoints
    - Implement `POST /admin/backup`: trigger pg_dump, upload to Firebase Storage, create BackupRecord
    - Implement Razorpay credential management endpoint + connectivity test (creates ₹1 test order, immediately refunds)
    - Create Super Admin panel pages: `/super-admin/admins`, `/super-admin/feature-flags`, `/super-admin/maintenance`, `/super-admin/blocklist`, `/super-admin/backup`, `/super-admin/analytics`, `/super-admin/settings`
    - _Requirements: 15.5, 15.6, 15.8, 15.9, 15.10_

  - [~] 41.3 Implement AI Control Center admin page
    - Create `/admin/ai-control` page: fraud detection alert list, spam detection statistics, fake profile flags, chatbot session metrics
    - _Requirements: 16.10_

  - [ ]* 41.4 Write property test: super admin access completeness
    - **Property 13 (Req 15.11): A User with SUPER_ADMIN role attempting to access any Admin Panel endpoint is granted access**
    - Generate random admin endpoints and verify SUPER_ADMIN is never denied
    - _Requirements: 15.11_

- [~] 42. Checkpoint — Super Admin panel complete
  - Verify maintenance mode blocks API endpoints (except /health), feature flags toggle correctly, blocklist prevents blocked IPs from authenticating.


---

### Phase 16 — Multi-Language, Offline & Accessibility

- [ ] 43. Implement multi-language support and offline mode
  - [~] 43.1 Set up i18n with react-i18next for all 6 languages and implement auto-detection
    - Install and configure react-i18next with translation JSON files for English, Tamil, Hindi, Telugu, Kannada, Malayalam
    - Implement auto-language detection from device system language (default to English if no match)
    - Translate all static UI labels, error messages, onboarding text, notification body text across all screens
    - Implement language change within 1 second without app restart
    - _Requirements: 17.1, 17.2, 17.3, 17.5_

  - [~] 43.2 Implement language preference sync to Firestore and offline mode with write queue
    - Sync user language preference to Firestore `userSettings/{userId}.language` on change
    - Apply Firestore language preference across all devices on login
    - Implement `useNetInfo.ts` hook with NetInfo listener and `OfflineBanner` component
    - Implement Zustand `offlineStore` write queue: enqueue mutations while offline, replay within 30s of reconnect
    - Configure React Query AsyncStorage persister and Firestore offline persistence (50MB cache)
    - Show "Last updated" timestamp on all cached data screens
    - _Requirements: 17.4, 18.1, 18.2, 18.3, 18.4, 18.5_

  - [ ]* 43.3 Write property test: language preference round-trip
    - **Property 14 (Req 17.6): Serializing a language preference to JSON and deserializing returns the same language code**
    - _Requirements: 17.6_

  - [ ]* 43.4 Write unit tests for offline write queue
    - Test enqueue while offline, replay in order on reconnect, partial failure leaves remaining items in queue
    - _Requirements: 18.3, 18.4_

- [ ] 44. Implement accessibility and responsive layout
  - [~] 44.1 Add WCAG 2.1 AA accessibility labels, dynamic font scaling, and tablet responsive layout
    - Audit all interactive elements and add `accessibilityLabel`, `accessibilityRole`, `accessibilityHint` props
    - Verify all color combinations meet 4.5:1 contrast ratio (normal text) and 3:1 (large text) for both themes
    - Implement dynamic font size scaling via `useWindowDimensions` and `PixelRatio.getFontScale()`
    - Implement tablet responsive layout (width > 768px): two-column split view for list/detail screens
    - _Requirements: 21.6, 21.7, 21.8, 21.10_

  - [ ]* 44.2 Write unit tests for dynamic font scaling
    - Test that font sizes scale correctly at 1x, 1.5x, and 2x accessibility font settings
    - _Requirements: 21.7_

- [~] 45. Checkpoint — Multi-language and accessibility complete
  - Verify language switch applies to all screens instantly, offline banner shows when disconnected, write queue replays on reconnect, tablet layout adapts correctly.


---

### Phase 17 — Performance, Testing & Build

- [ ] 46. Implement performance optimizations
  - [~] 46.1 Enable Hermes engine, migrate all lists to FlashList, and configure expo-image with blurhash
    - Enable Hermes engine in Android build config (`android/app/build.gradle`)
    - Replace all `FlatList` instances with `FlashList` (estimatedItemSize configured per screen)
    - Replace all `<Image>` instances with `expo-image` with blurhash placeholder, `contentFit="cover"`, `cachePolicy="memory-disk"`
    - _Requirements: 19.2_

  - [~] 46.2 Implement Redis response cache, cursor-based pagination, and database indexes
    - Apply `withCache()` wrapper to read-heavy endpoints: `GET /pricing/config` (5 min TTL), `GET /content/app-settings` (5 min), `GET /content/feature-flags` (5 min), `GET /admin/dashboard` (60s), `GET /search/autocomplete` (1 min per prefix)
    - Verify all list endpoints use cursor-based pagination (keysets, page size 20)
    - Run `prisma migrate dev` to confirm all FK, status, and timestamp indexes are in place
    - _Requirements: 19.4, 19.5, 19.7_

  - [ ]* 46.3 Write unit tests for Redis cache TTL behavior
    - Test cached response returned on second call, cache invalidated after TTL, fresh data fetched after invalidation
    - _Requirements: 19.4_

- [ ] 47. Implement integration tests and E2E tests
  - [~] 47.1 Write backend integration tests with supertest for all critical API paths
    - Write supertest test suites for: auth (register/login/OTP), KYC (submit/approve/reject), bookings (create/payment/accept/complete), wallet (topup/withdraw), communities (create/join/leave), events (create/register/checkin)
    - Include error case tests: PAYMENT_FAILED, OTP_MAX_ATTEMPTS_EXCEEDED, EVENT_CAPACITY_REACHED, INSUFFICIENT_BALANCE, LAST_OWNER_PROTECTION
    - _Requirements: 19.3, 20.4_

  - [ ]* 47.2 Write React Native E2E smoke tests with Detox for the core booking flow
    - Configure Detox for Android emulator
    - Write smoke test: launch → login → navigate to booking → select service → complete Step 2 → verify price estimate screen renders
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 48. Configure builds and deployment
  - [~] 48.1 Configure Android APK/AAB build and Google Play Store submission
    - Configure `android/app/build.gradle` with app signing (release keystore)
    - Configure Play Store store listing metadata (app name, description, screenshots, icon)
    - Set up EAS Build configuration or bare React Native build pipeline
    - _Requirements: 19.1_

  - [~] 48.2 Configure Vercel deployment for Next.js admin panel
    - Add `vercel.json` configuration for Next.js 14 App Router
    - Set up environment variables in Vercel dashboard for Firebase, Razorpay, API URL
    - Configure custom domain (if applicable)
    - _Requirements: 19.9_

  - [ ]* 48.3 Write integration tests for report export (PDF/Excel/CSV)
    - Test all 13 report types generate valid files, CSV export is idempotent (same row count on re-export)
    - _Requirements: 23.1, 23.6_

- [~] 49. Final checkpoint — Production-ready build
  - Ensure all tests pass. Verify Hermes build succeeds, FlashList renders at 60 FPS on target device, supertest suites green, Detox smoke test passes. Confirm admin panel deploys to Vercel.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements from `requirements.md` for full traceability
- Checkpoints between phases validate integration before the next phase begins
- Property tests validate universal correctness invariants (financial balance, capacity, memberCount, etc.)
- Unit tests validate specific examples and edge cases per component
- All backend code is TypeScript; all mobile code is TypeScript (React Native/Expo); admin panel is TypeScript (Next.js 14)
- Phase 1 (tasks 1–2) must complete before any other phase begins
- Database models (tasks 1.4) must be in place before any service implementation
- Auth module (tasks 3–5) must complete before booking, wallet, communities, events (all require authenticated users)
- KYC module (tasks 6–8) must complete before booking and community creation (KYC gate)
- Wallet module (tasks 12–14) must complete before booking payment flows
- Phases 6–13 can proceed in parallel once Phase 5 (wallet) is complete, as they are independent feature modules
- Admin panel (Phase 14) requires all backend modules to have their admin endpoints implemented
- Super Admin panel (Phase 15) builds directly on Phase 14


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1"]
    },
    {
      "id": 1,
      "tasks": ["1.2", "1.3"]
    },
    {
      "id": 2,
      "tasks": ["1.4"]
    },
    {
      "id": 3,
      "tasks": ["1.5", "1.6", "1.7"]
    },
    {
      "id": 4,
      "tasks": ["3.1", "4.1"]
    },
    {
      "id": 5,
      "tasks": ["3.2", "3.3", "4.2"]
    },
    {
      "id": 6,
      "tasks": ["3.4", "4.3", "6.1"]
    },
    {
      "id": 7,
      "tasks": ["6.2", "7.1"]
    },
    {
      "id": 8,
      "tasks": ["6.3", "7.2", "9.1"]
    },
    {
      "id": 9,
      "tasks": ["9.2", "9.3"]
    },
    {
      "id": 10,
      "tasks": ["9.4", "9.5"]
    },
    {
      "id": 11,
      "tasks": ["9.6", "9.7", "12.1"]
    },
    {
      "id": 12,
      "tasks": ["9.8", "12.2", "10.1"]
    },
    {
      "id": 13,
      "tasks": ["9.9", "10.2", "12.3", "12.4", "13.1", "15.1", "18.1", "21.1", "24.1", "27.1"]
    },
    {
      "id": 14,
      "tasks": ["13.2", "15.2", "15.3", "16.1", "18.2", "18.3", "21.2", "21.3", "24.2", "28.1", "30.1", "33.1"]
    },
    {
      "id": 15,
      "tasks": ["16.2", "16.3", "19.1", "19.2", "22.1", "22.2", "25.1", "25.2", "28.2", "30.2", "33.2", "34.1"]
    },
    {
      "id": 16,
      "tasks": ["30.3", "31.1", "33.3", "34.2", "35.1", "37.1", "39.1"]
    },
    {
      "id": 17,
      "tasks": ["31.2", "34.3", "35.2", "37.2", "37.3", "39.2"]
    },
    {
      "id": 18,
      "tasks": ["39.3", "41.1"]
    },
    {
      "id": 19,
      "tasks": ["39.4", "39.5", "41.2", "41.3", "43.1"]
    },
    {
      "id": 20,
      "tasks": ["41.4", "43.2", "44.1"]
    },
    {
      "id": 21,
      "tasks": ["43.3", "43.4", "44.2", "46.1"]
    },
    {
      "id": 22,
      "tasks": ["46.2", "47.1"]
    },
    {
      "id": 23,
      "tasks": ["46.3", "47.2", "48.1", "48.2"]
    },
    {
      "id": 24,
      "tasks": ["48.3"]
    }
  ]
}
```
