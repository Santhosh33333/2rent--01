# RentBuddy 2026 — Technical Design Document

**Version:** 1.0.0  
**Status:** Draft  
**Last Updated:** 2026  
**Scope:** Complete enterprise rebuild of the RentBuddy platform

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Tech Stack Summary](#2-tech-stack-summary)
3. [Backend Module Structure](#3-backend-module-structure)
4. [Database Design](#4-database-design)
5. [API Design](#5-api-design)
6. [8-Step Booking Flow](#6-8-step-booking-flow)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Real-Time Architecture](#8-real-time-architecture)
9. [Security Design](#9-security-design)
10. [Background Jobs](#10-background-jobs)
11. [Offline Strategy](#11-offline-strategy)
12. [Performance Strategy](#12-performance-strategy)

---

## 1. System Architecture

### 1.1 High-Level Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                       │
│                                                                              │
│   ┌─────────────────────┐          ┌──────────────────────────────────┐    │
│   │  React Native App   │          │     Next.js Admin Panel (Web)    │    │
│   │  (Android + iOS)    │          │     Vercel / Netlify Hosting     │    │
│   └────────┬────────────┘          └────────────────┬─────────────────┘    │
└────────────┼──────────────────────────────────────────┼────────────────────┘
             │  HTTPS/REST + Firebase SDK                │  HTTPS/REST
             ▼                                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY LAYER                                  │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │   Express.js API Server (Node.js)                                    │ │
│   │   • Rate Limiter (100/min auth, 20/min unauth)                       │ │
│   │   • Firebase ID Token Verification Middleware                        │ │
│   │   • RBAC Middleware (role → permission check)                        │ │
│   │   • Request Validation (schema-based)                                │ │
│   │   • Helmet + CORS + Morgan                                           │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                        FEATURE MODULE LAYER                                 │
│                                                                              │
│  auth │ users │ kyc │ bookings │ partners │ wallet │ chat │ communities    │
│  events │ notifications │ safety │ rewards │ search │ ai │ admin           │
│                                                                              │
│  Each module: Controller → Service → Repository → Domain Entity            │
└────────────────────────────────────────────────────────────────────────────┘
             │
             ├──────────────────────┬──────────────────────┐
             ▼                      ▼                      ▼
┌────────────────────┐  ┌────────────────────┐  ┌─────────────────────────┐
│  PostgreSQL (Prisma)│  │  Firebase Firestore │  │  Firebase Storage       │
│  Transactional data│  │  Real-time data     │  │  Media / KYC docs       │
│  Users, Wallets,   │  │  Chat, Locations,  │  │  Profile photos,         │
│  Bookings, KYC,    │  │  Active Bookings,  │  │  Community covers,       │
│  Transactions,     │  │  Notifications,    │  │  Event banners,          │
│  Earnings          │  │  Typing indicators │  │  Chat media              │
└────────────────────┘  └────────────────────┘  └─────────────────────────┘
             │
             ├──────────────────────┬──────────────────────┐
             ▼                      ▼                      ▼
┌────────────────────┐  ┌────────────────────┐  ┌─────────────────────────┐
│  Firebase Auth     │  │  Firebase FCM       │  │  Third-Party Services   │
│  OTP, Sessions,    │  │  Push notifications │  │  Razorpay (payments)    │
│  Token verify      │  │  Broadcast jobs     │  │  LocationIQ (maps/geo)  │
└────────────────────┘  └────────────────────┘  └─────────────────────────┘
```

### 1.2 Service Boundaries

| Module | Owns | Consumes |
|--------|------|----------|
| auth | Firebase identity, session tokens, refresh tokens | users (profile lookup) |
| users | User profiles, trust scores, friends, blocks | auth, kyc, notifications |
| kyc | Verification records, document storage | users, notifications, storage |
| bookings | Booking lifecycle, OTP management | partners, wallet, notifications, location, payments |
| partners | Partner profiles, availability, earnings | users, kyc, notifications, wallet |
| wallet | Balances, transactions, withdrawal requests | payments, notifications |
| chat | Conversations, messages, chat requests | users, notifications, storage, firestore |
| communities | Groups, memberships, posts | users, notifications, storage |
| events | Events, attendees, QR tickets | users, notifications, storage |
| notifications | FCM dispatch, in-app notifications | all modules (event-driven) |
| safety | SOS incidents, trusted contacts, safety timer | users, notifications, location |
| rewards | Points, badges, levels, leaderboard | users, wallet, notifications |
| search | Cross-entity search index | users, partners, communities, events, location |
| ai | Fraud detection, recommendations, spam detection | users, chat, bookings, admin |
| admin | Platform management, RBAC, audit | all modules |

### 1.3 Critical Booking Data Flow

```
User initiates booking
        │
        ▼
POST /bookings → BookingController
        │
        ▼
BookingService.createBooking()
  1. Validate KYC status (APPROVED)
  2. Call LocationService.geocode(pickup, destination)
  3. Calculate price via PricingService
  4. Create Booking{status: PAYMENT_PENDING} in PostgreSQL
  5. Return Razorpay order via PaymentGateway
        │
        ▼
User completes Razorpay payment
        │
        ▼
POST /payments/webhook (Razorpay)
  1. Verify Razorpay signature
  2. Update Booking{status: PAYMENT_SUCCESSFUL}
  3. Debit user wallet
  4. Write activeBookings/{bookingId} to Firestore
  5. Enqueue partner-search job
        │
        ▼
PartnerSearchJob (Bull queue)
  1. Query available partners within 10km radius
  2. Send FCM notifications to nearby partners
  3. Write partnerLocations query to Firestore
  4. Set 10-minute timeout job
        │
        ▼
Partner accepts → PATCH /bookings/:id/accept
  1. Update Booking{status: PARTNER_ACCEPTED, partnerId}
  2. Generate OTP, store on booking
  3. Update activeBookings/{bookingId} in Firestore
  4. Send FCM to user
        │
        ▼
OTP start → PATCH /bookings/:id/start-otp
  1. Verify OTP
  2. Update Booking{status: IN_PROGRESS, startedAt}
  3. Update Firestore activeBookings
  4. Begin partner location streaming (5s intervals)
        │
        ▼
OTP end → PATCH /bookings/:id/complete-otp
  1. Verify OTP
  2. Update Booking{status: COMPLETED, completedAt}
  3. Calculate finalAmount, partnerEarning
  4. Credit partner wallet
  5. Generate invoice
  6. Write AuditLog
  7. Prompt rating screen
```

---

## 2. Tech Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Mobile App | React Native (Expo / bare) | Android + iOS cross-platform app |
| Admin Web | Next.js 14 (App Router) | Admin and Super Admin web panel |
| Backend Runtime | Node.js 20 LTS | API server runtime |
| API Framework | Express.js | HTTP routing, middleware chain |
| Architecture | Clean Architecture + Repository Pattern | Feature-based modules, dependency injection |
| Auth Provider | Firebase Authentication | OTP verification, session tokens, ID tokens |
| Transactional DB | PostgreSQL 15 | Users, wallets, bookings, KYC, earnings |
| ORM | Prisma 5 | Type-safe PostgreSQL access, migrations |
| Real-time DB | Firebase Firestore | Chat, live locations, active bookings, typing |
| File Storage | Firebase Storage | Profile photos, KYC docs, community covers |
| Push Notifications | Firebase Cloud Messaging (FCM) | Push delivery to mobile and web |
| Payments | Razorpay | Card, UPI, net-banking top-ups + payouts |
| Maps / Geocoding | LocationIQ API | Geocoding, reverse geocoding, routing |
| Background Jobs | Bull (Redis-backed) | Queues, scheduled tasks, cron jobs |
| Cache | Redis | API response cache, rate limiting, job queue |
| Server State (RN) | TanStack React Query | Caching, pagination, mutations |
| Global UI State | Zustand | Auth session, theme, active booking state |
| Navigation | React Navigation 6 | Stack + Bottom Tab navigators |
| Lists | FlashList (Shopify) | High-performance virtualized lists |
| Animations | React Native Reanimated 3 | 60 FPS UI animations |
| Image Rendering | expo-image | Progressive loading + CDN caching |
| Hosting (API) | Railway / Render (scalable to GCP/AWS) | Node.js server hosting |
| Hosting (Admin) | Vercel / Netlify | Next.js admin panel hosting |
| Monitoring | Firebase Crashlytics + custom ApiLog table | Error tracking and observability |
| CI/CD | GitHub Actions | Build, test, deploy pipeline |

---

## 3. Backend Module Structure

Each module follows Clean Architecture layers: **Controller → Service → Repository → Domain Entity**. Modules are isolated directories under `src/modules/` with no circular imports.

### 3.1 Directory Layout

```
src/
  modules/
    auth/
      auth.controller.ts       ← HTTP handlers, request parsing
      auth.service.ts          ← Business logic, Firebase Auth calls
      auth.repository.ts       ← PostgreSQL access via Prisma
      auth.routes.ts           ← Express router
      auth.dto.ts              ← Zod schemas for validation
      auth.types.ts            ← Domain types/interfaces
    users/
      users.controller.ts
      users.service.ts
      users.repository.ts
      users.routes.ts
      users.dto.ts
      users.types.ts
    kyc/          ← (same structure per module)
    bookings/
    partners/
    wallet/
    chat/
    communities/
    events/
    notifications/
    safety/
    rewards/
    search/
    ai/
    admin/
  config/
    firebase.ts              ← Firebase Admin SDK init
    database.ts              ← Prisma client singleton
    env.ts                   ← Validated env vars (zod)
    redis.ts                 ← Redis / Bull queue init
  middleware/
    auth.ts                  ← Firebase ID token verification
    rbac.ts                  ← Role + permission enforcement
    rateLimiter.ts           ← express-rate-limit + Redis
    validate.ts              ← Zod schema request validator
    auditLogger.ts           ← Writes AuditLog on mutations
  jobs/
    notificationBroadcast.ts
    payoutProcessing.ts
    reportGeneration.ts
    partnerSearchTimeout.ts
    leaderboardRefresh.ts
    dailyLoginRewards.ts
    fcmTokenCleanup.ts
  utils/
    response.ts              ← Unified {success, data, message, code}
    otp.ts                   ← OTP generation + verification helpers
    pricing.ts               ← Fare calculation logic
    trustScore.ts            ← TrustScore computation
    invoice.ts               ← PDF invoice generation
  app.ts
  server.ts
```

### 3.2 Module Responsibilities

#### `auth`
- Register user via Firebase Auth (createUser)
- Send/verify phone OTP via Firebase Auth phone flows
- Issue Firebase custom tokens; verify incoming ID tokens
- Refresh session; logout; forgot/reset password
- Detect suspicious login (new device, new IP country) → security alert

#### `users`
- CRUD for User profile (displayName, photo, city, bio)
- Manage emergency contacts
- Friends: send/accept/decline/remove friend requests
- Block/unblock users
- Device management (list sessions, revoke session)
- Account deactivation

#### `kyc`
- Wizard step tracking (progress %)
- Document upload to Firebase Storage
- Status machine: NOT_STARTED → DRAFT → SUBMITTED → PENDING_REVIEW → UNDER_VERIFICATION → APPROVED | REJECTED | RESUBMIT_REQUIRED
- Admin review (approve/reject with reason)
- VerificationHistory audit trail

#### `bookings`
- 8-step booking state machine (full lifecycle)
- OTP generation and dual-OTP verification (start + end)
- Price estimation, coupon application
- Razorpay order creation and webhook handling
- Partner search with geo-radius query + timeout
- Invoice generation on completion
- Cancellation policy enforcement + refund initiation
- Live status sync to Firestore `activeBookings`

#### `partners`
- Partner profile management and approval workflow
- Availability toggle with Firestore `partnerLocations` sync
- Job request acceptance/rejection (90-second timer enforcement)
- Real-time location streaming during active bookings
- Earnings calculation and PartnerEarnings record updates

#### `wallet`
- One wallet per user, non-negative balance constraint
- Top-up via Razorpay (order create → webhook → credit)
- Booking debit/refund flows
- Withdrawal request lifecycle (PENDING → APPROVED → PROCESSED | REJECTED)
- Full transaction ledger with before/after balances
- Razorpay Payout API integration for partner withdrawals

#### `chat`
- ChatRequest gate before messaging is unlocked
- Firestore-backed message delivery (text, image, voice, file, location)
- Typing indicator writes with 5-second TTL
- Message status (SENT → DELIVERED → READ)
- Reply, delete, pin message operations
- WebRTC call signaling via Firestore channel
- Spam detection via AI module hook

#### `communities`
- Community CRUD with PUBLIC / PRIVATE privacy
- Member join/leave/approve/ban/mute lifecycle
- Posts: text, image, poll, announcement; pinned posts
- Voice/video room creation (via WebRTC signaling)
- memberCount atomic increment/decrement

#### `events`
- Event CRUD (title, poster, location, time, capacity)
- Attendee registration with QR ticket generation
- QR ticket validation + check-in recording
- Organizer analytics aggregation
- Event cancellation with attendee push notifications

#### `notifications`
- FCM token registration and stale token cleanup
- Categorized in-app notification records
- Per-category mute preference enforcement
- Broadcast campaign fan-out (Bull queue, batches of 500)
- Admin broadcast scheduling and targeting

#### `safety`
- Trusted contact CRUD (up to 5)
- Emergency SOS trigger: capture GPS, create SosIncident, SMS trusted contacts, alert admins
- Safety timer: set/check-in/auto-SOS on expiry
- Live location sharing with configurable TTL
- Incident report with photo evidence

#### `rewards`
- Daily login reward (once per calendar day, IST)
- Weekly streak bonus (7 consecutive days)
- Referral bonus on first booking completion
- Milestone badge award on booking count thresholds
- Partner level recalculation after each points event (BRONZE/SILVER/GOLD/PLATINUM)
- Leaderboard aggregation (top 100 users + partners by points)

#### `search`
- Multi-entity full-text search: partners, users, communities, events
- Geo-proximity sort for partner results (LocationIQ distance)
- Block-aware filtering (exclude blocked/blocking entities)
- Autocomplete suggestions (≥2 chars, <500ms)
- Result pagination and type-based filtering

#### `ai`
- Partner recommendation scoring (proximity + rating + booking history)
- Friend suggestion scoring (mutual connections + shared communities)
- Fraud risk score computation on registration
- Spam pattern detection on chat messages
- Selfie duplicate detection for KYC
- Customer support chatbot (knowledge base Q&A)

#### `admin`
- Dashboard metrics aggregation
- User management: search, status update (ACTIVE/SUSPENDED/BANNED), internal notes
- KYC review queue
- Withdrawal approval queue
- Booking management (cancel, manual refund)
- Broadcast campaign management
- Banner and feature flag management
- AuditLog viewer with filters
- Export report jobs via Bull queue
- Super Admin: admin account CRUD, RBAC role management, maintenance mode toggle, database backup, blocklist management

---

## 4. Database Design

### 4.1 PostgreSQL (Prisma) — Core Schema

> **Provider:** PostgreSQL 15. All `String` enum fields use `@db.VarChar` in production migrations. All monetary values use `Decimal @db.Decimal(10,2)`. UUIDs via `@default(uuid())`.

#### User

```prisma
model User {
  id            String    @id @default(uuid())
  firebaseUid   String    @unique           // Firebase Auth UID
  email         String    @unique
  phone         String    @unique
  fullName      String
  displayName   String?
  dateOfBirth   DateTime
  gender        String    @default("OTHER") // MALE | FEMALE | OTHER | PREFER_NOT_TO_SAY
  avatarUrl     String?                     // Firebase Storage URL
  bio           String?
  city          String?
  country       String?   @default("IN")
  role          String    @default("USER")  // USER | PARTNER | ADMIN | SUPER_ADMIN
  activeRole    String?                     // which role is currently active
  kycStatus     String    @default("NOT_STARTED")
  trustScore    Int       @default(0)       // 0-100, computed
  status        String    @default("ACTIVE") // ACTIVE | SUSPENDED | BANNED | DEACTIVATED
  emailVerified Boolean   @default(false)
  phoneVerified Boolean   @default(false)
  lastLoginAt   DateTime?
  language      String    @default("en")   // en | ta | hi | te | kn | ml
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Relations
  partner           Partner?
  kyc               KYC?
  wallet            Wallet?
  devices           Device[]
  sessions          Session[]
  notifications     Notification[]
  emergencyContacts EmergencyContact[]
  loginHistory      LoginHistory[]
  bookings          Booking[]          @relation("BookingUser")
  rewards           Reward[]
  sosIncidents      SosIncident[]
  auditLogs         AuditLog[]
  friendsSent       Friendship[]       @relation("FriendRequester")
  friendsReceived   Friendship[]       @relation("FriendRecipient")
  blocksGiven       UserBlock[]        @relation("BlockInitiator")
  blocksReceived    UserBlock[]        @relation("BlockTarget")
  communities       CommunityMember[]
  ownedCommunities  Community[]        @relation("CommunityOwner")
  organizedEvents   Event[]            @relation("EventOrganizer")
  eventAttendances  EventAttendee[]
  transactions      Transaction[]
  withdrawals       WithdrawalRequest[]
  adminProfile      AdminUser?
  partnerLevel      PartnerLevel?
  partnerEarnings   PartnerEarnings?
  referralsMade     Referral[]         @relation("ReferralSender")
  referredBy        Referral?          @relation("ReferredBy")

  @@index([status])
  @@index([role])
  @@index([city])
  @@index([firebaseUid])
  @@index([kycStatus])
}
```

#### Partner

```prisma
model Partner {
  id                String    @id @default(uuid())
  userId            String    @unique
  serviceTypes      String    // JSON array: ["WALKING_BUDDY","CARRY_BUDDY"]
  isAvailable       Boolean   @default(false)
  isApproved        Boolean   @default(false)
  averageRating     Decimal   @default(0)   @db.Decimal(3,2)
  totalEarnings     Decimal   @default(0)   @db.Decimal(10,2)
  level             String    @default("BRONZE") // BRONZE | SILVER | GOLD | PLATINUM
  points            Int       @default(0)
  completedJobs     Int       @default(0)
  cancelledJobs     Int       @default(0)
  acceptanceRate    Decimal   @default(0)   @db.Decimal(5,2)
  bankAccountName   String?
  bankAccountNumber String?
  bankIfsc          String?
  upiId             String?
  reviewedBy        String?
  reviewedAt        DateTime?
  rejectionReason   String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookings Booking[] @relation("BookingPartner")

  @@index([isAvailable])
  @@index([isApproved])
  @@index([level])
}
```

#### KYC

```prisma
model KYC {
  id              String    @id @default(uuid())
  userId          String    @unique
  status          String    @default("NOT_STARTED")
  documentType    String?   // AADHAAR | PAN | PASSPORT | VOTER_ID | DRIVING_LICENCE
  documentUrl     String?   // Firebase Storage URL
  selfieUrl       String?   // Firebase Storage URL
  addressProofUrl String?
  rejectionReason String?
  submittedAt     DateTime?
  reviewedAt      DateTime?
  reviewedBy      String?   // Admin userId
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  user    User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  history KYCHistory[]

  @@index([status])
}

model KYCHistory {
  id        String   @id @default(uuid())
  kycId     String
  status    String
  note      String?
  changedBy String?
  createdAt DateTime @default(now())

  kyc KYC @relation(fields: [kycId], references: [id], onDelete: Cascade)

  @@index([kycId])
}
```

#### Booking

```prisma
model Booking {
  id                  String    @id @default(uuid())
  userId              String
  partnerId           String?
  serviceType         String    // WALKING_BUDDY | CARRY_BUDDY
  status              String    @default("PAYMENT_PENDING")
  // PAYMENT_PENDING | PAYMENT_INITIATED | PAYMENT_SUCCESSFUL | PARTNER_SEARCHING
  // | PARTNER_ASSIGNED | PARTNER_ACCEPTED | OTP_GENERATED | IN_PROGRESS
  // | COMPLETED | CANCELLED | REFUND_INITIATED | REFUND_COMPLETED

  // Location
  pickupLat           Decimal?  @db.Decimal(10,7)
  pickupLng           Decimal?  @db.Decimal(10,7)
  pickupAddress       String
  destLat             Decimal?  @db.Decimal(10,7)
  destLng             Decimal?  @db.Decimal(10,7)
  destAddress         String

  // Schedule
  scheduledAt         DateTime
  durationMinutes     Int?
  startedAt           DateTime?
  completedAt         DateTime?

  // CarryBuddy extras
  itemType            String?
  itemDescription     String?

  // Pricing
  baseFare            Decimal?  @db.Decimal(10,2)
  platformFee         Decimal?  @db.Decimal(10,2)
  discountAmount      Decimal   @default(0) @db.Decimal(10,2)
  finalAmount         Decimal?  @db.Decimal(10,2)
  partnerEarning      Decimal?  @db.Decimal(10,2)
  couponCode          String?

  // Payment
  razorpayOrderId     String?
  razorpayPaymentId   String?
  razorpaySignature   String?
  paymentStatus       String    @default("PENDING")
  paymentVerifiedAt   DateTime?

  // OTP
  otpStart            String?   // partner enters this to begin
  otpEnd              String?   // user enters this to confirm completion
  otpGeneratedAt      DateTime?
  otpStartVerifiedAt  DateTime?
  otpEndVerifiedAt    DateTime?

  // Cancellation
  cancelledBy         String?
  cancelReason        String?
  cancelledAt         DateTime?

  // Refund
  refundStatus        String?
  refundAmount        Decimal?  @db.Decimal(10,2)
  refundId            String?
  refundInitiatedAt   DateTime?
  refundCompletedAt   DateTime?

  invoiceUrl          String?   // Firebase Storage URL
  notes               String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  user    User     @relation("BookingUser",    fields: [userId],    references: [id], onDelete: Cascade)
  partner Partner? @relation("BookingPartner", fields: [partnerId], references: [id])

  @@index([status])
  @@index([userId])
  @@index([partnerId])
  @@index([serviceType])
  @@index([scheduledAt])
  @@index([createdAt])
}
```

#### Wallet

```prisma
model Wallet {
  id                   String    @id @default(uuid())
  userId               String    @unique
  balance              Decimal   @default(0) @db.Decimal(10,2)
  withdrawableBalance  Decimal   @default(0) @db.Decimal(10,2)
  pendingBalance       Decimal   @default(0) @db.Decimal(10,2)
  currency             String    @default("INR")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  user         User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions Transaction[]
  withdrawals  WithdrawalRequest[]
  paymentOrders PaymentOrder[]
}
```

#### Transaction

```prisma
model Transaction {
  id            String   @id @default(uuid())
  walletId      String
  userId        String
  type          String
  // TOPUP | BOOKING_DEBIT | BOOKING_REFUND | EARNING | WITHDRAWAL
  // | REWARD | CASHBACK | COUPON | PENALTY
  amount        Decimal  @db.Decimal(10,2)
  balanceBefore Decimal  @db.Decimal(10,2)
  balanceAfter  Decimal  @db.Decimal(10,2)
  referenceId   String?  // bookingId, paymentOrderId, withdrawalId, etc.
  description   String?
  status        String   @default("COMPLETED")
  createdAt     DateTime @default(now())

  wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId],   references: [id], onDelete: Cascade)

  @@index([walletId])
  @@index([userId])
  @@index([type])
  @@index([createdAt])
}
```

#### WithdrawalRequest

```prisma
model WithdrawalRequest {
  id              String    @id @default(uuid())
  partnerId       String    // userId of partner
  walletId        String
  amount          Decimal   @db.Decimal(10,2)
  bankAccount     String?   // JSON: {name, number, ifsc}
  upi             String?
  status          String    @default("PENDING")
  // PENDING | APPROVED | PROCESSING | COMPLETED | REJECTED | FAILED
  razorpayPayoutId String?
  adminNote       String?
  reviewedBy      String?
  requestedAt     DateTime  @default(now())
  processedAt     DateTime?

  wallet Wallet @relation(fields: [walletId], references: [id], onDelete: Cascade)

  @@index([status])
  @@index([partnerId])
  @@index([requestedAt])
}
```

#### Events & Communities (abbreviated)

```prisma
model Event {
  id            String    @id @default(uuid())
  creatorId     String
  title         String
  description   String?
  posterUrl     String?
  location      String?
  startTime     DateTime
  endTime       DateTime?
  capacity      Int?
  attendeeCount Int       @default(0)
  status        String    @default("PUBLISHED") // PUBLISHED | CANCELLED | COMPLETED
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  organizer User           @relation("EventOrganizer", fields: [creatorId], references: [id])
  attendees EventAttendee[]

  @@index([status])
  @@index([startTime])
}

model EventAttendee {
  id          String    @id @default(uuid())
  eventId     String
  userId      String
  qrCode      String    @unique // base64 encoded JSON {eventId, userId, attendeeId}
  checkedIn   Boolean   @default(false)
  checkedInAt DateTime?
  createdAt   DateTime  @default(now())

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User  @relation(fields: [userId],  references: [id], onDelete: Cascade)

  @@unique([eventId, userId])
  @@index([eventId])
}

model Community {
  id          String   @id @default(uuid())
  creatorId   String
  name        String
  description String?
  coverUrl    String?
  city        String?
  privacy     String   @default("PUBLIC") // PUBLIC | PRIVATE
  memberCount Int      @default(0)
  status      String   @default("ACTIVE")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner   User              @relation("CommunityOwner", fields: [creatorId], references: [id])
  members CommunityMember[]

  @@index([privacy])
  @@index([city])
}

model CommunityMember {
  id          String   @id @default(uuid())
  communityId String
  userId      String
  role        String   @default("MEMBER") // OWNER | ADMIN | MEMBER | BANNED
  mutedUntil  DateTime?
  joinedAt    DateTime @default(now())

  community Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId],      references: [id], onDelete: Cascade)

  @@unique([communityId, userId])
  @@index([communityId])
  @@index([role])
}
```

#### Safety, Rewards, Audit

```prisma
model Friendship {
  id          String   @id @default(uuid())
  requesterId String
  recipientId String
  status      String   @default("PENDING") // PENDING | ACCEPTED | DECLINED | REMOVED
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  requester User @relation("FriendRequester", fields: [requesterId], references: [id])
  recipient User @relation("FriendRecipient", fields: [recipientId], references: [id])

  @@unique([requesterId, recipientId])
  @@index([requesterId])
  @@index([recipientId])
}

model UserBlock {
  id        String   @id @default(uuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())

  blocker User @relation("BlockInitiator", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked User @relation("BlockTarget",    fields: [blockedId], references: [id], onDelete: Cascade)

  @@unique([blockerId, blockedId])
  @@index([blockerId])
}

model Reward {
  id          String    @id @default(uuid())
  userId      String
  type        String    // DAILY_LOGIN | WEEKLY_STREAK | REFERRAL | MILESTONE | BOOKING_COMPLETE
  points      Int       @default(0)
  badge       String?   // badge slug (e.g., "first_booking", "10_bookings")
  description String?
  status      String    @default("CREDITED") // CREDITED | FAILED | PENDING
  earnedAt    DateTime  @default(now())
  expiresAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([type])
  @@index([earnedAt])
}

model SosIncident {
  id          String    @id @default(uuid())
  userId      String
  lat         Decimal?  @db.Decimal(10,7)
  lng         Decimal?  @db.Decimal(10,7)
  address     String?
  severity    String    @default("HIGH")
  status      String    @default("ACTIVE") // ACTIVE | ACKNOWLEDGED | RESOLVED
  notes       String?
  respondedBy String?
  respondedAt DateTime?
  resolvedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@index([status])
  @@index([createdAt])
}

model AuditLog {
  id         String   @id @default(uuid())
  actorId    String?
  actorType  String   // USER | PARTNER | ADMIN | SUPER_ADMIN | SYSTEM
  action     String   // e.g., APPROVE_KYC, BAN_USER, APPROVE_WITHDRAWAL
  entityType String?  // User | Booking | KYC | Withdrawal | etc.
  entityId   String?
  ipAddress  String?
  metadata   String?  // JSON blob of extra context
  createdAt  DateTime @default(now())

  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([actorId])
  @@index([action])
  @@index([entityType, entityId])
  @@index([createdAt])
}

model Notification {
  id        String   @id @default(uuid())
  userId    String
  category  String   // Booking | Payment | Refund | Wallet | Partner | Community
              //       | Event | System | Security | Offers
  title     String
  body      String
  data      String?  // JSON payload for deep-link routing
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([isRead])
  @@index([category])
  @@index([createdAt])
}

model PartnerLevel {
  id                  String   @id @default(uuid())
  userId              String   @unique
  level               String   @default("BRONZE")
  points              Int      @default(0)
  incentiveMultiplier Decimal  @default(1.0) @db.Decimal(4,2)
  platformFeeDiscount Decimal  @default(0)   @db.Decimal(4,2)
  priorityRequests    Boolean  @default(false)
  fastWithdrawal      Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([level])
}

model PartnerEarnings {
  id                  String    @id @default(uuid())
  userId              String    @unique
  todayEarnings       Decimal   @default(0) @db.Decimal(10,2)
  weeklyEarnings      Decimal   @default(0) @db.Decimal(10,2)
  monthlyEarnings     Decimal   @default(0) @db.Decimal(10,2)
  lifetimeEarnings    Decimal   @default(0) @db.Decimal(10,2)
  pendingEarnings     Decimal   @default(0) @db.Decimal(10,2)
  withdrawableBalance Decimal   @default(0) @db.Decimal(10,2)
  completedJobs       Int       @default(0)
  cancelledJobs       Int       @default(0)
  averageRating       Decimal   @default(0) @db.Decimal(3,2)
  lastEarningAt       DateTime?
  updatedAt           DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 4.2 Firestore Collections (Real-Time)

```
conversations/{conversationId}
  - participants: string[]          // [userId1, userId2]
  - lastMessageId: string | null
  - lastMessageText: string | null
  - lastMessageAt: Timestamp | null
  - updatedAt: Timestamp

messages/{conversationId}/messages/{messageId}
  - senderId: string
  - type: 'text' | 'image' | 'voice' | 'file' | 'location' | 'deleted'
  - content: string                 // text body or Firebase Storage URL
  - replyToId: string | null
  - status: 'sent' | 'delivered' | 'read'
  - readAt: Timestamp | null
  - createdAt: Timestamp

partnerLocations/{partnerId}
  - lat: number
  - lng: number
  - heading: number | null
  - speed: number | null
  - isAvailable: boolean
  - updatedAt: Timestamp

activeBookings/{bookingId}
  - status: BookingStatus
  - partnerId: string | null
  - userId: string
  - serviceType: string
  - pickupLat: number
  - pickupLng: number
  - destLat: number
  - destLng: number
  - updatedAt: Timestamp

typingIndicators/{conversationId}/users/{userId}
  - isTyping: boolean
  - updatedAt: Timestamp            // TTL enforced client-side (5s)

fcmTokens/{userId}
  - tokens: string[]                // active device FCM tokens
  - updatedAt: Timestamp

sosAlerts/{incidentId}
  - userId: string
  - lat: number
  - lng: number
  - status: 'ACTIVE' | 'RESOLVED'
  - createdAt: Timestamp            // for admin real-time dashboard

callSignaling/{callId}
  - callerId: string
  - receiverId: string
  - type: 'voice' | 'video'
  - status: 'ringing' | 'accepted' | 'rejected' | 'ended'
  - offer: RTCSessionDescription | null
  - answer: RTCSessionDescription | null
  - iceCandidates: RTCIceCandidate[]
  - createdAt: Timestamp
```

---

## 5. API Design

All responses follow the unified envelope:

```json
{
  "success": true,
  "data": {},
  "message": "Human-readable description",
  "code": "OPTIONAL_ERROR_CODE"
}
```

Auth legend: `🔓` = public, `🔑` = authenticated user, `🤝` = partner, `🛡️` = admin, `👑` = super admin.

### 5.1 Auth Module `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | 🔓 | Register new user, send phone OTP |
| POST | `/auth/verify-otp` | 🔓 | Verify OTP, mark phone verified |
| POST | `/auth/login` | 🔓 | Login with email + password, return Firebase custom token |
| POST | `/auth/refresh` | 🔓 | Exchange refresh token for new ID token |
| POST | `/auth/forgot-password` | 🔓 | Send password reset OTP to phone |
| POST | `/auth/reset-password` | 🔓 | Reset password using OTP |
| POST | `/auth/logout` | 🔑 | Revoke current session |
| GET  | `/auth/me` | 🔑 | Return authenticated user profile |

### 5.2 KYC Module `/api/kyc`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/kyc/submit` | 🔑 | Submit KYC documents (multipart, to Firebase Storage) |
| GET  | `/kyc/status` | 🔑 | Get current KYC status and history |
| PATCH | `/kyc/:id/approve` | 🛡️ | Admin: approve KYC submission |
| PATCH | `/kyc/:id/reject` | 🛡️ | Admin: reject KYC with reason |
| GET  | `/kyc/queue` | 🛡️ | Admin: list pending KYC submissions (oldest first) |
| PATCH | `/kyc/resubmit` | 🔑 | Resubmit after rejection |

### 5.3 Bookings Module `/api/bookings`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/bookings` | 🔑 | Create booking (Step 1-3), returns Razorpay order |
| GET  | `/bookings/:id` | 🔑 | Get booking detail |
| GET  | `/bookings/history` | 🔑 | Paginated booking history |
| GET  | `/bookings/active` | 🔑 | Get current active booking |
| PATCH | `/bookings/:id/status` | 🔑🤝 | Generic status transition |
| POST | `/bookings/:id/accept` | 🤝 | Partner accepts booking |
| POST | `/bookings/:id/reject` | 🤝 | Partner rejects booking |
| POST | `/bookings/:id/start-otp` | 🤝 | Partner enters start OTP |
| POST | `/bookings/:id/end-otp` | 🔑 | User enters end OTP to confirm completion |
| POST | `/bookings/:id/cancel` | 🔑🤝 | Cancel booking with reason |
| POST | `/bookings/:id/rate` | 🔑 | Submit post-booking rating (1-5) |
| GET  | `/bookings/:id/invoice` | 🔑 | Download booking invoice (PDF) |
| POST | `/bookings/estimate` | 🔑 | Price estimate before creating booking |

### 5.4 Partners Module `/api/partners`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/partners/nearby` | 🔑 | Get available partners within radius |
| GET  | `/partners/dashboard` | 🤝 | Partner earnings dashboard |
| PATCH | `/partners/availability` | 🤝 | Toggle online/offline availability |
| GET  | `/partners/jobs` | 🤝 | Incoming and past job list |
| GET  | `/partners/job/:id` | 🤝 | Job request detail |
| POST | `/partners/apply` | 🔑 | Apply to become a partner |
| PATCH | `/partners/bank-details` | 🤝 | Update bank/UPI details |
| GET  | `/partners/:id/profile` | 🔑 | Public partner profile |

### 5.5 Wallet Module `/api/wallet`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/wallet` | 🔑 | Get wallet balances |
| POST | `/wallet/topup` | 🔑 | Create Razorpay top-up order |
| POST | `/wallet/topup/verify` | 🔑 | Verify payment signature after top-up |
| GET  | `/wallet/transactions` | 🔑 | Paginated transaction history |
| POST | `/wallet/withdraw` | 🤝 | Request withdrawal |
| GET  | `/wallet/withdrawals` | 🤝 | Withdrawal request history |

### 5.6 Payments Webhook `/api/payments`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/webhook` | 🔓 (HMAC) | Razorpay webhook for payment capture |

### 5.7 Chat Module `/api/chat`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/chat/conversations` | 🔑 | List conversations |
| GET  | `/chat/conversations/:id/messages` | 🔑 | Paginated message history |
| POST | `/chat/messages` | 🔑 | Send message (write to Firestore) |
| DELETE | `/chat/messages/:id` | 🔑 | Delete own message |
| POST | `/chat/messages/:id/pin` | 🔑 | Pin message in conversation |
| POST | `/chat-requests` | 🔑 | Send chat request to user |
| GET  | `/chat-requests` | 🔑 | List received/sent chat requests |
| PATCH | `/chat-requests/:id/accept` | 🔑 | Accept chat request |
| PATCH | `/chat-requests/:id/reject` | 🔑 | Reject chat request |
| POST | `/chat/reports` | 🔑 | Report a message |

### 5.8 Communities Module `/api/communities`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/communities` | 🔑 | Create community (KYC required) |
| GET  | `/communities` | 🔑 | List/search public communities |
| GET  | `/communities/:id` | 🔑 | Community detail |
| PATCH | `/communities/:id` | 🔑 | Update community (owner only) |
| DELETE | `/communities/:id` | 🔑 | Delete community (owner only) |
| POST | `/communities/:id/join` | 🔑 | Join community (or request for PRIVATE) |
| DELETE | `/communities/:id/members/:userId` | 🔑 | Remove member |
| PATCH | `/communities/:id/members/:userId/role` | 🔑 | Change member role |
| POST | `/communities/:id/members/:userId/mute` | 🔑 | Mute member for duration |
| GET  | `/communities/:id/members` | 🔑 | List members |

### 5.9 Events Module `/api/events`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/events` | 🔑 | Create event (KYC required) |
| GET  | `/events` | 🔑 | List/filter events |
| GET  | `/events/:id` | 🔑 | Event detail |
| PATCH | `/events/:id` | 🔑 | Update event (organizer only) |
| DELETE | `/events/:id` | 🔑 | Cancel event |
| POST | `/events/:id/register` | 🔑 | Register for event, get QR ticket |
| GET  | `/events/:id/ticket` | 🔑 | Get attendee QR ticket |
| POST | `/events/:id/checkin` | 🛡️🔑 | Check in via QR scan |
| GET  | `/events/:id/analytics` | 🔑 | Event organizer analytics |
| DELETE | `/events/:id/registration` | 🔑 | Cancel registration |

### 5.10 Search Module `/api/search`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/search` | 🔑 | Universal search: `?q=&type=&city=&lat=&lng=&page=` |
| GET  | `/search/autocomplete` | 🔑 | Autocomplete suggestions: `?q=` |

### 5.11 Safety Module `/api/safety`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/safety/sos` | 🔑 | Trigger emergency SOS |
| PATCH | `/safety/sos/:id/resolve` | 🔑 | Resolve active SOS |
| GET  | `/safety/contacts` | 🔑 | Get trusted contacts |
| POST | `/safety/contacts` | 🔑 | Add trusted contact |
| DELETE | `/safety/contacts/:id` | 🔑 | Remove trusted contact |
| POST | `/safety/timer` | 🔑 | Start safety timer |
| POST | `/safety/timer/checkin` | 🔑 | Check in to safety timer |
| POST | `/safety/incident` | 🔑 | Report safety incident |

### 5.12 Notifications Module `/api/notifications`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/notifications` | 🔑 | Paginated notification list |
| PATCH | `/notifications/mark-read` | 🔑 | Mark all notifications as read |
| PATCH | `/notifications/:id/read` | 🔑 | Mark single notification read |
| GET  | `/notifications/preferences` | 🔑 | Get category mute preferences |
| PATCH | `/notifications/preferences` | 🔑 | Update category mute preferences |

### 5.13 Admin Module `/api/admin`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET  | `/admin/dashboard` | 🛡️ | Live platform metrics |
| GET  | `/admin/users` | 🛡️ | Search/list users |
| GET  | `/admin/users/:id` | 🛡️ | User detail with full history |
| PATCH | `/admin/users/:id/status` | 🛡️ | Update user status |
| POST | `/admin/users/:id/notes` | 🛡️ | Add internal note to user |
| GET  | `/admin/kyc/queue` | 🛡️ | KYC review queue |
| PATCH | `/admin/kyc/:id/approve` | 🛡️ | Approve KYC |
| PATCH | `/admin/kyc/:id/reject` | 🛡️ | Reject KYC with reason |
| GET  | `/admin/withdrawals` | 🛡️ | Withdrawal approval queue |
| PATCH | `/admin/withdrawals/:id/approve` | 🛡️ | Approve withdrawal |
| PATCH | `/admin/withdrawals/:id/reject` | 🛡️ | Reject withdrawal |
| GET  | `/admin/bookings` | 🛡️ | Booking management list |
| PATCH | `/admin/bookings/:id/cancel` | 🛡️ | Cancel booking with reason |
| POST | `/admin/bookings/:id/refund` | 🛡️ | Initiate manual refund |
| GET  | `/admin/sos` | 🛡️ | Active SOS incidents |
| GET  | `/admin/audit-log` | 🛡️ | Audit log with filters |
| POST | `/admin/broadcast` | 🛡️ | Create broadcast notification campaign |
| GET  | `/admin/reports/export` | 🛡️ | Trigger report export |
| GET  | `/admin/feature-flags` | 👑 | List feature flags |
| PATCH | `/admin/feature-flags/:key` | 👑 | Toggle feature flag |
| POST | `/admin/admins` | 👑 | Create admin account |
| DELETE | `/admin/admins/:id` | 👑 | Delete admin account |
| POST | `/admin/maintenance` | 👑 | Toggle maintenance mode |
| POST | `/admin/blocklist` | 👑 | Add to blocklist |
| POST | `/admin/backup` | 👑 | Trigger database backup |

---

## 6. 8-Step Booking Flow

### 6.1 State Machine Overview

```
PAYMENT_PENDING
      │ User initiates payment
      ▼
PAYMENT_INITIATED
      │ Razorpay order created
      ▼
PAYMENT_SUCCESSFUL ◄── Razorpay webhook (signature verified)
      │
      ▼
PARTNER_SEARCHING ◄── Bull job: geo-query available partners + send FCM
      │
      ▼
PARTNER_ASSIGNED ◄── System assigns first partner who accepts within 90s
      │
      ▼
PARTNER_ACCEPTED ◄── Partner taps Accept in app
      │
      ▼
OTP_GENERATED ◄── System generates dual OTPs (start + end)
      │
      ▼
IN_PROGRESS ◄── Partner enters start OTP at pickup location
      │
      ▼
COMPLETED ◄── User enters end OTP to confirm service completion
      │
      ├── CANCELLED (user or partner cancels, or 10-min timeout)
      │        │
      │        ▼
      │   REFUND_INITIATED ──► REFUND_COMPLETED
```

### 6.2 State Transition Details

#### Step 1 — Service Selection (Client-side)
- User selects `WALKING_BUDDY` or `CARRY_BUDDY`
- Checks KYC status client-side (redirect to KYC if not APPROVED)
- No backend call yet

#### Step 2 — Location and Schedule (Client-side + API)
- User enters pickup address, destination, date/time, duration
- `POST /bookings/estimate` → LocationService geocodes both addresses via LocationIQ → PricingService calculates fare
- Display: base fare, platform fee, estimated total

#### Step 3 — Price Estimate (Client-side)
- User reviews pricing breakdown
- Apply coupon: `POST /bookings/estimate` with `couponCode`
- System validates coupon against active Coupon records

#### Step 4 — Payment

**Trigger:** User taps "Pay Now"

**Validations:**
- User KYC status = APPROVED
- User wallet balance ≥ finalAmount (if using wallet) OR Razorpay flow
- No existing active booking for user

**Actions:**
1. `POST /bookings` → Creates `Booking{status: PAYMENT_PENDING}` in PostgreSQL
2. `POST /payments/create-order` → Creates Razorpay order, returns `razorpayOrderId`
3. Update `Booking{status: PAYMENT_INITIATED, razorpayOrderId}`
4. Firestore write: `activeBookings/{bookingId}{status: PAYMENT_INITIATED}`

**Razorpay Webhook:**
1. Verify HMAC signature with `RAZORPAY_WEBHOOK_SECRET`
2. Update `Booking{status: PAYMENT_SUCCESSFUL, razorpayPaymentId, paymentVerifiedAt}`
3. Debit user wallet (Transaction type: `BOOKING_DEBIT`)
4. Write AuditLog: `{action: BOOKING_PAYMENT_CAPTURED}`
5. Enqueue `partnerSearch` Bull job

**Side Effects:** FCM to user: "Payment confirmed, searching for partner..."

#### Step 5 — Partner Matching

**Trigger:** `partnerSearch` Bull job dequeued

**Validations on each partner:**
- `isAvailable = true`
- `isApproved = true`
- Partner KYC status = APPROVED
- Not currently handling another IN_PROGRESS booking
- Within 10 km radius of `pickupLat/pickupLng`

**Actions:**
1. Update `Booking{status: PARTNER_SEARCHING}`
2. Firestore `activeBookings/{bookingId}{status: PARTNER_SEARCHING}`
3. Send FCM notification to each matching partner (batched, nearest first)
4. Set `BookingTimeout` record with `timeoutAt = now + 10 minutes`
5. Each partner sees 90-second countdown on their app

**Partner Accept → PARTNER_ASSIGNED then PARTNER_ACCEPTED:**
1. `POST /partners/job/:id/accept`
2. Lock booking to this partner (atomic DB transaction)
3. Update `Booking{status: PARTNER_ACCEPTED, partnerId}`
4. Cancel pending FCM to other partners
5. Clear `BookingTimeout` record
6. Firestore `activeBookings/{bookingId}{status: PARTNER_ACCEPTED, partnerId}`
7. FCM to user: "Partner found! [Name] is on their way."
8. AuditLog: `PARTNER_ASSIGNED`

**Timeout (10 minutes):**
1. `BookingTimeoutJob` polls `BookingTimeout` records
2. Auto-cancel: `Booking{status: CANCELLED, cancelledBy: SYSTEM, cancelReason: NO_PARTNER_FOUND}`
3. Initiate full refund → `Booking{status: REFUND_INITIATED}`
4. Wallet credit: `BOOKING_REFUND` transaction
5. FCM to user: "No partner available. Full refund initiated."

#### Step 6 — Live Tracking and OTP Start

**Actions on PARTNER_ACCEPTED:**
1. Generate two 6-digit OTPs: `otpStart` (user shows to partner) and `otpEnd` (partner gives to user)
2. Update `Booking{status: OTP_GENERATED, otpStart, otpEnd, otpGeneratedAt}`
3. FCM to user with `otpStart` (show to partner at pickup)
4. FCM to partner with routing to pickup location

**Partner enters OTP Start:**
1. `POST /bookings/:id/start-otp` with `{ otp: "123456" }`
2. Validate `otp === booking.otpStart` and `booking.status === OTP_GENERATED`
3. Update `Booking{status: IN_PROGRESS, startedAt}`
4. Firestore `activeBookings/{bookingId}{status: IN_PROGRESS}`
5. Partner app begins 5-second location streaming to `partnerLocations/{partnerId}`
6. FCM to user: "Service started!"
7. AuditLog: `BOOKING_STARTED`

**During IN_PROGRESS:**
- Partner location: Firestore write every 5 seconds
- User app: real-time map with partner location pin
- Safety center shortcut persistently visible

#### Step 7 — Service Delivery and OTP End

**User confirms completion via OTP End:**
1. `POST /bookings/:id/end-otp` with `{ otp: "789012" }`
2. Validate `otp === booking.otpEnd` and `booking.status === IN_PROGRESS`
3. Calculate `finalAmount`, `platformFee`, `partnerEarning`
4. Update `Booking{status: COMPLETED, completedAt, finalAmount, platformFee, partnerEarning}`
5. Credit partner wallet: `Transaction{type: EARNING}`
6. Update `PartnerEarnings` record (today/weekly/monthly/lifetime)
7. Update `Partner.averageRating` if rating exists
8. Firestore: delete `activeBookings/{bookingId}` (or set status COMPLETED)
9. Stop partner location streaming
10. Generate invoice PDF → upload to Firebase Storage → update `Booking.invoiceUrl`
11. FCM to partner: "Booking complete. ₹X credited to your wallet."
12. AuditLog: `BOOKING_COMPLETED`

#### Step 8 — Completion, Invoice, and Rating

**Client-side screens:**
- Invoice screen: booking ID, service type, locations, duration, fare breakdown
- Rating screen: 1–5 stars + optional comment
- `POST /bookings/:id/rate` → saves `Rating`, updates `Partner.averageRating`, updates TrustScore

**Reward credits triggered:**
- `BOOKING_COMPLETE` reward points credited to user
- If milestone reached (10th, 50th booking) → badge awarded
- Partner points credited based on `incentiveMultiplier`

### 6.3 Cancellation Rules

| When | Cancelled By | Refund |
|------|-------------|--------|
| PAYMENT_PENDING → before PAYMENT_SUCCESSFUL | User | N/A (no charge) |
| PAYMENT_SUCCESSFUL → before PARTNER_ACCEPTED | User | 100% refund |
| After PARTNER_ACCEPTED | User | Platform cancellation fee deducted |
| After PARTNER_ACCEPTED | Partner | 100% refund to user; partner penalty points |
| 10-min timeout (no partner) | System | 100% refund |

### 6.4 Financial Invariant

```
assert(partnerEarning + platformFee + discountAmount === finalAmount)
// All amounts in paise (integer) to avoid floating point errors
```

---

## 7. Frontend Architecture

### 7.1 React Native App Structure

```
src/
  features/
    auth/
      screens/
        SplashScreen.tsx
        OnboardingScreen.tsx      ← 3-slide carousel
        LoginScreen.tsx
        RegisterScreen.tsx
        OtpVerifyScreen.tsx
        ProfileSetupScreen.tsx
        EmergencyContactScreen.tsx
        AccountSelectionScreen.tsx
        PermissionsScreen.tsx
      hooks/
        useAuth.ts                ← Zustand auth slice
        useFirebaseAuth.ts        ← Firebase Auth SDK hooks
      api/
        auth.api.ts               ← Axios calls to /api/auth
      auth.types.ts
    home/
      screens/
        HomeScreen.tsx            ← Dashboard, banners, quick actions
      hooks/
        useHomeData.ts            ← React Query composite query
      components/
        ActiveBookingBanner.tsx
        NearbyPartnerCount.tsx
        FeaturedBanners.tsx
        QuickActionButtons.tsx
        AISuggestedPartners.tsx
    booking/
      screens/
        Step1_ServiceSelect.tsx
        Step2_LocationSchedule.tsx
        Step3_PriceEstimate.tsx
        Step4_Payment.tsx
        Step5_PartnerMatching.tsx
        Step6_LiveTracking.tsx    ← MapView + partner location pin
        Step7_ServiceDelivery.tsx ← OTP entry screens
        Step8_Completion.tsx      ← Invoice + rating
      hooks/
        useBookingFlow.ts         ← Multi-step state machine
        usePartnerLocation.ts     ← Firestore listener
        useActiveBooking.ts       ← Firestore activeBookings listener
      api/
        booking.api.ts
    chat/
      screens/
        ConversationsScreen.tsx
        ChatScreen.tsx
        ChatRequestsScreen.tsx
      hooks/
        useMessages.ts            ← Firestore real-time messages listener
        useTypingIndicator.ts     ← Firestore typing write/read
        useConversations.ts
      components/
        MessageBubble.tsx
        MediaMessage.tsx
        VoiceNotePlayer.tsx
        ReplyPreview.tsx
        CallButtons.tsx
      api/
        chat.api.ts
    communities/
      screens/
        CommunitiesListScreen.tsx
        CommunityDetailScreen.tsx
        CreateCommunityScreen.tsx
        CommunityFeedScreen.tsx
      api/
        communities.api.ts
    events/
      screens/
        EventsListScreen.tsx
        EventDetailScreen.tsx
        CreateEventScreen.tsx
        MyTicketScreen.tsx        ← QR code display
        CheckInScreen.tsx         ← QR scanner
      api/
        events.api.ts
    wallet/
      screens/
        WalletScreen.tsx
        TransactionHistoryScreen.tsx
        TopUpScreen.tsx
        WithdrawScreen.tsx
      api/
        wallet.api.ts
    partner/
      screens/
        PartnerDashboardScreen.tsx
        JobRequestScreen.tsx      ← Full-screen with 90s countdown
        JobHistoryScreen.tsx
        EarningsChartScreen.tsx
        BankDetailsScreen.tsx
      hooks/
        usePartnerJobs.ts
      api/
        partner.api.ts
    profile/
      screens/
        MyProfileScreen.tsx
        EditProfileScreen.tsx
        FriendsListScreen.tsx
        BlockedUsersScreen.tsx
        SecuritySettingsScreen.tsx
        DeviceManagementScreen.tsx
    notifications/
      screens/
        NotificationsScreen.tsx
      hooks/
        useNotifications.ts
    safety/
      screens/
        SafetyCenterScreen.tsx    ← Accessible during active booking
        EmergencyContactsScreen.tsx
        SafetyTimerScreen.tsx
        SosScreen.tsx
    search/
      screens/
        SearchScreen.tsx
      hooks/
        useSearch.ts
    settings/
      screens/
        SettingsScreen.tsx
        LanguageScreen.tsx
        NotificationPrefsScreen.tsx
        ThemeScreen.tsx
        AppearanceScreen.tsx
  navigation/
    RootNavigator.tsx             ← Auth vs App switch
    AuthStack.tsx                 ← Splash → Onboarding → Login → Register → OTP → Setup
    UserBottomTabs.tsx            ← Home | Explore | Bookings | Chat | Profile
    PartnerBottomTabs.tsx         ← Dashboard | Jobs | Map | Wallet | Profile
    BookingStack.tsx              ← 8-step wizard
    CommunityStack.tsx
    EventStack.tsx
    AdminWebRoutes.ts             ← (Next.js, separate app)
  design-system/
    tokens/
      colors.ts                   ← Primary #6750A4, surface, dark bg #0F0F0F
      typography.ts               ← Inter (body), Plus Jakarta Sans (headings)
      spacing.ts                  ← 4px base grid
      radii.ts                    ← 16px card, 12px button, 24px sheet
      shadows.ts                  ← rgba(0,0,0,0.08) 0px 4px 16px
    components/
      Button.tsx
      Card.tsx                    ← Glass surface with backdrop blur
      Input.tsx
      Avatar.tsx
      Badge.tsx
      BottomSheet.tsx
      Skeleton.tsx
      EmptyState.tsx
      Toast.tsx
      ProgressBar.tsx
      RatingStars.tsx
      OtpInput.tsx
    theme.ts                      ← Light + Dark theme objects
  shared/
    hooks/
      useNetInfo.ts               ← Network connectivity detection
      usePermissions.ts           ← Camera, location, notifications
      usePagination.ts            ← React Query infinite scroll helper
    utils/
      formatCurrency.ts
      formatDate.ts
      geocode.ts                  ← LocationIQ wrapper
      otp.ts
    api/
      client.ts                   ← Axios instance with Firebase token interceptor
      queryClient.ts              ← React Query client config
    store/
      authStore.ts                ← Zustand: { user, firebaseUser, setUser, logout }
      themeStore.ts               ← Zustand: { theme, setTheme }
      bookingStore.ts             ← Zustand: { activeBooking, setActiveBooking }
      offlineStore.ts             ← Zustand: { queue, enqueue, dequeue }
```

### 7.2 Navigation Structure

```
RootNavigator
├── AuthStack (when !authenticated)
│   ├── SplashScreen
│   ├── OnboardingScreen
│   ├── LoginScreen
│   ├── RegisterScreen
│   ├── OtpVerifyScreen
│   ├── ProfileSetupScreen
│   ├── EmergencyContactScreen
│   ├── AccountSelectionScreen
│   └── PermissionsScreen
│
└── AppNavigator (when authenticated)
    ├── UserBottomTabs (role = USER)
    │   ├── Tab: Home        → HomeScreen
    │   ├── Tab: Explore     → SearchScreen → community/event/profile detail
    │   ├── Tab: Bookings    → BookingHistoryScreen + 8-step BookingStack
    │   ├── Tab: Chat        → ConversationsScreen → ChatScreen
    │   └── Tab: Profile     → MyProfileScreen → settings stack
    │
    ├── PartnerBottomTabs (role = PARTNER, active)
    │   ├── Tab: Dashboard   → PartnerDashboardScreen
    │   ├── Tab: Jobs        → JobHistoryScreen
    │   ├── Tab: Map         → MapScreen (live availability toggle)
    │   ├── Tab: Wallet      → WalletScreen
    │   └── Tab: Profile     → MyProfileScreen
    │
    └── Modals (layered above bottom tabs)
        ├── JobRequestModal  ← full-screen overlay when job arrives
        ├── ActiveBookingBar ← persistent bottom mini-bar
        └── SosTrigger       ← emergency FAB on booking screens
```

### 7.3 State Management

| Concern | Solution | Persistence |
|---------|----------|-------------|
| Server data (bookings, wallet, profile) | TanStack React Query | In-memory + AsyncStorage (react-query-persist-client) |
| Auth session | Zustand `authStore` | AsyncStorage (zustand/middleware/persist) |
| Active booking state | Zustand `bookingStore` | AsyncStorage |
| Theme preference | Zustand `themeStore` | AsyncStorage |
| Offline write queue | Zustand `offlineStore` | AsyncStorage |
| Real-time chat messages | Firestore SDK listener | Firestore offline persistence |
| Real-time partner location | Firestore SDK listener | In-memory only |
| Real-time active booking status | Firestore SDK listener | Firestore offline persistence |

### 7.4 Design System Tokens

```typescript
// colors.ts
export const Colors = {
  // Brand
  primary:          '#6750A4',   // Material You purple
  primaryContainer: '#EADDFF',
  secondary:        '#625B71',
  tertiary:         '#7D5260',

  // Surfaces (Light)
  background:       '#FFFBFE',
  surface:          'rgba(255,255,255,0.15)',  // glassmorphism base
  surfaceVariant:   '#E7E0EC',

  // Surfaces (Dark)
  backgroundDark:   '#0F0F0F',
  surfaceDark:      '#1C1C1E',
  surfaceDarkGlass: 'rgba(28,28,30,0.75)',

  // Semantic
  error:            '#B3261E',
  success:          '#386A20',
  warning:          '#7D5700',
  info:             '#00639B',

  // Text
  onPrimary:        '#FFFFFF',
  onBackground:     '#1C1B1F',
  onSurface:        '#1C1B1F',
  onSurfaceDark:    '#E6E1E5',
} as const;

// typography.ts
export const Typography = {
  fontHeading: 'PlusJakartaSans',
  fontBody:    'Inter',
  sizes: {
    display:   32,
    headline:  24,
    title:     20,
    body:      16,
    label:     14,
    caption:   12,
  },
} as const;

// radii.ts
export const Radii = {
  card:        16,
  button:      12,
  bottomSheet: 24,
  chip:         8,
  avatar:      999,
} as const;

// shadows.ts
export const Shadows = {
  soft: {
    shadowColor:   '#000000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius:  16,
    elevation:     4,
  },
} as const;
```

### 7.5 Glassmorphism Card Component

```typescript
// Card.tsx
import { BlurView } from 'expo-blur';

export const GlassCard = ({ children, style }) => (
  <BlurView
    intensity={20}
    tint="light"                  // 'dark' in dark theme
    style={[
      {
        borderRadius: Radii.card,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        ...Shadows.soft,
      },
      style,
    ]}
  >
    {children}
  </BlurView>
);
```

### 7.6 API Client (Firebase Token Interceptor)

```typescript
// client.ts
import axios from 'axios';
import auth from '@react-native-firebase/auth';

const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL,
  timeout: 15000,
});

apiClient.interceptors.request.use(async (config) => {
  const user = auth().currentUser;
  if (user) {
    const token = await user.getIdToken(/* forceRefresh */ false);
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default apiClient;
```

---

## 8. Real-Time Architecture

### 8.1 Partner Location Streaming

```
Partner App (IN_PROGRESS booking)
  └── Every 5 seconds:
        watchPosition callback (react-native-geolocation-service)
          └── firestore().doc(`partnerLocations/${partnerId}`).set({
                lat, lng, heading, speed, isAvailable: true, updatedAt: now
              })

User App (tracking screen)
  └── Real-time listener:
        firestore().doc(`partnerLocations/${partnerId}`).onSnapshot(snap => {
          updateMapPin(snap.data())
        })

Cleanup: Partner sets isAvailable=false and removes location doc when booking COMPLETED
```

### 8.2 Chat Message Delivery

```
Sender taps Send
  └── POST /chat/messages (validate permission, create Notification record)
        └── firestore()
              .collection('messages')
              .doc(conversationId)
              .collection('messages')
              .add({ senderId, type, content, status: 'sent', createdAt: now })

Recipient device
  └── Firestore onSnapshot listener on messages/{conversationId}/messages
        (ordered by createdAt desc, limit 50, paginated on scroll up)
        └── Renders new message bubble
        └── firestore().doc(`conversations/${conversationId}`)
              .update({ lastMessageId, lastMessageText, lastMessageAt })

Read receipt
  └── When ChatScreen mounts or message scrolls into view:
        batch update message.status = 'read', readAt = now
        → sender's listener receives update → renders double tick
```

### 8.3 Typing Indicators

```
User starts typing
  └── Debounced write (200ms):
        firestore()
          .collection('typingIndicators')
          .doc(conversationId)
          .collection('users')
          .doc(userId)
          .set({ isTyping: true, updatedAt: now })

User stops typing / sends message
  └── Delete the document (or set isTyping: false)

Recipient listener
  └── onSnapshot on typingIndicators/{conversationId}/users
        → show "typing..." indicator if updatedAt within last 5 seconds
```

### 8.4 Active Booking Status Sync

```
Backend (on every Booking status transition)
  └── firestore().doc(`activeBookings/${bookingId}`).set/update({
        status, partnerId, userId, serviceType,
        pickupLat, pickupLng, destLat, destLng, updatedAt: now
      })

User App (booking tracking screen)
  └── onSnapshot on activeBookings/{bookingId}
        → update UI state (searching → matched → in progress → completed)

Partner App (job request flow)
  └── onSnapshot on activeBookings/{bookingId}
        → update partner's job status screen

Cleanup on COMPLETED or CANCELLED
  └── firestore().doc(`activeBookings/${bookingId}`).delete()
```

### 8.5 WebRTC Call Signaling

```
Caller initiates call
  └── firestore().collection('callSignaling').add({
        callerId, receiverId, type: 'voice'|'video',
        status: 'ringing', offer: null, answer: null, iceCandidates: []
      })
  └── Send FCM to recipient: incoming call notification with callId

Recipient answers
  └── Update callSignaling/{callId} → status: 'accepted', answer: RTCSessionDescription

ICE candidate exchange
  └── Both sides arrayUnion to iceCandidates[]

WebRTC peer connection
  └── Each side: RTCPeerConnection.setRemoteDescription + addIceCandidate

Call end
  └── Update callSignaling/{callId} → status: 'ended'
  └── Clean up document after 60 seconds

STUN servers: Google public STUN (stun:stun.l.google.com:19302)
TURN server: self-hosted coturn (or Twilio NTS) for NAT traversal
```

### 8.6 SOS Real-Time Admin Alert

```
User triggers SOS
  └── POST /safety/sos → creates SosIncident in PostgreSQL
  └── Writes to Firestore: sosAlerts/{incidentId}{ userId, lat, lng, status: 'ACTIVE' }
  └── FCM critical priority to all online admins

Admin Panel (Next.js)
  └── Firestore onSnapshot on sosAlerts (status == 'ACTIVE')
        → live incident map with user location pin
        → red badge on SOS dashboard tab

Resolution
  └── PATCH /safety/sos/:id/resolve
  └── Firestore update: sosAlerts/{incidentId}{ status: 'RESOLVED' }
```

---

## 9. Security Design

### 9.1 Authentication Flow

```
Mobile App → Firebase Auth SDK (phone OTP or email/password)
          → Firebase issues ID token (JWT, 1-hour expiry)
          → App attaches token to every API request header:
              Authorization: Bearer <firebase-id-token>

Backend Middleware
  1. Extract token from Authorization header
  2. admin.auth().verifyIdToken(token)
     → Returns { uid, email, phone_number, ... }
  3. Lookup User by firebaseUid in PostgreSQL
  4. Attach { user, firebaseUser } to req context
  5. Pass to next middleware
```

### 9.2 RBAC Middleware

```typescript
// Permission map
const PERMISSIONS: Record<string, string[]> = {
  USER:        ['read:own', 'write:own', 'book:service', 'join:community'],
  PARTNER:     ['read:own', 'write:own', 'accept:job', 'view:earnings'],
  ADMIN:       ['read:all', 'write:users', 'approve:kyc', 'approve:withdrawal'],
  SUPER_ADMIN: ['*'],  // wildcard: all permissions
};

// Middleware factory
export const requirePermission = (permission: string) =>
  (req: Request, res: Response, next: NextFunction) => {
    const role = req.user.role;
    const allowed = PERMISSIONS[role] ?? [];
    if (allowed.includes('*') || allowed.includes(permission)) {
      return next();
    }
    return sendError(res, 'Forbidden', 403, 'PERMISSION_DENIED');
  };

// Usage in route
router.patch('/:id/approve', requirePermission('approve:kyc'), kycController.approve);
```

### 9.3 Audit Logging

Every write operation on sensitive entities automatically writes to `AuditLog`:

```typescript
// auditLogger.ts middleware
export const auditLog = (action: string, entityType: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', async () => {
      if (res.statusCode < 400) {
        await prisma.auditLog.create({
          data: {
            actorId:    req.user?.id ?? null,
            actorType:  req.user?.role ?? 'ANONYMOUS',
            action,
            entityType,
            entityId:   req.params.id ?? null,
            ipAddress:  req.ip,
            metadata:   JSON.stringify({ body: req.body }),
          },
        });
      }
    });
    next();
  };
```

### 9.4 Rate Limiting

```typescript
// rateLimiter.ts
const authLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 100,              // authenticated users
  keyGenerator: (req) => req.user?.id ?? req.ip,
  store: new RedisStore({ client: redis }),
});

const anonLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,               // unauthenticated IPs
  keyGenerator: (req) => req.ip,
  store: new RedisStore({ client: redis }),
});
```

### 9.5 File Upload Security

```typescript
const ALLOWED_MIME_TYPES = {
  image:    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  document: ['image/jpeg', 'image/png', 'application/pdf'],
  audio:    ['audio/mpeg', 'audio/aac', 'audio/mp4'],
  file:     ['application/pdf', 'application/msword',
             'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
             'application/zip'],
};

const MAX_SIZES = {
  profile:   5 * 1024 * 1024,    // 5 MB
  kyc:       5 * 1024 * 1024,    // 5 MB
  chatImage: 10 * 1024 * 1024,   // 10 MB
  chatFile:  25 * 1024 * 1024,   // 25 MB
  chatVoice: 20 * 1024 * 1024,   // ~5 min audio
};
```

All uploads go via Firebase Storage SDK with server-side validation before the Storage write:
- MIME type checked from buffer (using `file-type` library, not just extension)
- File size enforced
- Malware scan hook (optional: ClamAV integration via background job)
- Storage paths namespaced by userId: `uploads/users/{userId}/kyc/{filename}`

### 9.6 Secrets Management

All credentials stored in environment variables, never in source:

```
FIREBASE_PROJECT_ID
FIREBASE_PRIVATE_KEY
FIREBASE_CLIENT_EMAIL
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
LOCATIONIQ_API_KEY
DATABASE_URL
REDIS_URL
JWT_SECRET
```

Loaded via `config/env.ts` using `zod` schema validation at startup — the server refuses to start if any required variable is missing.

### 9.7 Input Validation

Every route has a Zod schema validator:

```typescript
// Example: create booking DTO
const CreateBookingSchema = z.object({
  serviceType:    z.enum(['WALKING_BUDDY', 'CARRY_BUDDY']),
  pickupAddress:  z.string().min(5).max(500),
  destAddress:    z.string().min(5).max(500),
  scheduledAt:    z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  couponCode:     z.string().max(50).optional(),
  itemType:       z.string().max(100).optional(),  // CarryBuddy only
});

// validate.ts middleware applies schema and returns 400 on failure
```

---

## 10. Background Jobs

All jobs run via **Bull** queues backed by **Redis**. Bull Dashboard (bull-board) exposes a `/admin/jobs` UI for Super Admins.

### 10.1 Job Definitions

#### `notificationBroadcast`
- **Trigger:** Admin creates a broadcast campaign with status SCHEDULED or IMMEDIATE
- **Logic:**
  1. Query target user IDs (ALL, USER_ROLE, PARTNER_ROLE, or city-filtered)
  2. Fan out in batches of 500 to FCM `sendMulticast`
  3. Update `BroadcastCampaign.totalSent`, `totalDelivered` from FCM response
  4. Mark campaign status COMPLETED
- **Concurrency:** 5 workers

#### `payoutProcessing`
- **Trigger:** Admin approves a WithdrawalRequest
- **Logic:**
  1. Call Razorpay Payout API with partner bank/UPI details
  2. On success: update `WithdrawalRequest{status: COMPLETED, razorpayPayoutId, processedAt}`
  3. On failure: update `WithdrawalRequest{status: FAILED}`, refund wallet, notify partner
  4. Write AuditLog
- **Concurrency:** 2 workers (serialized to prevent duplicate payouts)

#### `reportGeneration`
- **Trigger:** Admin requests export from Admin Panel
- **Logic:**
  1. Query PostgreSQL for date-range data
  2. Generate file in requested format (PDF: pdfmake, Excel: exceljs, CSV: fast-csv)
  3. Upload file to Firebase Storage
  4. Send in-app notification to requesting admin with download URL
- **Concurrency:** 3 workers
- **Timeout:** 300 seconds

#### `partnerSearchTimeout`
- **Trigger:** Created when `Booking{status: PARTNER_SEARCHING}` is set; delayed job
- **Delay:** 10 minutes
- **Logic:**
  1. Check if booking still in PARTNER_SEARCHING status
  2. If yes: auto-cancel, initiate full refund, notify user
  3. If no (partner assigned): discard job
- **Concurrency:** 10 workers (many bookings can be searching simultaneously)

#### `leaderboardRefresh`
- **Trigger:** Cron every 60 minutes
- **Logic:**
  1. `SELECT userId, SUM(points) FROM Reward GROUP BY userId ORDER BY sum DESC LIMIT 100`
  2. Store result in Redis key `leaderboard:users` with 65-minute TTL
  3. Same for partners
- **Concurrency:** 1 worker (singleton cron)

#### `dailyLoginRewards`
- **Trigger:** Cron at 00:00 IST (18:30 UTC) daily
- **Logic:**
  1. Query users who logged in today but have no DAILY_LOGIN reward record for today
  2. Credit configurable points (from `PricingConfig.DAILY_LOGIN_POINTS`)
  3. Check streak: if consecutive 7 days → credit weekly bonus
  4. Retry up to 3 times on failure before marking FAILED
- **Concurrency:** 5 workers (batched user processing)

#### `fcmTokenCleanup`
- **Trigger:** Cron daily at 03:00 IST
- **Logic:**
  1. Read all FCM tokens from Firestore `fcmTokens/{userId}`
  2. Call FCM `send` with `dry_run: true` to validate tokens
  3. Delete invalid tokens from Firestore and Device table
- **Concurrency:** 2 workers

#### `bookingEarningsRollup`
- **Trigger:** Cron daily at 00:05 IST
- **Logic:**
  1. Reset `PartnerEarnings.todayEarnings = 0` for all partners
  2. Recalculate `weeklyEarnings` (rolling 7 days)
  3. Recalculate `monthlyEarnings` (calendar month)
- **Concurrency:** 1 worker

### 10.2 Queue Configuration

```typescript
// jobs/config.ts
const defaultJobOptions: JobOptions = {
  attempts:    3,
  backoff:     { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,    // keep last 100 completed
  removeOnFail:     200,    // keep last 200 failed for inspection
};

export const queues = {
  notifications: new Bull('notifications', redisUrl, { defaultJobOptions }),
  payouts:       new Bull('payouts',       redisUrl, { defaultJobOptions }),
  reports:       new Bull('reports',       redisUrl, { defaultJobOptions }),
  booking:       new Bull('booking',       redisUrl, { defaultJobOptions }),
  cron:          new Bull('cron',          redisUrl, { defaultJobOptions }),
};
```

---

## 11. Offline Strategy

### 11.1 Data Cached Locally

| Data | Cache Mechanism | Scope |
|------|----------------|-------|
| Booking history (last 20) | React Query + AsyncStorage persister | User |
| Wallet transactions (last 50) | React Query + AsyncStorage persister | User |
| Chat messages (last 200/conversation) | Firestore offline persistence | User |
| Joined communities list | React Query + AsyncStorage persister | User |
| Registered events list | React Query + AsyncStorage persister | User |
| User own profile | Zustand `authStore` persisted | User |
| App config (pricing, feature flags) | React Query + AsyncStorage (staleTime: 5 min) | Global |
| Partner location (current session) | In-memory Zustand only | Partner |

### 11.2 Offline Indicator

```typescript
// useNetInfo.ts
import NetInfo from '@react-native-community/netinfo';
import { useEffect } from 'react';
import { useOfflineStore } from '../store/offlineStore';

export const useNetInfo = () => {
  const setOnline = useOfflineStore(s => s.setOnline);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setOnline(state.isConnected && state.isInternetReachable);
    });
    return unsubscribe;
  }, []);
};
```

A persistent `OfflineBanner` component renders in the app shell when `!isOnline`.

### 11.3 Write Queue (Offline Mutations)

```typescript
// offlineStore.ts (Zustand)
interface OfflineAction {
  id:       string;
  type:     string;       // 'SEND_MESSAGE' | 'BOOK_SERVICE' | etc.
  payload:  unknown;
  queuedAt: number;
}

const useOfflineStore = create(persist({
  queue:   [] as OfflineAction[],
  enqueue: (action) => set(s => ({ queue: [...s.queue, action] })),
  dequeue: (id)     => set(s => ({ queue: s.queue.filter(a => a.id !== id) })),
}));

// Replay on reconnect
NetInfo.addEventListener(async (state) => {
  if (state.isConnected) {
    const { queue, dequeue } = useOfflineStore.getState();
    for (const action of queue) {
      try {
        await replayAction(action);
        dequeue(action.id);
      } catch (e) {
        // leave in queue for next reconnect attempt
      }
    }
  }
});
```

Write operations attempted while offline are:
- Queued in `offlineStore`
- User sees an informative error toast: "You're offline. This action will sync when you reconnect."
- Replayed in order within 30 seconds of reconnection

### 11.4 React Query Persistence

```typescript
// queryClient.ts
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

const persister = createAsyncStoragePersister({ storage: AsyncStorage });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:       5 * 60 * 1000,   // 5 minutes
      gcTime:          24 * 60 * 60 * 1000, // 24 hours
      retry:           2,
      networkMode:     'offlineFirst',
    },
  },
});

// Wrap app in <PersistQueryClientProvider>
```

### 11.5 Firestore Offline Persistence

```typescript
// firebase.ts (React Native)
import firestore from '@react-native-firebase/firestore';

firestore().settings({
  persistence: true,          // enables local cache
  cacheSizeBytes: 50_000_000, // 50 MB cache
});
```

---

## 12. Performance Strategy

### 12.1 Image Loading

```typescript
// Use expo-image for all remote images
import { Image } from 'expo-image';

<Image
  source={{ uri: firebaseStorageUrl }}
  placeholder={blurhash}           // low-res placeholder while loading
  contentFit="cover"
  transition={200}                 // smooth fade-in
  cachePolicy="memory-disk"        // CDN + local disk cache
/>
```

Firebase Storage CDN delivers assets from the nearest Google edge node. Cache-Control headers set to `public, max-age=31536000, immutable` for versioned media files.

### 12.2 List Rendering

```typescript
// Use FlashList instead of FlatList for all large lists
import { FlashList } from '@shopify/flash-list';

<FlashList
  data={items}
  estimatedItemSize={80}    // critical for performance
  renderItem={({ item }) => <BookingCard booking={item} />}
  onEndReached={fetchNextPage}
  onEndReachedThreshold={0.5}
/>
```

FlashList achieves ~60 FPS on lists up to 100k items by recycling view cells.

### 12.3 API Response Caching (Backend)

```typescript
// Redis cache wrapper for read-heavy endpoints
const withCache = (key: string, ttl: number, fn: () => Promise<unknown>) =>
  async () => {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
    const data = await fn();
    await redis.setex(key, ttl, JSON.stringify(data));
    return data;
  };

// Applied to:
// - GET /pricing/config        → TTL 5 min
// - GET /content/app-settings  → TTL 5 min
// - GET /content/feature-flags → TTL 5 min
// - GET /search/autocomplete   → TTL 1 min (per query prefix)
// - GET /admin/dashboard       → TTL 60 sec
```

### 12.4 Database Query Optimization

- All foreign keys indexed in Prisma schema
- Status + createdAt composite indexes on Booking, Transaction, Notification tables
- `city` indexed on User, Community for geo-filtered queries
- Booking geo search: use Prisma raw SQL with `earthdistance` extension (PostgreSQL) for partner proximity
- `SELECT *` never used — always explicit field selection via Prisma `select`
- Paginated queries use cursor-based pagination (keyset) for large tables

```typescript
// Cursor-based pagination example
const bookings = await prisma.booking.findMany({
  where:   { userId, ...(cursor && { id: { lt: cursor } }) },
  orderBy: { createdAt: 'desc' },
  take:    20,
  select:  { id: true, status: true, serviceType: true, finalAmount: true, createdAt: true },
});
```

### 12.5 React Native Performance

| Optimization | Implementation |
|-------------|---------------|
| JS engine | Hermes enabled for Android (reduces bundle size + startup time) |
| Code splitting | Metro lazy imports (`React.lazy` + `Suspense`) per feature screen |
| Heavy screens | Deferred rendering with `InteractionManager.runAfterInteractions` |
| Animations | `useAnimatedStyle` (Reanimated 3) running on UI thread, no JS bridge |
| Map rendering | `react-native-maps` with `MapMarker` clustering for partner pins |
| Bundle size | `babel-plugin-transform-remove-console` in production builds |
| Image optimization | expo-image WebP format + progressive loading + blurhash placeholders |

### 12.6 Backend Scalability

- **Stateless servers:** all session state in Firestore; any API instance can serve any request
- **Horizontal scaling:** add API instances behind a load balancer; Bull jobs consumed by all instances (Redis coordinates)
- **Connection pooling:** Prisma connection pool configured to `min: 2, max: 10` per instance
- **Read replicas:** PostgreSQL read replica for analytics/admin queries; write queries to primary
- **CDN:** All Firebase Storage assets served through Firebase Hosting CDN
- **Health check:** `GET /health` returns `{ status: "ok" }` — used by load balancer health probes

---

## Appendix A: Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string (Bull + rate limiter) |
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project identifier |
| `FIREBASE_PRIVATE_KEY` | ✅ | Firebase Admin SDK private key |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Firebase Admin SDK service account email |
| `RAZORPAY_KEY_ID` | ✅ | Razorpay API key ID |
| `RAZORPAY_KEY_SECRET` | ✅ | Razorpay API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ | Razorpay webhook signature secret |
| `LOCATIONIQ_API_KEY` | ✅ | LocationIQ geocoding API key |
| `CORS_ORIGIN` | ✅ | Allowed CORS origin (admin panel URL) |
| `PORT` | ✅ | API server port (default: 5000) |
| `NODE_ENV` | ✅ | `development` / `production` |
| `UPLOAD_DIR` | ⬜ | Local upload directory (dev only; prod uses Firebase Storage) |

---

## Appendix B: Error Codes Reference

| Code | HTTP | Meaning |
|------|------|---------|
| `OTP_MAX_ATTEMPTS_EXCEEDED` | 429 | OTP locked for 15 minutes |
| `PHONE_ALREADY_REGISTERED` | 409 | Duplicate phone number |
| `EMAIL_ALREADY_REGISTERED` | 409 | Duplicate email address |
| `KYC_NOT_APPROVED` | 403 | Action requires approved KYC |
| `PAYMENT_FAILED` | 402 | Razorpay payment failed or timed out |
| `PARTNER_NOT_FOUND` | 404 | No available partner within radius |
| `BOOKING_TIMEOUT` | 408 | Partner search timed out (10 min) |
| `INSUFFICIENT_BALANCE` | 402 | Wallet balance too low |
| `INVALID_OTP` | 422 | OTP does not match |
| `BOOKING_STATE_INVALID` | 409 | Transition not allowed from current status |
| `EVENT_CAPACITY_REACHED` | 409 | Event is full |
| `INVALID_EVENT_DATES` | 422 | End time ≤ start time |
| `LAST_OWNER_PROTECTION` | 409 | Cannot remove last community owner |
| `FILE_TYPE_NOT_ALLOWED` | 415 | MIME type not in whitelist |
| `FILE_TOO_LARGE` | 413 | File exceeds size limit |
| `PERMISSION_DENIED` | 403 | RBAC role insufficient |
| `VALIDATION_ERROR` | 400 | Request schema validation failed |
| `NOT_FOUND` | 404 | Resource does not exist |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## Appendix C: Migration Plan (SQLite/Clerk → PostgreSQL/Firebase)

1. **Database:** Export all existing SQLite data → transform scripts → import to PostgreSQL. Prisma schema updated for PostgreSQL dialect (remove SQLite-specific serializations for JSON fields → native `Json` type).
2. **Auth:** Migrate existing user accounts: create Firebase Auth users with matching email/phone; link `firebaseUid` on User model. Rotate session tokens.
3. **File storage:** Move `uploads/` directory contents to Firebase Storage maintaining folder structure under `legacy/`.
4. **Notifications:** Replace any existing push implementation with FCM; collect device FCM tokens on first login after upgrade.
5. **Feature flags:** New `FeatureFlag` records control gradual rollout of each migrated module.
6. **Backward compat:** API response envelope `{success, data, message, code}` maintained throughout — zero client-side contract change.
7. **Zero-downtime:** Blue-green deployment; PostgreSQL dual-write period during cutover; feature flags gate new modules until verified.
