// Server contract for the global social feed (/api/posts).

export interface PostAuthor {
  id: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface PostCounts {
  likes: number;
  comments: number;
  gifts: number;
}

export type PostVisibility = "PUBLIC" | "FOLLOWERS" | "PRIVATE";

export interface FeedPost {
  id: string;
  authorId: string;
  type: string; // TEXT | PHOTO | VIDEO | QUESTION
  content?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  visibility: string;
  status?: string;
  locationArea?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: PostAuthor | null;
  _count?: PostCounts;
  likedByMe?: boolean;
  savedByMe?: boolean;
  giftTotal?: number;
}

export interface FeedComment {
  id: string;
  postId: string;
  authorId: string;
  parentId: string | null;
  content: string;
  status: string;
  createdAt: string;
  author?: PostAuthor | null;
  _count?: { replies: number };
  isMine?: boolean;
}

export interface GiftRecord {
  id: string;
  postId: string;
  senderId: string;
  recipientId: string;
  amount: string | number;
  currency: string;
  createdAt: string;
  sender?: PostAuthor | null;
}

export interface FeedPageData {
  items: FeedPost[];
  page: number;
  limit: number;
  total: number;
}

export interface CommentsPageData {
  items: FeedComment[];
  page: number;
  limit: number;
  total: number;
}

export interface LikeToggleData {
  liked: boolean;
  likeCount: number;
}

export interface SaveToggleData {
  saved: boolean;
  saveCount: number;
}

export interface PublicFlagRow {
  key: string;
  isEnabled: boolean;
  rolloutPercentage: number;
}