// API response shapes. IDs are 64-bit integers serialised as strings.

export type KycLevel = 0 | 1 | 2;

export interface UserSummary {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  kycLevel: KycLevel;
  isProtected: boolean;
}

export interface ViewerRelationship {
  following: boolean;
  followedBy: boolean;
  followRequested: boolean;
  blocking: boolean;
  blockedBy: boolean;
  muting: boolean;
}

export interface UserProfile extends UserSummary {
  bio: string;
  location: string;
  website: string;
  company: string;
  role: string;
  sectors: string[];
  bannerUrl: string | null;
  createdAt: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  pinnedPostId: string | null;
  viewer: ViewerRelationship | null; // null when viewing own profile
}

export interface Media {
  id: string;
  type: "image" | "video" | "gif";
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  altText: string;
  /** Videos are transcoded asynchronously; only "ready" media can be attached to a post. */
  status: "processing" | "ready" | "failed";
  durationMs: number | null;
  error?: string;
}

export interface Poll {
  options: { label: string; votes: number }[];
  totalVotes: number;
  endsAt: string;
  closed: boolean;
  viewerVote: number | null;
}

export interface PostCounts {
  replies: number;
  reposts: number;
  quotes: number;
  likes: number;
  bookmarks: number;
  views: number;
}

export interface PostViewerState {
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  canReply: boolean;
}

export interface Post {
  id: string;
  author: UserSummary;
  text: string;
  createdAt: string;
  editedAt: string | null;
  editCount: number;
  conversationId: string;
  replyTo: { postId: string; handle: string } | null;
  quote: Post | null; // one level deep only
  media: Media[];
  poll: Poll | null;
  replyAudience: "everyone" | "following" | "mentioned";
  counts: PostCounts;
  viewer: PostViewerState;
  deleted: boolean;
  unavailable?: "deleted" | "protected" | "blocked";
}

export interface FeedItem {
  post: Post;
  repostedBy: UserSummary | null;
  /** Transparency: why this post is in the viewer's feed. */
  reason: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type NotificationType =
  | "like"
  | "repost"
  | "reply"
  | "mention"
  | "quote"
  | "follow"
  | "follow_request"
  | "poll_ended";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  actors: UserSummary[];
  actorCount: number;
  post: Post | null;
  createdAt: string;
  read: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

export interface Conversation {
  id: string;
  title: string | null;
  isGroup: boolean;
  participants: UserSummary[];
  lastMessage: Message | null;
  unreadCount: number;
  isRequest: boolean;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: UserSummary;
  text: string;
  media: Media[];
  sharedPost: Post | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface Trend {
  tag: string;
  kind: "hashtag" | "cashtag";
  postCount: number;
  context: string;
}

export interface UserList {
  id: string;
  name: string;
  description: string;
  isPrivate: boolean;
  owner: UserSummary;
  memberCount: number;
  followerCount: number;
  viewerFollowing: boolean;
  viewerPinned: boolean;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
