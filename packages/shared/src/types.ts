// API response shapes. IDs are 64-bit integers serialised as strings.

export type KycLevel = 0 | 1 | 2;

export interface UserSummary {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  kycLevel: KycLevel;
  isProtected: boolean;
  /** Business / creator (paid, active subscription) or public figure / government / news (granted). */
  badge: import("./business").Badge | null;
  /** The verified business this person works for, shown as a small logo next to their name. */
  affiliation: { id: string; handle: string; displayName: string; avatarUrl: string | null } | null;
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
  /** "post" (the X-style timeline post) or "note" (a Discover note: photo/video-first with a title). */
  kind: "post" | "note";
  title: string | null;
  place: PlaceSummary | null;
  /** Verified review: every account is ID-checked, so every review is from a verified person. */
  review: { rating: number; visitedOn: string | null } | null;
  /** Community Note rated helpful by people with different viewpoints ("Readers added context"). */
  note: { id: string; text: string; sources: string[] } | null;
  /** Business or creator promotion, labelled "Paid partnership" (ASCI influencer guidelines). */
  paidPartnership: boolean;
  /** Detected language (BCP-47), or null if unknown. Drives the "Translate post" button. */
  lang: string | null;
  /** Media is behind a sensitive-content interstitial (moderator label). */
  sensitive?: boolean;
  unavailable?: "deleted" | "removed" | "suspended" | "protected" | "blocked";
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

export type ModerationActionType =
  | "remove_post"
  | "restore_post"
  | "label_sensitive"
  | "unlabel_sensitive"
  | "limit_reach"
  | "unlimit_reach"
  | "warn"
  | "suspend"
  | "unsuspend"
  | "freeze"
  | "unfreeze"
  | "ban"
  | "unban";

/** A statement of reasons sent to a user about a moderation decision (UK OSA / EU DSA Art. 17 style). */
export interface ModerationNotice {
  id: string;
  actionId: string;
  action: ModerationActionType;
  reasonCode: string;
  statement: string;
  /** Excerpt of the affected post, when the decision was about a post. */
  postExcerpt: string | null;
  postId: string | null;
  expiresAt: string | null;
  createdAt: string;
  read: boolean;
  appeal: { status: "open" | "upheld" | "overturned"; decisionNote: string | null } | null;
  canAppeal: boolean;
}

export interface AccountStanding {
  status: "active" | "suspended" | "frozen";
  /** Private trust score: visible only to the account holder (and staff). */
  trust: { score: number; band: "Excellent" | "Good" | "Fair" | "Limited"; factors: { key: string; label: string; points: number }[] };
  suspendedUntil: string | null;
  strikes: number;
  notices: ModerationNotice[];
  unread: number;
}

export interface PostTranslation {
  postId: string;
  text: string;
  sourceLang: string | null;
  targetLang: string;
  /** The post was already in the target language: `text` is the original. */
  sameLanguage: boolean;
  provider: string;
}

export interface TranslationConfig {
  enabled: boolean;
  provider: string;
  languages: string[];
}

export interface Country {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
}

/** "About this account": where the account really is, ranked by how hard each signal is to fake. */
export interface AccountAbout {
  userId: string;
  handle: string;
  joinedAt: string;
  /** Country of the identity document verified at KYC. Cannot be changed with a VPN. */
  identity: { verified: boolean; country: Country | null; verifiedAt: string | null };
  /** Country code of the OTP-verified phone number. */
  phoneCountry: Country | null;
  /**
   * Majority connection country over 30 days, ignoring VPNs, proxies, Tor and hosting providers.
   * "insufficient": too few usable connections (including accounts that mostly use a VPN).
   * "varies": no single country dominates. "unavailable": not measured on this server.
   */
  connection: { status: "ok" | "insufficient" | "varies" | "unavailable"; country: Country | null; changesLastYear: number };
  handleChanges: { from: string; to: string; at: string }[];
  /** No upheld rule violations in the last 12 months (only shown when true). */
  cleanRecord: boolean;
}

export interface VerificationApplication {
  id: string;
  kind: "business" | "creator";
  status: "pending" | "approved" | "rejected" | "withdrawn";
  legalName: string | null;
  regType: string | null;
  regNumber: string | null;
  category: string | null;
  reviewNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Affiliation {
  org: UserSummary;
  member: UserSummary;
  title: string;
  status: "pending" | "active";
}

export interface VerificationStatus {
  kycLevel: number;
  badge: import("./business").Badge | null;
  subscription: { plan: "business" | "creator"; status: string; currentPeriodEnd: string } | null;
  applications: VerificationApplication[];
  /** Invitations to join a business, and the current affiliation. */
  affiliations: Affiliation[];
  /** For business accounts: the people affiliated with it. */
  affiliates: Affiliation[];
}

export interface CommunityNote {
  id: string;
  postId: string;
  classification: "misleading" | "not_misleading";
  text: string;
  sources: string[];
  status: "needs_ratings" | "helpful" | "not_helpful";
  ratingCount: number;
  createdAt: string;
  /** The viewer's own rating, if any. */
  myRating: "yes" | "somewhat" | "no" | null;
  isMine: boolean;
}

export interface NotesForPost {
  notes: CommunityNote[];
  canWrite: boolean;
  canRate: boolean;
  /** Why the viewer can't contribute yet, if they can't. */
  eligibility: string | null;
}

export interface PlaceSummary {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export interface Place extends PlaceSummary {
  category: string;
  address: string;
  country: string | null;
  reviewCount: number;
  /** Average of verified review ratings, or null with no reviews. */
  rating: number | null;
  noteCount: number;
  /** Metres from the point the client asked about (nearby search only). */
  distanceM?: number;
}

export interface Collection {
  id: string;
  name: string;
  isPrivate: boolean;
  itemCount: number;
  /** Up to four cover thumbnails. */
  covers: string[];
  updatedAt: string;
}
