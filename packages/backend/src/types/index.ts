export type Gender = "MALE" | "FEMALE" | "OTHER";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "BANNED" | "DEACTIVATED";
export type VerificationStatus = "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
export type WalkingPartnerStatus = "NONE" | "APPLIED" | "APPROVED" | "REJECTED";
export type TransactionType = "CREDIT" | "DEBIT";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED";
export type WithdrawalStatus = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
export type WalkingRequestStatus = "OPEN" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type ApplicationStatus = "PENDING" | "WITHDRAWN" | "ACCEPTED" | "REJECTED";
export type CommunityPrivacy = "PUBLIC" | "PRIVATE";
export type CommunityRole = "MEMBER" | "MODERATOR" | "ADMIN";
export type EventStatus = "DRAFT" | "PUBLISHED" | "ONGOING" | "COMPLETED" | "CANCELLED";
export type EventAttendeeStatus = "REGISTERED" | "CANCELLED" | "CHECKED_IN";
export type MessageStatus = "SENT" | "DELIVERED" | "READ" | "DELETED";
export type ReportStatus = "PENDING" | "UNDER_REVIEW" | "RESOLVED" | "DISMISSED";
export type ReportType = "USER" | "COMMUNITY" | "EVENT" | "MESSAGE" | "OTHER";
export type SosStatus = "ACTIVE" | "RESOLVED" | "CANCELLED";
export type AdminRole = "ADMIN" | "SUPER_ADMIN";
export type DeviceType = "IOS" | "ANDROID" | "WEB";
export type RatingTarget = "USER" | "PARTNER" | "COMMUNITY" | "EVENT";
export type RatingType = "EXPERIENCE" | "SAFETY" | "RELIABILITY";

export interface User {
  id: string;
  email: string;
  phone: string;
  fullName: string;
  dateOfBirth: Date;
  gender: Gender;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  country?: string | null;
  status: UserStatus;
  emailVerified: boolean;
  mobileVerified: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Verification {
  id: string;
  userId: string;
  selfieUrl?: string | null;
  govIdUrl?: string | null;
  govIdType?: string | null;
  addressProofUrl?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  status: VerificationStatus;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationHistory {
  id: string;
  verificationId: string;
  status: VerificationStatus;
  note?: string | null;
  changedBy?: string | null;
  createdAt: Date;
}

export interface WalkingPartner {
  id: string;
  userId: string;
  status: WalkingPartnerStatus;
  rating: number;
  totalWalks: number;
  totalEarnings: number;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  upiId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  walletId: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  description?: string | null;
  referenceId?: string | null;
  createdAt: Date;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  walletId: string;
  amount: number;
  status: WithdrawalStatus;
  method: string;
  accountDetail?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalkingRequest {
  id: string;
  requesterId: string;
  acceptedById?: string | null;
  status: WalkingRequestStatus;
  startLocation: string;
  endLocation: string;
  startTime: Date;
  durationMinutes?: number | null;
  notes?: string | null;
  fare?: number | null;
  completedById?: string | null;
  completedAt?: Date | null;
  confirmedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalkingRequestApplication {
  id: string;
  requestId: string;
  applicantId: string;
  status: ApplicationStatus;
  message?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Community {
  id: string;
  name: string;
  description?: string | null;
  avatarUrl?: string | null;
  privacy: CommunityPrivacy;
  ownerId: string;
  city?: string | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunityMember {
  id: string;
  communityId: string;
  userId: string;
  role: CommunityRole;
  joinedAt: Date;
}

export interface Event {
  id: string;
  title: string;
  description?: string | null;
  organizerId: string;
  communityId?: string | null;
  location?: string | null;
  startTime: Date;
  endTime?: Date | null;
  capacity?: number | null;
  attendeeCount: number;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventAttendee {
  id: string;
  eventId: string;
  userId: string;
  status: EventAttendeeStatus;
  checkedInAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  conversationId: string;
  content: string;
  status: MessageStatus;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Report {
  id: string;
  reporterId: string;
  targetId: string;
  targetType: ReportType;
  reason: string;
  description?: string | null;
  status: ReportStatus;
  resolvedBy?: string | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Rating {
  id: string;
  raterId: string;
  ratedId: string;
  targetType: RatingTarget;
  ratingType: RatingType;
  score: number;
  comment?: string | null;
  createdAt: Date;
}

export interface SosAlert {
  id: string;
  userId: string;
  latitude?: number | null;
  longitude?: number | null;
  message?: string | null;
  status: SosStatus;
  createdAt: Date;
  resolvedAt?: Date | null;
}

export interface Admin {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  actorType: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: string | null;
  ipAddress?: string | null;
  createdAt: Date;
}

export interface LoginHistory {
  id: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  location?: string | null;
  loggedInAt: Date;
}

export interface Device {
  id: string;
  userId: string;
  deviceType: DeviceType;
  deviceToken?: string | null;
  fcmToken?: string | null;
  name?: string | null;
  lastActiveAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  isRead: boolean;
  data?: string | null;
  createdAt: Date;
}

export interface UserBlock {
  id: string;
  blockerId: string;
  blockedId: string;
  reason?: string | null;
  createdAt: Date;
}

export interface TrustScore {
  id: string;
  userId: string;
  score: number;
  factors?: string | null;
  updatedAt: Date;
}

export interface LocationShare {
  id: string;
  sharerId: string;
  viewerId: string;
  latitude: number;
  longitude: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  code: string;
  rewardClaimed: boolean;
  createdAt: Date;
}

export interface AuthPayload {
  userId: string;
  email: string;
  isAdmin?: boolean;
  adminRole?: AdminRole;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T[]> {
  meta: PaginationMeta;
}

export interface JwtUser {
  userId: string;
  email: string;
}
