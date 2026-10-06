// Shape of the backend's feed post as returned by /api/posts endpoints.

export interface FeedAuthor {
  id: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface FeedPost {
  id: string;
  authorId: string;
  type: string; // TEXT | PHOTO | VIDEO | QUESTION
  content?: string | null;
  imageUrl?: string | null;
  videoUrl?: string | null;
  visibility: string; // PUBLIC | FOLLOWERS | PRIVATE
  status?: string;
  locationArea?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: FeedAuthor;
  _count?: { likes: number; comments: number; gifts: number };
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
  author?: FeedAuthor;
  _count?: { replies: number };
  isMine?: boolean;
}

export interface GiftRecord {
  id: string;
  postId: string;
  senderId: string;
  recipientId: string;
  amount: string | { toString(): string };
  currency: string;
  createdAt: string;
  sender?: FeedAuthor;
}