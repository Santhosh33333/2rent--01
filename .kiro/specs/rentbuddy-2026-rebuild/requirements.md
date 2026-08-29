# Requirements Document

## Introduction

RentBuddy 2026 is a premium, enterprise-grade social and services platform that connects Users with Partners offering Walking Buddy and CarryBuddy services. The platform supports Android, iOS, and Web (Admin Panel), combining trust-based social networking with a marketplace for real-world assistance services. It includes Communities, Events, real-time Chat, Wallet/Payments, KYC verification, AI-powered features, a Reward System, Safety Center, and a full Admin/Super Admin control panel.

The rebuild migrates the existing Node.js/Express/Prisma (SQLite) backend to a production-grade stack using Firebase Authentication, Firebase Firestore, Firebase Storage, FCM for notifications, LocationIQ for maps, and Razorpay for payments. The frontend targets React Native (mobile) and Next.js (web admin panel). Architecture follows Clean Architecture with feature-based modules and the Repository Pattern.

---

## Glossary

- **App**: The RentBuddy 2026 mobile application (React Native, Android + iOS).
- **Admin_Panel**: The RentBuddy 2026 web admin interface (Next.js).
- **Auth_Service**: Firebase Authentication module handling identity, OTP, and session management.
- **User**: An authenticated platform member who can book services, join communities, and attend events.
- **Partner**: An approved User who provides Walking Buddy or CarryBuddy services and receives earnings.
- **Admin**: A platform operator with limited management capabilities.
- **Super_Admin**: A platform owner with full platform control including admin account management.
- **KYC_Service**: The Know-Your-Customer identity verification workflow (document upload, selfie, review).
- **Booking_Service**: The end-to-end booking lifecycle manager (creation through completion and rating).
- **Wallet_Service**: The financial ledger managing User and Partner balances, transactions, and withdrawals.
- **Payment_Gateway**: Razorpay integration for processing card, UPI, and net-banking payments.
- **Notification_Service**: Firebase Cloud Messaging (FCM) module that delivers push notifications.
- **Chat_Service**: Real-time messaging module (text, voice notes, images, files, location).
- **Community_Service**: Groups/communities management module.
- **Event_Service**: Event creation, ticketing, and attendance management module.
- **Safety_Service**: Emergency SOS, trusted contacts, and safety-timer module.
- **AI_Service**: AI-powered suggestion, fraud detection, spam detection, and support module.
- **Reward_Service**: Points, badges, levels, referral bonuses, and leaderboard module.
- **Location_Service**: LocationIQ-backed geocoding, routing, and live-location module.
- **Search_Service**: Universal full-text and geo-filtered search across users, partners, events, and communities.
- **Report_Service**: User-generated abuse/spam reports and admin resolution workflow.
- **OTP**: One-Time Password used to verify phone numbers and to start/finish a booking.
- **KYC_Status**: Enumeration: NOT_STARTED | DRAFT | SUBMITTED | PENDING_REVIEW | UNDER_VERIFICATION | APPROVED | REJECTED | RESUBMIT_REQUIRED.
- **Booking_Status**: Enumeration: PAYMENT_PENDING | PAYMENT_INITIATED | PAYMENT_SUCCESSFUL | PARTNER_SEARCHING | PARTNER_ASSIGNED | PARTNER_ACCEPTED | OTP_GENERATED | IN_PROGRESS | COMPLETED | CANCELLED | REFUND_INITIATED | REFUND_COMPLETED.
- **Wallet_Transaction_Type**: Enumeration: TOPUP | BOOKING_DEBIT | BOOKING_REFUND | EARNING | WITHDRAWAL | REWARD | CASHBACK | COUPON.
- **Service_Type**: Enumeration: WALKING_BUDDY | CARRY_BUDDY.
- **FCM_Token**: Firebase Cloud Messaging device registration token.
- **INR**: Indian Rupee, the default currency of the platform.
- **TrustScore**: A computed integer (0–100) reflecting a User's or Partner's reliability based on ratings, KYC status, and reports.

---

## Requirements

---

### Requirement 1: User Onboarding and Authentication

**User Story:** As a new visitor, I want a guided onboarding experience with OTP-verified registration, so that I can create a trusted identity on the platform.

#### Acceptance Criteria

1. THE App SHALL display a splash screen for a maximum of 3 seconds before navigating to the Onboarding flow on first launch.
2. THE App SHALL present an Onboarding carousel of at least 3 slides describing platform features before prompting registration.
3. WHEN a visitor submits a registration form with full name, email address, phone number, date of birth, gender, and password, THE Auth_Service SHALL create a new User account and send an OTP to the provided phone number within 30 seconds.
4. WHEN a visitor submits an OTP, THE Auth_Service SHALL verify the OTP against the registered phone number and mark the phone as verified if the OTP matches and has not expired.
5. IF a visitor submits an incorrect OTP 5 consecutive times, THEN THE Auth_Service SHALL lock the OTP verification for 15 minutes and return an error code OTP_MAX_ATTEMPTS_EXCEEDED.
6. WHEN a User submits a valid OTP, THE App SHALL navigate the User to the Profile Setup screen.
7. WHEN a User submits profile setup data including display name, profile photo, city, and bio, THE App SHALL save the profile and navigate to the Emergency Contact screen.
8. WHEN a User submits an emergency contact with name, phone, and relationship, THE App SHALL save the emergency contact and navigate to the Account Selection screen.
9. WHEN a User selects the Partner account type on the Account Selection screen, THE App SHALL navigate to the KYC flow before enabling partner features.
10. IF a registration form is submitted with a phone number that already exists in the system, THEN THE Auth_Service SHALL return error code PHONE_ALREADY_REGISTERED without creating a duplicate account.
11. IF a registration form is submitted with an email address that already exists in the system, THEN THE Auth_Service SHALL return error code EMAIL_ALREADY_REGISTERED without creating a duplicate account.
12. THE Auth_Service SHALL support password reset via OTP sent to the registered phone number.
13. WHEN a User logs in with valid credentials, THE Auth_Service SHALL return a session token and refresh token with an expiry of 24 hours and 30 days respectively.
14. THE App SHALL request camera, location, and notification permissions from the operating system during the Permissions screen of the onboarding flow.
15. FOR ALL valid User registrations, encoding the User's credentials and then decoding the session token SHALL produce a User object containing the same userId (round-trip property).

---

### Requirement 2: KYC Identity Verification

**User Story:** As a User who wants to book services or withdraw earnings, I want a step-by-step KYC wizard, so that my identity can be verified before I access sensitive platform features.

#### Acceptance Criteria

1. THE KYC_Service SHALL gate the following actions behind an APPROVED KYC_Status: booking a service, withdrawing earnings, creating a Community, creating an Event, and enabling Partner mode.
2. WHEN a User starts the KYC flow, THE KYC_Service SHALL display a progress indicator showing completion percentage (20% per completed step, maximum 100%).
3. WHEN a User uploads a government ID document (Aadhaar, PAN, Passport, Voter ID, or Driving Licence), THE KYC_Service SHALL accept only JPEG, PNG, or PDF files with a maximum size of 5 MB per file.
4. WHEN a User uploads a selfie, THE KYC_Service SHALL accept only JPEG or PNG files with a maximum size of 5 MB and SHALL store the image in Firebase Storage.
5. WHEN a User submits the KYC form after completing all steps, THE KYC_Service SHALL transition the KYC_Status from DRAFT to SUBMITTED and notify the Admin queue.
6. WHEN an Admin approves a KYC submission, THE KYC_Service SHALL transition the KYC_Status to APPROVED, ungate the protected actions, and send a push notification to the User via Notification_Service.
7. WHEN an Admin rejects a KYC submission with a rejection reason, THE KYC_Service SHALL transition the KYC_Status to REJECTED, record the rejection reason, and send a push notification with the rejection reason to the User.
8. IF a User resubmits KYC after a REJECTED status, THEN THE KYC_Service SHALL create a new VerificationHistory record and transition the status to SUBMITTED.
9. THE KYC_Service SHALL maintain a full audit trail of all KYC_Status transitions with timestamp, actor, and optional note.
10. WHILE KYC_Status is PENDING_REVIEW or UNDER_VERIFICATION, THE App SHALL display a "Verification in Progress" state and prevent resubmission.
11. FOR ALL valid KYC document uploads, the document URL stored in Firestore SHALL be retrievable using the same path (round-trip property).

---

### Requirement 3: Home Dashboard

**User Story:** As an authenticated User, I want a personalized home dashboard showing relevant information at a glance, so that I can quickly access core features.

#### Acceptance Criteria

1. WHEN a User navigates to the Home Dashboard, THE App SHALL render the full screen within 3 seconds on a standard 4G connection.
2. THE App SHALL display on the Home Dashboard: the User's profile photo and name, wallet balance, active booking status (if any), nearby available Partners count, featured banners, quick-action buttons for Walk/Carry booking, recent notifications count, and AI-suggested Partners.
3. WHEN a User taps a quick-action button for Walk or Carry booking, THE App SHALL navigate directly to Step 1 of the Booking_Service flow for the selected Service_Type.
4. THE App SHALL render the Home Dashboard with skeleton loading placeholders while data is being fetched to maintain 60 FPS animations.
5. WHILE a User has an active booking in PARTNER_SEARCHING, PARTNER_ACCEPTED, OTP_GENERATED, or IN_PROGRESS Booking_Status, THE App SHALL display a persistent banner on the Home Dashboard linking to the active booking detail screen.
6. THE App SHALL support a light theme and a dark theme, and SHALL apply the selected theme consistently across all screens including the Home Dashboard.
7. THE App SHALL cache the Home Dashboard data locally and display the cached version when the device is offline, with a visible "Offline" indicator.

---

### Requirement 4: Partner Availability and Matching

**User Story:** As a Partner, I want to manage my availability and receive booking requests in real time, so that I can earn income on my own schedule.

#### Acceptance Criteria

1. WHEN a Partner toggles their availability to Online, THE Booking_Service SHALL mark the Partner's isAvailable flag as true and update the PartnerLocation record in Firestore.
2. WHEN a Partner toggles their availability to Offline, THE Booking_Service SHALL mark the Partner's isAvailable flag as false and prevent new booking requests from being assigned.
3. WHEN a Booking_Status transitions to PAYMENT_SUCCESSFUL, THE Booking_Service SHALL query all available Partners within a 10 km radius of the booking's start location and notify each via Notification_Service within 5 seconds.
4. WHEN a Partner receives a booking request notification, THE App SHALL display the booking details and an Accept/Reject action with a 90-second response timer.
5. IF a Partner does not respond to a booking request within 90 seconds, THEN THE Booking_Service SHALL mark the request as expired for that Partner and notify the next available Partner.
6. WHEN a Partner accepts a booking, THE Booking_Service SHALL transition the Booking_Status to PARTNER_ACCEPTED, stop notifying other Partners, and send a push notification to the User.
7. IF no Partner accepts a booking within 10 minutes of PARTNER_SEARCHING status, THEN THE Booking_Service SHALL transition the Booking_Status to CANCELLED, initiate a full refund via Wallet_Service, and notify the User.
8. THE Booking_Service SHALL update a Partner's real-time location in Firestore at a maximum interval of 5 seconds while the Partner has an active booking in IN_PROGRESS status.
9. WHEN a Partner completes a booking, THE Booking_Service SHALL calculate the Partner's net earning as: finalAmount minus platformFee, credit the Partner's Wallet_Service balance, and update PartnerEarnings records.
10. THE Booking_Service SHALL enforce that a Partner with KYC_Status other than APPROVED cannot accept bookings.

---

### Requirement 5: 8-Step Booking Flow

**User Story:** As a User with APPROVED KYC, I want a clear multi-step booking wizard for Walking Buddy and CarryBuddy services, so that I can schedule and pay for a service with confidence.

#### Acceptance Criteria

1. THE App SHALL present the booking flow in exactly 8 sequential steps: (1) Service Selection, (2) Location and Schedule, (3) Price Estimate, (4) Payment, (5) Partner Matching, (6) Live Tracking and OTP Start, (7) Service Delivery and OTP Finish, (8) Completion, Invoice, and Rating.
2. WHEN a User selects a Service_Type and proceeds to Step 2, THE App SHALL require pickup location, destination location, date, time, and duration before allowing progression.
3. WHEN a User submits Step 2 location data, THE Booking_Service SHALL call the Location_Service to geocode both locations and return a price estimate based on distance, duration, and current PricingConfig rules.
4. WHEN a User applies a coupon code on the Payment step, THE Booking_Service SHALL validate the coupon against active coupons, apply the discount to the estimated amount, and display the discounted total.
5. WHEN a User initiates payment, THE Payment_Gateway SHALL create a Razorpay order and return an order ID to THE App within 10 seconds.
6. WHEN Razorpay confirms a successful payment with a valid signature, THE Booking_Service SHALL verify the Razorpay signature, debit the payment amount from the User's Wallet_Service or confirm the Razorpay capture, and transition Booking_Status to PAYMENT_SUCCESSFUL.
7. IF Razorpay payment fails or times out, THEN THE Booking_Service SHALL retain Booking_Status as PAYMENT_PENDING and return error code PAYMENT_FAILED without creating a booking record.
8. WHEN a Partner starts the booking by entering the User-provided OTP, THE Booking_Service SHALL verify the OTP matches the booking's generated OTP, transition Booking_Status to IN_PROGRESS, and record startedAt timestamp.
9. WHEN a User confirms service completion by entering the Partner-provided OTP, THE Booking_Service SHALL verify the OTP, transition Booking_Status to COMPLETED, record completedAt timestamp, and proceed to Invoice and Rating screens.
10. WHEN a Booking_Status transitions to COMPLETED, THE Booking_Service SHALL generate a digital invoice containing: booking ID, service type, start and end location, duration, fare breakdown (base fare, platform fee, discount), and Partner name.
11. WHEN a User submits a rating for a completed booking with a score between 1 and 5, THE Booking_Service SHALL save the Rating record, update the Partner's averageRating, and update the Partner's TrustScore.
12. IF a User cancels a booking after PAYMENT_SUCCESSFUL but before PARTNER_ACCEPTED, THEN THE Booking_Service SHALL initiate a full refund to the User's wallet within 24 hours.
13. IF a User cancels a booking after PARTNER_ACCEPTED, THEN THE Booking_Service SHALL apply the platform's cancellation policy: deduct a cancellation fee and refund the remainder to the User's wallet.
14. FOR ALL completed bookings, the sum of partnerEarning plus platformFee plus discountAmount SHALL equal finalAmount (financial invariant property).

---

### Requirement 6: Wallet and Payments

**User Story:** As a User or Partner, I want a secure digital wallet to manage my balance, top-ups, earnings, and withdrawals, so that all financial activities are transparent and reliable.

#### Acceptance Criteria

1. THE Wallet_Service SHALL maintain one Wallet record per User with a non-negative balance enforced at the database level.
2. WHEN a User initiates a wallet top-up via Payment_Gateway, THE Wallet_Service SHALL create a PaymentOrder record in CREATED status and return the Razorpay order details.
3. WHEN a Razorpay webhook confirms payment capture, THE Wallet_Service SHALL credit the top-up amount to the User's wallet balance and transition PaymentOrder status to COMPLETED within 60 seconds.
4. WHEN a Partner requests a withdrawal with a valid bank account or UPI detail, THE Wallet_Service SHALL create a WithdrawalRequest record in PENDING status and deduct the requested amount from withdrawableBalance immediately.
5. IF a Partner requests a withdrawal for an amount greater than the withdrawableBalance, THEN THE Wallet_Service SHALL return error code INSUFFICIENT_BALANCE without creating a withdrawal record.
6. WHEN an Admin approves a withdrawal request, THE Wallet_Service SHALL transition the WithdrawalRequest status to APPROVED and trigger the payout process.
7. IF a withdrawal request is rejected by an Admin, THEN THE Wallet_Service SHALL refund the requested amount back to the Partner's wallet balance and transition the status to REJECTED.
8. THE Wallet_Service SHALL record every balance change as a Transaction with a Wallet_Transaction_Type, amount, balance before, balance after, and referenceId.
9. THE App SHALL display a paginated transaction history with filtering by Wallet_Transaction_Type and date range.
10. THE Wallet_Service SHALL support cashback credits, coupon discount credits, and reward coin credits as separate Wallet_Transaction_Type entries.
11. FOR ALL wallet transactions, the sequence of transactions applied to an initial balance SHALL produce a final balance that equals the sum of all credits minus the sum of all debits (balance invariant property).
12. FOR ALL completed PaymentOrders, serializing the PaymentOrder to JSON and deserializing back SHALL produce an equivalent PaymentOrder object (round-trip property).

---

### Requirement 7: Real-Time Chat

**User Story:** As a User or Partner, I want a modern messaging experience with rich media and calling features, so that I can communicate directly and safely within the platform.

#### Acceptance Criteria

1. THE Chat_Service SHALL require an accepted ChatRequest between two Users before allowing them to exchange messages.
2. WHEN a User sends a message, THE Chat_Service SHALL deliver the message to the recipient's device within 2 seconds on a standard 4G connection and update the Conversation's lastMessageId.
3. THE Chat_Service SHALL support the following message types: plain text, images (JPEG/PNG/GIF up to 10 MB), voice notes (MP3/AAC up to 5 minutes), files (PDF/DOC/ZIP up to 25 MB), and location coordinates.
4. WHEN a User is composing a message, THE Chat_Service SHALL broadcast a typing indicator to the recipient for a maximum of 5 seconds or until the message is sent.
5. WHEN a recipient reads a message, THE Chat_Service SHALL update the message status to READ and display a read receipt (double-tick) to the sender.
6. WHEN a User deletes a message, THE Chat_Service SHALL remove the message content and replace it with a "Message deleted" placeholder visible to both participants.
7. THE Chat_Service SHALL support replying to a specific message, where the reply references the original message ID and content.
8. THE Chat_Service SHALL support pinning up to 3 messages per Conversation by either participant.
9. THE Chat_Service SHALL support in-conversation message search returning results matching a text query within the Conversation.
10. THE Chat_Service SHALL support voice calls and video calls between accepted chat participants using WebRTC or a compatible real-time communication protocol.
11. WHEN a User reports a message, THE Report_Service SHALL create a ChatReport record in PENDING status and surface it in the Admin_Panel moderation queue.
12. THE Chat_Service SHALL support automatic message translation to the User's selected language via an integrated translation API.
13. WHEN a User blocks another User, THE Chat_Service SHALL prevent any new messages, calls, or chat requests from the blocked User.
14. WHILE a User is in an active call, THE App SHALL prevent the screen from turning off and shall display call duration.
15. FOR ALL sent messages, storing a message and then retrieving it by ID SHALL return a message with the same senderId, content, and timestamp (round-trip property).

---

### Requirement 8: Communities

**User Story:** As a User with APPROVED KYC, I want to create and join interest-based Communities with rich content features, so that I can build and engage with my social network on the platform.

#### Acceptance Criteria

1. THE Community_Service SHALL require KYC_Status APPROVED before allowing a User to create a Community.
2. WHEN a User creates a Community with a name, description, cover image, privacy setting (PUBLIC or PRIVATE), and city, THE Community_Service SHALL create the Community record and automatically assign the creator as the OWNER member.
3. WHEN a User requests to join a PUBLIC Community, THE Community_Service SHALL add the User as a MEMBER immediately and increment memberCount.
4. WHEN a User requests to join a PRIVATE Community, THE Community_Service SHALL create a join request that must be approved by an OWNER or ADMIN member before membership is granted.
5. WHEN an OWNER or ADMIN member removes a member, THE Community_Service SHALL delete the membership record and decrement memberCount.
6. THE Community_Service SHALL protect against removing the last OWNER of a Community; if only one OWNER remains, THE Community_Service SHALL return error code LAST_OWNER_PROTECTION.
7. THE Community_Service SHALL support Community posts including text, images, polls, and announcements with pinned posts visible at the top of the feed.
8. WHEN a Community OWNER deletes the Community, THE Community_Service SHALL cascade-delete all memberships, posts, and associated data.
9. THE Community_Service SHALL support voice rooms and video rooms accessible to Community members.
10. THE Community_Service SHALL support Community-level moderation tools: ban member, delete post, and mute member for a configurable duration.
11. WHEN a Community member count changes, THE Community_Service SHALL update the memberCount field atomically to prevent race conditions.
12. FOR ALL Communities, the count of CommunityMember records with MEMBER or ADMIN or OWNER role SHALL equal the Community's memberCount field (count invariant property).

---

### Requirement 9: Events

**User Story:** As a User with APPROVED KYC, I want to create and attend Events with QR-coded tickets and analytics, so that I can organize and participate in real-world gatherings through the platform.

#### Acceptance Criteria

1. THE Event_Service SHALL require KYC_Status APPROVED before allowing a User to create an Event.
2. WHEN a User creates an Event with title, description, poster/banner image, location, start time, end time, and optional capacity, THE Event_Service SHALL create the Event record in PUBLISHED status.
3. IF a User attempts to create an Event with an end time earlier than or equal to the start time, THEN THE Event_Service SHALL return error code INVALID_EVENT_DATES without creating the Event.
4. WHEN a User registers for an Event, THE Event_Service SHALL create an EventAttendee record, increment attendeeCount, and issue a QR ticket containing the attendee ID and event ID encoded in a scannable format.
5. IF a User attempts to register for an Event that has reached its capacity, THEN THE Event_Service SHALL return error code EVENT_CAPACITY_REACHED without creating an EventAttendee record.
6. WHEN a User scans a QR ticket at the event, THE Event_Service SHALL validate the ticket, mark the EventAttendee record as checked in, and record the checkedInAt timestamp.
7. THE Event_Service SHALL display a countdown timer showing time remaining until the event starts on the Event detail screen.
8. WHEN an organizer cancels an Event, THE Event_Service SHALL transition the Event status to CANCELLED and send a push notification via Notification_Service to all registered attendees.
9. THE Event_Service SHALL provide organizer analytics including total registrations, check-in count, check-in rate, and attendee demographics breakdown.
10. WHEN a User cancels their registration, THE Event_Service SHALL delete the EventAttendee record and decrement attendeeCount.
11. FOR ALL Events, the count of EventAttendee records in REGISTERED or ATTENDED status SHALL be less than or equal to the Event's capacity when capacity is set (capacity invariant).

---

### Requirement 10: Notifications

**User Story:** As a User or Partner, I want categorized push notifications with granular control over delivery preferences, so that I stay informed without being overwhelmed.

#### Acceptance Criteria

1. THE Notification_Service SHALL support the following notification categories: Booking, Payment, Refund, Wallet, Partner, Community, Event, System, Security, and Offers.
2. WHEN a User registers or logs in on a new device, THE Notification_Service SHALL register the device's FCM_Token and associate it with the User's account.
3. WHEN a device FCM_Token becomes invalid, THE Notification_Service SHALL remove the stale token from the User's device list automatically.
4. THE App SHALL allow a User to mute notifications for any individual category, with the mute setting persisted across app restarts.
5. WHEN a platform event triggers a notification (booking status change, payment confirmation, message received, etc.), THE Notification_Service SHALL deliver the push notification to all registered active FCM_Tokens for the target User within 10 seconds.
6. THE App SHALL support custom notification sound and vibration pattern settings per category.
7. THE App SHALL support a notification schedule allowing a User to define quiet hours during which push notifications are silenced on the device.
8. WHEN a User opens the in-app Notifications screen, THE Notification_Service SHALL mark all displayed notifications as read and update the unread badge count to reflect only unread items.
9. THE Admin_Panel SHALL allow Admins to create and send broadcast notifications to target audiences (ALL, USER_ROLE, PARTNER_ROLE, or specific cities) as scheduled or immediate campaigns.
10. FOR ALL broadcast campaigns, the count of notifications in SENT status SHALL be less than or equal to totalTargeted (sending invariant).

---

### Requirement 11: Safety Center

**User Story:** As a User during a live booking, I want emergency safety tools including SOS, trusted contacts, and a safety timer, so that I can get help quickly if I feel unsafe.

#### Acceptance Criteria

1. THE Safety_Service SHALL allow a User to add up to 5 trusted contacts with name, phone number, and relationship.
2. WHEN a User triggers the Emergency SOS button, THE Safety_Service SHALL immediately capture the User's current GPS coordinates, create a SosIncident record with HIGH severity, send an SMS to all trusted contacts containing the User's name and location link, and alert the Admin_Panel SOS incident dashboard.
3. THE Safety_Service SHALL allow a User to share their live location with trusted contacts for a configurable duration (15 minutes to 8 hours), with automatic expiry.
4. THE Safety_Service SHALL provide a safety timer that a User can set before a booking starts; if the User does not check in within the timer duration, THE Safety_Service SHALL automatically trigger an SOS alert.
5. WHEN a User taps the Emergency Call button, THE App SHALL initiate a phone call to the local emergency services number (112 in India).
6. THE Safety_Service SHALL allow a User to report an incident with category (harassment, theft, assault, other), description, and optional photo evidence.
7. WHEN an SosIncident is created, THE Notification_Service SHALL send a critical-priority push notification to all online Admins within 5 seconds.
8. WHILE a booking is IN_PROGRESS, THE App SHALL display a Safety Center shortcut button persistently visible on the booking tracking screen.
9. WHEN a User resolves an active SOS alert, THE Safety_Service SHALL transition the SosIncident status to RESOLVED and notify the Admin_Panel dashboard.

---

### Requirement 12: Reward System

**User Story:** As a User or Partner, I want to earn points, badges, and rewards for platform engagement, so that I am motivated to participate more and remain loyal.

#### Acceptance Criteria

1. THE Reward_Service SHALL credit a daily login reward of a configurable number of points to any User who logs in on a given calendar day for the first time.
2. WHEN a User completes a full week of consecutive daily logins, THE Reward_Service SHALL credit a weekly streak bonus in addition to the daily reward.
3. WHEN a User successfully refers a new User who completes registration and their first booking, THE Reward_Service SHALL credit a referral bonus to the referrer's wallet via Wallet_Service.
4. THE Reward_Service SHALL maintain milestone badges (e.g., First Booking, 10 Bookings, 50 Bookings, 100 Bookings) and award the badge the first time a User reaches each milestone.
5. THE Reward_Service SHALL maintain Partner levels: BRONZE (0–499 points), SILVER (500–1999 points), GOLD (2000–4999 points), and PLATINUM (5000+ points), and recalculate a Partner's level after each points credit event.
6. WHEN a Partner reaches a new level, THE Notification_Service SHALL send a congratulatory push notification and the Partner's incentiveMultiplier SHALL update according to the new level's configuration.
7. THE App SHALL display an Achievement Gallery showing all earned and locked badges with unlock criteria.
8. THE Reward_Service SHALL maintain a leaderboard of the top 100 Users and top 100 Partners by total points, updated at most every 60 minutes.
9. IF a reward credit fails due to a system error, THEN THE Reward_Service SHALL log the failure and retry the credit up to 3 times before marking the reward as FAILED.
10. FOR ALL Partner level transitions, the Partner's points SHALL be greater than or equal to the minimum threshold for the new level at the time of the transition (monotonic level invariant).

---

### Requirement 13: Universal Search

**User Story:** As a User, I want a single search bar that searches across Partners, Users, Communities, and Events, so that I can discover content across the platform quickly.

#### Acceptance Criteria

1. THE Search_Service SHALL accept a text query and return results across the following entity types in a single response: Partners, Users (friends and public profiles), Communities (PUBLIC only), and Events (PUBLISHED status only).
2. WHEN a User submits a search query, THE Search_Service SHALL return initial results within 1 second.
3. THE Search_Service SHALL support filtering search results by entity type, city, date range (for Events), and service type (for Partners).
4. WHEN a User enables location filtering, THE Search_Service SHALL sort Partner results by proximity to the User's current GPS coordinates using the Location_Service.
5. THE Search_Service SHALL not return profiles or communities that the searching User has blocked, nor entities belonging to Users who have blocked the searcher.
6. THE Search_Service SHALL support autocomplete suggestions after 2 or more characters are typed, with suggestions appearing within 500 milliseconds.
7. THE App SHALL display a "No results found" empty state with suggested alternative queries when a search returns zero results.
8. FOR ALL search queries, applying the same query twice in sequence SHALL return results containing the same set of entity IDs (idempotent search property).

---

### Requirement 14: Admin Panel - Dashboard and User Management

**User Story:** As an Admin, I want a live operational dashboard and full user management controls, so that I can oversee and maintain the platform effectively.

#### Acceptance Criteria

1. THE Admin_Panel SHALL display a live dashboard including: total Users, total Partners, total active bookings, total revenue today, total revenue this month, KYC queue count, pending withdrawal count, open SOS incidents, and recent error rates.
2. THE Admin_Panel SHALL refresh dashboard metrics at a maximum interval of 60 seconds without requiring a manual page reload.
3. WHEN an Admin searches for a User by name, email, or phone, THE Admin_Panel SHALL return matching results within 2 seconds.
4. WHEN an Admin updates a User's status (ACTIVE, SUSPENDED, BANNED), THE Admin_Panel SHALL update the User record, log the action in AuditLog, and if the new status is SUSPENDED or BANNED, invalidate all active sessions for that User.
5. THE Admin_Panel SHALL display a User's full profile including KYC status, TrustScore, wallet balance, booking history count, report count, and account creation date.
6. THE Admin_Panel SHALL allow an Admin to add an internal note to any User record, visible only to Admin and Super Admin roles.
7. THE Admin_Panel SHALL provide a KYC review queue sorted by submission date (oldest first) with actions: Approve and Reject (with mandatory rejection reason).
8. THE Admin_Panel SHALL provide a Withdrawal approval queue sorted by request date (oldest first) with actions: Approve and Reject (with mandatory rejection reason).
9. THE Admin_Panel SHALL allow an Admin to manage Bookings: view detail, cancel a booking with reason, and initiate a manual refund for a completed refund-eligible booking.
10. THE Admin_Panel SHALL enforce role-based access control (RBAC) so that only Admins with the CONTENT_MANAGEMENT permission can create or publish banners and broadcast campaigns.

---

### Requirement 15: Super Admin Panel

**User Story:** As the Super Admin, I want full platform control including admin account management, feature flags, global analytics, and system maintenance tools, so that I can govern the entire platform.

#### Acceptance Criteria

1. THE Admin_Panel SHALL restrict Super Admin capabilities to Users with the SUPER_ADMIN role, enforced on both the API and UI layers.
2. WHEN a Super Admin creates a new Admin account, THE Admin_Panel SHALL assign a role from the AdminRole list, send an invitation email to the new Admin's email address, and log the creation in AuditLog.
3. WHEN a Super Admin deletes an Admin account, THE Admin_Panel SHALL revoke all active AdminSessions for that Admin and reassign any pending work items to the Super Admin's queue.
4. THE Admin_Panel SHALL allow a Super Admin to toggle feature flags per platform (Android, iOS, Web) with an optional rollout percentage and target role filter.
5. THE Admin_Panel SHALL display global analytics exportable to PDF, Excel, and CSV formats for the following dimensions: daily/weekly/monthly/yearly revenue, user growth, partner growth, bookings, refunds, withdrawals, KYC submissions, complaints, events, and communities.
6. THE Admin_Panel SHALL allow a Super Admin to configure Razorpay API credentials and test connectivity without affecting production traffic.
7. THE Admin_Panel SHALL allow a Super Admin to enable or disable maintenance mode; WHILE maintenance mode is ACTIVE, THE App SHALL display a maintenance screen and block all API endpoints except the health-check endpoint.
8. THE Admin_Panel SHALL display a full AuditLog with filtering by actorType, action, entityType, and date range, with pagination of 50 records per page.
9. THE Admin_Panel SHALL support manual database backup creation, with BackupRecord stored including filename, size, type, and creation timestamp.
10. THE Admin_Panel SHALL allow a Super Admin to add values to the platform's blocklist (IP address, phone number, email domain) with an optional expiry date.
11. FOR ALL Super Admin permission checks, a User with SUPER_ADMIN role attempting to access any Admin_Panel endpoint SHALL be granted access (completeness of super-admin access property).

---

### Requirement 16: AI Features

**User Story:** As a User or Partner, I want AI-powered recommendations and safety features, so that I get more relevant matches, better routes, and automatic protection from fraud and fake profiles.

#### Acceptance Criteria

1. WHEN a User opens the Home Dashboard or Search screen, THE AI_Service SHALL suggest up to 5 Partners ranked by a composite score based on proximity, rating, service type match, and booking history compatibility.
2. WHEN a User accesses the friend discovery screen, THE AI_Service SHALL suggest up to 10 Users ranked by mutual connections, shared communities, shared events, and city.
3. WHEN a Booking_Status is IN_PROGRESS, THE AI_Service SHALL provide an optimized route between booking start and end location using the Location_Service, considering real-time traffic data.
4. WHEN a new User account is created, THE AI_Service SHALL evaluate the account's profile completeness, phone verification status, and device fingerprint to compute an initial fraud risk score.
5. IF THE AI_Service determines a fraud risk score exceeds the configured threshold, THEN THE Auth_Service SHALL flag the account for Admin review and limit the account to read-only actions until reviewed.
6. THE AI_Service SHALL analyze incoming chat messages for spam patterns and IF a spam pattern is detected, THEN THE Chat_Service SHALL suppress the message and increment the sender's spam score.
7. IF a User's spam score exceeds the configured threshold, THEN THE Admin_Panel SHALL surface the User's account in the AI Control Center flagged queue.
8. THE AI_Service SHALL compare uploaded selfie images against existing profile photos to detect potential fake or duplicate profile submissions during KYC review.
9. THE AI_Service SHALL power an in-app customer support chatbot capable of answering the top 50 most common User questions defined in the Knowledge Base.
10. THE Admin_Panel shall display an AI Control Center showing fraud detection alerts, spam detection statistics, fake profile flags, and chatbot session metrics.

---

### Requirement 17: Multi-Language Support

**User Story:** As a User who speaks a regional language, I want the App to be available in my preferred language, so that I can use the platform comfortably.

#### Acceptance Criteria

1. THE App SHALL support the following languages: English, Tamil, Hindi, Telugu, Kannada, and Malayalam.
2. WHEN the App is launched for the first time, THE App SHALL detect the device's system language and set the App's display language to the closest supported language, defaulting to English if no match is found.
3. WHEN a User changes the display language in Settings, THE App SHALL apply the new language to all visible text within 1 second without requiring an app restart.
4. THE App SHALL store the User's selected language preference in Firestore and apply it across all devices where the User is logged in.
5. THE App SHALL provide translated content for all static UI labels, error messages, onboarding text, and notification body text.
6. WHEN a language preference is serialized to JSON and deserialized, THE App SHALL produce the same language code as the original (round-trip property for language settings).

---

### Requirement 18: Offline Mode

**User Story:** As a User with intermittent connectivity, I want to view my key data offline and have changes sync automatically when I reconnect, so that the App remains useful without a constant internet connection.

#### Acceptance Criteria

1. THE App SHALL cache the following data for offline access: booking history (last 20 records), wallet transaction history (last 50 records), saved chat messages (last 200 per conversation), joined communities list, registered events list, and User profile.
2. WHILE the device is offline, THE App SHALL display a persistent "Offline" indicator in the UI header.
3. WHILE the device is offline, THE App SHALL allow read-only access to cached data and SHALL display an informative error if a User attempts a write action (booking, payment, message send).
4. WHEN the device reconnects to the internet, THE App SHALL automatically sync any queued write actions in the order they were queued, within 30 seconds of reconnection.
5. THE App SHALL not display stale cached data without a visible "Last updated" timestamp indicating when the cache was last refreshed.

---

### Requirement 19: Performance and Scalability

**User Story:** As a platform operator, I want the system to perform reliably under high load, so that millions of Users and Partners can use the platform simultaneously without degradation.

#### Acceptance Criteria

1. THE App SHALL reach the Home Dashboard screen within 3 seconds from cold launch on a mid-range Android device (2 GB RAM, Android 10) with a standard 4G connection.
2. THE App SHALL render all list screens (bookings, messages, search results) at 60 FPS during scroll on a mid-range Android device.
3. THE Backend SHALL respond to 95% of authenticated API requests within 500 milliseconds under a load of 1000 concurrent requests.
4. THE Backend SHALL implement response caching for read-heavy endpoints (pricing config, app settings, feature flags) with a cache TTL of 5 minutes.
5. THE Backend SHALL implement lazy loading and pagination with a default page size of 20 records on all list endpoints.
6. THE Backend SHALL implement rate limiting of 100 requests per minute per authenticated User and 20 requests per minute per unauthenticated IP address.
7. THE Backend SHALL implement database indexing on all foreign keys, status fields, and timestamp fields used in query filters.
8. THE Backend SHALL use background job processing for long-running tasks including: broadcast notification sending, payout processing, report generation, and AI model inference.
9. THE Backend SHALL support horizontal scaling by maintaining stateless API servers with all session state stored in Firestore.
10. THE Backend SHALL use CDN delivery for all media assets (profile photos, community covers, event banners, chat images) uploaded to Firebase Storage.

---

### Requirement 20: Security and Access Control

**User Story:** As a platform operator, I want enterprise-grade security controls protecting all User data and financial transactions, so that the platform is trustworthy and resistant to attacks.

#### Acceptance Criteria

1. THE Auth_Service SHALL hash all passwords using bcrypt with a minimum cost factor of 12 before storing in the database.
2. THE Backend SHALL enforce role-based access control (RBAC) on all API endpoints, validating the authenticated User's role against the required permission before processing any request.
3. WHEN an Admin logs in, THE Admin_Panel SHALL require two-factor authentication (TOTP-based) if the Admin's twoFactorEnabled flag is true.
4. THE Backend SHALL validate and sanitize all incoming request parameters against a defined schema before processing, returning error code VALIDATION_ERROR for any invalid input.
5. THE Backend SHALL store all encryption keys and third-party API credentials (Razorpay, FCM, LocationIQ) in environment variables and never hardcode them in source code.
6. THE Backend SHALL log all write operations (create, update, delete) to the AuditLog model with actorId, action, entityType, entityId, and ipAddress.
7. WHEN a suspicious login is detected (new device, new IP country), THE Auth_Service SHALL send a security alert push notification and email to the User.
8. THE Backend SHALL implement HTTPS-only communication for all API endpoints, rejecting HTTP requests.
9. THE Backend SHALL implement SQL/NoSQL injection prevention by using parameterized queries via Prisma ORM and Firestore SDK for all database operations.
10. THE Backend SHALL limit file upload endpoints to defined MIME types and maximum file sizes, rejecting uploads that exceed these limits with error code FILE_TYPE_NOT_ALLOWED or FILE_TOO_LARGE.
11. FOR ALL Admin actions on sensitive data (approve KYC, approve withdrawal, ban User), THE AuditLog SHALL contain a record with the Admin's userId, the action name, the target entityId, and a timestamp (audit completeness invariant).

---

### Requirement 21: Design System and Accessibility

**User Story:** As a User, I want a beautiful, accessible, and consistent UI/UX across all screens, so that the App feels premium and easy to use.

#### Acceptance Criteria

1. THE App SHALL implement Material Design 3 guidelines combined with Glassmorphism visual style (frosted glass cards, soft shadows, rounded corners with a minimum 12px radius).
2. THE App SHALL support both light and dark themes with system-level theme detection as the default, and a manual override in Settings.
3. THE App SHALL render smooth transitions and animations at 60 FPS using React Native Reanimated or equivalent.
4. THE App SHALL display skeleton loading placeholders (not spinner overlays) while fetching data on all list and detail screens.
5. THE App SHALL display meaningful empty state screens with an illustration, title, and action button when a list has no data.
6. THE App SHALL meet WCAG 2.1 Level AA colour contrast requirements (minimum 4.5:1 for normal text, 3:1 for large text) for all theme combinations.
7. THE App SHALL support dynamic font size scaling based on the device's accessibility font size setting.
8. THE App SHALL include accessible labels (accessibilityLabel) on all interactive elements (buttons, inputs, cards) for screen-reader compatibility.
9. THE App SHALL use professional, consistent typography with a maximum of 2 typeface families across the entire application.
10. WHERE the platform is accessed on a tablet or large screen (width > 768px), THE App SHALL adapt the layout to a two-column or multi-panel responsive design.

---

### Requirement 22: Tech Stack Migration

**User Story:** As a platform engineer, I want the backend migrated from SQLite/Clerk to PostgreSQL/Firebase Auth with clean architecture, so that the platform can scale reliably to millions of users.

#### Acceptance Criteria

1. THE Backend SHALL migrate the primary database from SQLite to PostgreSQL, with all existing Prisma schema models translated to PostgreSQL-compatible definitions.
2. THE Backend SHALL replace Clerk authentication with Firebase Authentication for identity management, OTP verification, and session token issuance.
3. THE Backend SHALL use Firebase Firestore for real-time data (active bookings, chat messages, Partner locations, typing indicators, notifications) and PostgreSQL via Prisma for transactional data (users, wallets, transactions, KYC, earnings).
4. THE Backend SHALL use Firebase Storage for all user-generated media uploads, replacing the local file system Multer storage.
5. THE Backend SHALL use Firebase Cloud Messaging (FCM) for all push notifications, replacing any legacy notification implementation.
6. THE Backend SHALL implement the Repository Pattern with a clear separation between domain entities, repository interfaces, and infrastructure implementations.
7. THE Backend SHALL be organized into feature-based modules (auth, users, kyc, bookings, partners, wallet, chat, communities, events, notifications, admin, search, rewards, safety, ai) with no circular dependencies between modules.
8. THE Backend SHALL implement dependency injection for all service and repository dependencies to facilitate testability and modularity.
9. THE Backend SHALL use LocationIQ API for all geocoding, reverse geocoding, and routing operations.
10. THE Backend SHALL maintain backward-compatible API response format: `{"success": true/false, "data": {}, "message": "", "code": ""}` across all endpoints.
11. FOR ALL data models, serializing a model to JSON and deserializing back SHALL produce a model object equal to the original (round-trip property for all domain models).

---

### Requirement 23: Reporting and Exports

**User Story:** As an Admin or Super Admin, I want to export platform analytics and operational data to PDF, Excel, and CSV, so that I can share reports with stakeholders and track business performance.

#### Acceptance Criteria

1. THE Admin_Panel SHALL support export of the following report types: Daily Revenue Summary, Weekly Revenue Summary, Monthly Revenue Summary, Yearly Revenue Summary, User Growth Report, Partner Growth Report, Bookings Report, Refunds Report, Withdrawals Report, KYC Submissions Report, Complaints Report, Events Report, and Communities Report.
2. WHEN an Admin triggers a report export, THE Admin_Panel SHALL generate the report file in the requested format (PDF, Excel, or CSV) and make it available for download within 60 seconds for reports covering up to 90 days of data.
3. THE Admin_Panel SHALL allow date-range filtering for all report types.
4. THE Admin_Panel SHALL allow report downloads only to authenticated Admin users with the REPORTS_VIEW permission.
5. IF a report export request covers more than 90 days of data, THEN THE Backend SHALL process the export as a background job and notify the Admin via Notification_Service when the file is ready.
6. FOR ALL CSV exports, parsing the exported CSV and re-exporting SHALL produce a file with the same number of data rows (idempotent export property).

---

### Requirement 24: Partner Dashboard

**User Story:** As a Partner, I want a dedicated dashboard showing my earnings, performance metrics, and job history, so that I can track my progress and optimize my work.

#### Acceptance Criteria

1. THE App SHALL display a Partner Dashboard screen accessible only to Users with an APPROVED Partner profile.
2. THE App SHALL show on the Partner Dashboard: today's earnings, weekly earnings, monthly earnings, lifetime earnings, pending earnings, withdrawable balance, completed jobs count, cancelled jobs count, average rating, current partner level, points toward next level, and acceptance rate.
3. WHEN a Partner views the earnings chart, THE App SHALL display a bar chart of daily earnings for the past 7 days by default, with options to switch to 30-day and 90-day views.
4. THE App SHALL display the Partner's job history with filtering by Booking_Status and date range.
5. WHEN a new job request arrives, THE App SHALL display a full-screen job request card showing: service type, pickup location, destination, distance, estimated fare, and 90-second countdown timer, overlaid above any other screen.
6. THE App SHALL display the Partner's performance badges and current level with a progress bar showing points needed for the next level.
7. THE App SHALL allow a Partner to manage their bank account and UPI details for withdrawals from the Partner Dashboard.
8. THE App SHALL display a tax summary section showing total earnings for the current financial year and estimated tax liability.

---

### Requirement 25: User Profile and Social Features

**User Story:** As a User, I want a rich profile page with social features including friends, trust score, and account settings, so that I can build my reputation and connect with others.

#### Acceptance Criteria

1. THE App SHALL display a User's public profile including: profile photo, display name, city, bio, TrustScore, mutual friends count, communities count, events attended count, and joined date.
2. WHEN a User sends a friend request, THE App SHALL create a Friendship record in PENDING status and notify the recipient via Notification_Service.
3. WHEN a recipient accepts a friend request, THE App SHALL transition the Friendship status to ACCEPTED and notify the requester.
4. THE App SHALL allow a User to view their full friends list with search capability.
5. WHEN a User blocks another User, THE App SHALL create a UserBlock record, remove any existing Friendship record, and prevent the blocked User from viewing the blocker's profile or sending any requests.
6. THE App SHALL display the User's login history (device, IP country, timestamp) for the last 10 login events on the Security Settings screen.
7. THE App SHALL allow a User to terminate any individual active session from the Device Management screen.
8. THE App SHALL allow a User to deactivate their account, which transitions the User status to DEACTIVATED and prevents login while preserving all data.
9. THE App SHALL allow a User to update their profile photo by uploading a new image (JPEG/PNG, max 5 MB) to Firebase Storage.
10. FOR ALL TrustScore computations, applying the same set of input factors (ratings, KYC status, report count) SHALL produce the same TrustScore (deterministic computation property).
