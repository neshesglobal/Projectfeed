import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useIsFocused } from "expo-router";
import { Platform } from "react-native";
import type {
  Collection,
  CommunityNote,
  Place,
  NotesForPost,
  VerificationStatus,
  AccountAbout,
  PostTranslation,
  TranslationConfig,
  AccountStanding,
  Conversation,
  FeedItem,
  Media,
  Message,
  NotificationItem,
  Page,
  Post,
  Trend,
  UserList,
  UserProfile,
  UserSummary,
} from "@projectfeed/shared";
import { useAuth } from "../store/auth";
import { api } from "./client";
import { removePostEverywhere, updatePostEverywhere } from "./cache";

const tap = () => {
  if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export function qs(params: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

/** Generic cursor-paged query used by every list screen. */
export function usePaged<T>(key: readonly unknown[], path: string, params: Record<string, string | undefined> = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<Page<T> & Record<string, unknown>>(`${path}${qs({ ...params, cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// ───────────── Feeds ─────────────
export const useForYou = () => usePaged<FeedItem>(["feed", "for-you"], "/feed/for-you");
export const useFollowing = () => usePaged<FeedItem>(["feed", "following"], "/feed/following");
export const useListTimeline = (id: string) => usePaged<FeedItem>(["listTimeline", id], `/lists/${id}/timeline`);
export const useBookmarks = () => usePaged<FeedItem>(["bookmarks"], "/me/bookmarks");
export const useUserPosts = (userId: string | undefined, tab: string) =>
  usePaged<FeedItem>(["userPosts", userId, tab], `/users/${userId}/posts`, { tab }, !!userId);

// ───────────── Posts ─────────────
export function useThread(id: string) {
  return useQuery({
    queryKey: ["thread", id],
    queryFn: () => api<{ ancestors: Post[]; post: Post; replies: Page<Post> }>(`/posts/${id}/thread`),
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      text: string;
      replyToId?: string;
      quoteOfId?: string;
      mediaIds?: string[];
      replyAudience?: string;
      replyRegions?: string[] | null;
      poll?: { options: string[]; durationMinutes: number };
      paidPartnership?: boolean;
    }) => api<Post>("/posts", { method: "POST", body: input }),
    onSuccess: (post) => {
      void qc.invalidateQueries({ queryKey: ["feed", "following"] });
      void qc.invalidateQueries({ queryKey: ["userPosts", post.author.id] });
      if (post.replyTo) void qc.invalidateQueries({ queryKey: ["thread"] });
    },
  });
}

export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Post) => api(`/posts/${p.id}/like`, { method: p.viewer.liked ? "DELETE" : "POST" }),
    onMutate: (p) => {
      tap();
      return updatePostEverywhere(qc, p.id, (x) => ({
        ...x,
        viewer: { ...x.viewer, liked: !p.viewer.liked },
        counts: { ...x.counts, likes: Math.max(0, x.counts.likes + (p.viewer.liked ? -1 : 1)) },
      }));
    },
    onError: (_e, _p, rollback) => rollback?.(),
  });
}

export function useToggleRepost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Post) => api(`/posts/${p.id}/repost`, { method: p.viewer.reposted ? "DELETE" : "POST" }),
    onMutate: (p) => {
      tap();
      return updatePostEverywhere(qc, p.id, (x) => ({
        ...x,
        viewer: { ...x.viewer, reposted: !p.viewer.reposted },
        counts: { ...x.counts, reposts: Math.max(0, x.counts.reposts + (p.viewer.reposted ? -1 : 1)) },
      }));
    },
    onError: (_e, _p, rollback) => rollback?.(),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["feed", "following"] }),
  });
}

export function useToggleBookmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Post) => api(`/posts/${p.id}/bookmark`, { method: p.viewer.bookmarked ? "DELETE" : "POST" }),
    onMutate: (p) => {
      tap();
      return updatePostEverywhere(qc, p.id, (x) => ({
        ...x,
        viewer: { ...x.viewer, bookmarked: !p.viewer.bookmarked },
        counts: { ...x.counts, bookmarks: Math.max(0, x.counts.bookmarks + (p.viewer.bookmarked ? -1 : 1)) },
      }));
    },
    onError: (_e, _p, rollback) => rollback?.(),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["bookmarks"] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Post) => api(`/posts/${p.id}`, { method: "DELETE" }),
    onSuccess: (_r, p) => removePostEverywhere(qc, p.id),
  });
}

export function useVote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ post, optionIndex }: { post: Post; optionIndex: number }) =>
      api<Post>(`/posts/${post.id}/vote`, { method: "POST", body: { optionIndex } }),
    onSuccess: (updated) => void updatePostEverywhere(qc, updated.id, (x) => ({ ...x, poll: updated.poll })),
  });
}

export function useNotInterested() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Post) => api(`/posts/${p.id}/not-interested`, { method: "POST" }),
    onSuccess: (_r, p) => removePostEverywhere(qc, p.id),
  });
}

export async function uploadImage(uri: string, mimeType: string | undefined, altText = ""): Promise<Media> {
  const form = new FormData();
  form.append("altText", altText);
  const type = mimeType ?? "image/jpeg";
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, "upload");
  } else {
    // React Native's FormData accepts a { uri, name, type } descriptor for files.
    form.append("file", { uri, name: `upload.${type.split("/")[1] ?? "jpg"}`, type } as unknown as Blob);
  }
  return api<Media>("/media", { method: "POST", form });
}

// ───────────── Users ─────────────
export function useProfile(handle: string) {
  return useQuery({ queryKey: ["user", handle.toLowerCase()], queryFn: () => api<UserProfile>(`/users/by-handle/${handle}`) });
}

export function useMe() {
  const setUser = useAuth((s) => s.setUser);
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const me = await api<UserProfile>("/me");
      setUser(me);
      return me;
    },
  });
}

function patchProfile(qc: ReturnType<typeof useQueryClient>, userId: string, fn: (u: UserProfile) => UserProfile) {
  for (const q of qc.getQueryCache().findAll({ queryKey: ["user"] })) {
    const u = q.state.data as UserProfile | undefined;
    if (u?.id === userId) qc.setQueryData(q.queryKey, fn(u));
  }
}

export function useFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ user, follow }: { user: UserSummary; follow: boolean }) =>
      api<{ state: "following" | "requested" | "none" }>(`/users/${user.id}/follow`, { method: follow ? "POST" : "DELETE" }),
    onMutate: ({ user, follow }) => {
      tap();
      patchProfile(qc, user.id, (u) => ({
        ...u,
        followersCount: u.followersCount + (follow && !u.isProtected ? 1 : !follow && u.viewer?.following ? -1 : 0),
        viewer: u.viewer && { ...u.viewer, following: follow && !u.isProtected, followRequested: follow && u.isProtected },
      }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["user"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["suggestions"] });
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useRelationshipAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, action, on }: { userId: string; action: "block" | "mute"; on: boolean }) =>
      api(`/users/${userId}/${action}`, { method: on ? "POST" : "DELETE" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["user"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["blocked"] });
      void qc.invalidateQueries({ queryKey: ["muted"] });
    },
  });
}

export const useSuggestions = () =>
  useQuery({ queryKey: ["suggestions"], queryFn: () => api<Page<UserSummary>>("/users/suggestions?limit=10") });

// ───────────── Notifications ─────────────
export const useNotifications = (tab: string) => usePaged<NotificationItem>(["notifications", tab], "/notifications", { tab });

export function useUnreadCounts() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  return useQuery({
    queryKey: ["unread"],
    enabled: signedIn,
    refetchInterval: 30_000,
    queryFn: () => api<{ notifications: number; messages: number }>("/notifications/unread-count"),
  });
}

// ───────────── Search ─────────────
export const useTrends = () => useQuery({ queryKey: ["trends"], queryFn: () => api<{ items: Trend[] }>("/trends") });

export const useSearchPosts = (q: string, mode: string) =>
  usePaged<FeedItem>(["search", "posts", q, mode], "/search/posts", { q, mode }, q.length > 0);

export const useSearchUsers = (q: string) =>
  useQuery({ queryKey: ["search", "users", q], enabled: q.length > 0, queryFn: () => api<Page<UserSummary>>(`/search/users${qs({ q })}`) });

export function useTypeahead(q: string) {
  return useQuery({
    queryKey: ["typeahead", q],
    enabled: q.trim().length > 0,
    staleTime: 30_000,
    queryFn: () =>
      api<{ users: UserSummary[]; tags: { tag: string; kind: string; postCount: number }[] }>(`/search/typeahead${qs({ q })}`),
  });
}

// ───────────── Messages ─────────────
export function useConversations(tab: "inbox" | "requests") {
  // Tabs stay mounted, so poll only while the inbox is actually on screen.
  const focused = useIsFocused();
  return useQuery({
    queryKey: ["conversations", tab],
    refetchInterval: focused ? 15_000 : false,
    queryFn: () => api<Page<Conversation>>(`/conversations${qs({ tab: tab === "requests" ? "requests" : undefined })}`),
  });
}

export const useMessages = (cid: string) => usePaged<Message>(["messages", cid], `/conversations/${cid}/messages`);

// ───────────── Lists ─────────────
export const useMyLists = () => useQuery({ queryKey: ["lists"], queryFn: () => api<Page<UserList>>("/me/lists") });
export const useList = (id: string) => useQuery({ queryKey: ["list", id], queryFn: () => api<UserList>(`/lists/${id}`) });

// ───────────── Account standing & appeals ─────────────
export function useStanding() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  return useQuery({
    queryKey: ["standing"],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: () => api<AccountStanding>("/me/standing"),
  });
}

export function useMarkNoticesRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/me/moderation-notices/read", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["standing"] }),
  });
}

export function useAppeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { actionId: string; text: string }) => api<{ id: string }>("/me/appeals", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["standing"] }),
  });
}

// ───────────── Translation ─────────────
export function useTranslationConfig() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  return useQuery({ queryKey: ["translationConfig"], enabled: signedIn, staleTime: 60 * 60_000, queryFn: () => api<TranslationConfig>("/translation/config") });
}

export function usePostTranslation(post: Pick<Post, "id" | "editCount">, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["translation", post.id, post.editCount, to],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: () => api<PostTranslation>(`/posts/${post.id}/translation${qs({ to })}`),
  });
}

// ───────────── About this account ─────────────
export const useAbout = (userId: string | undefined) =>
  useQuery({ queryKey: ["about", userId], enabled: !!userId, staleTime: 5 * 60_000, queryFn: () => api<AccountAbout>(`/users/${userId}/about`) });

export function useChangeHandle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (handle: string) => api<UserProfile>("/me/handle", { method: "PATCH", body: { handle } }),
    onSuccess: (me) => {
      useAuth.getState().setUser(me);
      void qc.invalidateQueries();
    },
  });
}

// ───────────── Verification & badges ─────────────
export const useVerification = () =>
  useQuery({ queryKey: ["verification"], queryFn: () => api<VerificationStatus>("/me/verification") });

/** Generic POST/DELETE for verification actions, refreshing status and profile data afterwards. */
export function useVerificationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; method?: "POST" | "DELETE"; body?: unknown }) => api(v.path, { method: v.method ?? "POST", body: v.body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["verification"] });
      void qc.invalidateQueries({ queryKey: ["user"] });
    },
  });
}

// ───────────── Community Notes ─────────────
export const usePostNotes = (postId: string) =>
  useQuery({ queryKey: ["notes", postId], queryFn: () => api<NotesForPost>(`/posts/${postId}/notes`) });

export const useNotesQueue = () =>
  useQuery({ queryKey: ["notesQueue"], queryFn: () => api<{ items: { post: Post; note: CommunityNote }[]; eligibility: string | null }>("/notes/needs-ratings") });

export function useNoteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; body: unknown }) => api(v.path, { method: "POST", body: v.body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notes"] });
      void qc.invalidateQueries({ queryKey: ["notesQueue"] });
    },
  });
}

// ───────────── Discover: notes, places, collections ─────────────
export const useDiscover = (topic: string, coords: { lat: number; lng: number } | null) =>
  usePaged<FeedItem>(
    ["discover", topic, coords ? `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}` : null],
    "/feed/discover",
    { topic, lat: coords ? String(coords.lat) : undefined, lng: coords ? String(coords.lng) : undefined },
    topic !== "nearby" || !!coords,
  );

export const useSearchNotes = (q: string) =>
  usePaged<FeedItem>(["search", "notes", q], "/search/notes", { q }, q.length > 0);

export const usePlace = (id: string) => useQuery({ queryKey: ["place", id], enabled: !!id, queryFn: () => api<Place>(`/places/${id}`) });

export const usePlaceNotes = (id: string, reviewsOnly: boolean) =>
  usePaged<FeedItem>(["placeNotes", id, reviewsOnly], `/places/${id}/notes`, { reviews: reviewsOnly ? "1" : undefined });

export const useNearbyPlaces = (coords: { lat: number; lng: number } | null, q: string) =>
  useQuery({
    queryKey: ["places", "nearby", coords?.lat.toFixed(3), coords?.lng.toFixed(3), q],
    enabled: !!coords,
    queryFn: () => api<{ items: Place[] }>(`/places/nearby${qs({ lat: coords!.lat, lng: coords!.lng, q })}`),
  });

export function useCreatePlace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; category: string; lat: number; lng: number; address?: string; city?: string; country?: string }) =>
      api<{ place: Place; existing: boolean }>("/places", { method: "POST", body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["places"] }),
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      text: string;
      mediaIds: string[];
      placeId?: string;
      review?: { rating: number; visitedOn?: string };
      paidPartnership?: boolean;
    }) => api<Post>("/notes", { method: "POST", body: input }),
    onSuccess: (post) => {
      void qc.invalidateQueries({ queryKey: ["discover"] });
      void qc.invalidateQueries({ queryKey: ["userPosts", post.author.id] });
      if (post.place) {
        void qc.invalidateQueries({ queryKey: ["place", post.place.id] });
        void qc.invalidateQueries({ queryKey: ["placeNotes", post.place.id] });
      }
    },
  });
}

export const useMyCollections = (enabled = true) =>
  useQuery({ queryKey: ["collections", "me"], enabled, queryFn: () => api<{ items: Collection[] }>("/me/collections") });

export const useUserCollections = (userId: string | undefined) =>
  useQuery({ queryKey: ["collections", "user", userId], enabled: !!userId, queryFn: () => api<{ items: Collection[] }>(`/users/${userId}/collections`) });

export const useCollection = (id: string) =>
  useInfiniteQuery({
    // Typed as a generic paged result so it can feed NoteGrid; `collection` and `ownerId` ride along on every page.
    queryKey: ["collection", id],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<Page<FeedItem> & Record<string, unknown>>(`/collections/${id}${qs({ cursor: pageParam })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useSavedIn = (postId: string) =>
  useQuery({ queryKey: ["savedIn", postId], queryFn: () => api<{ collectionIds: string[] }>(`/posts/${postId}/saved-in`) });

export function useCollectionAction() {
  const qc = useQueryClient();
  const refresh = (postId?: string) => {
    void qc.invalidateQueries({ queryKey: ["collections"] });
    void qc.invalidateQueries({ queryKey: ["collection"] });
    void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    if (postId) void qc.invalidateQueries({ queryKey: ["savedIn", postId] });
  };
  return useMutation({
    mutationFn: async (
      a:
        | { kind: "create"; name: string; isPrivate: boolean }
        | { kind: "update"; id: string; name?: string; isPrivate?: boolean }
        | { kind: "delete"; id: string }
        | { kind: "add"; id: string; post: Post }
        | { kind: "remove"; id: string; post: Post },
    ) => {
      switch (a.kind) {
        case "create":
          return api<Collection>("/me/collections", { method: "POST", body: { name: a.name, isPrivate: a.isPrivate } });
        case "update":
          return api(`/me/collections/${a.id}`, { method: "PATCH", body: { name: a.name, isPrivate: a.isPrivate } });
        case "delete":
          return api(`/me/collections/${a.id}`, { method: "DELETE" });
        case "add":
          return api(`/me/collections/${a.id}/items`, { method: "POST", body: { postId: a.post.id } });
        case "remove":
          return api(`/me/collections/${a.id}/items/${a.post.id}`, { method: "DELETE" });
      }
    },
    onSuccess: (_r, a) => {
      // Saving into a collection also bookmarks the post.
      if (a.kind === "add" && !a.post.viewer.bookmarked) {
        updatePostEverywhere(qc, a.post.id, (x) => ({ ...x, viewer: { ...x.viewer, bookmarked: true }, counts: { ...x.counts, bookmarks: x.counts.bookmarks + 1 } }));
      }
      refresh(a.kind === "add" || a.kind === "remove" ? a.post.id : undefined);
    },
  });
}

// ───────────── GIFs ─────────────
export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  stillUrl: string;
  width: number;
  height: number;
}

export const useGifConfig = () =>
  useQuery({
    queryKey: ["gifs", "config"],
    staleTime: 60 * 60_000,
    queryFn: () => api<{ enabled: boolean; provider: string | null; attribution: string | null }>("/gifs/config"),
  });

export const useGifs = (q: string) =>
  useInfiniteQuery({
    queryKey: ["gifs", q],
    initialPageParam: "",
    staleTime: 5 * 60_000,
    queryFn: ({ pageParam }) =>
      api<{ items: GifResult[]; next: string | null }>(q ? `/gifs/search${qs({ q, cursor: pageParam })}` : `/gifs/trending${qs({ cursor: pageParam })}`),
    getNextPageParam: (last) => last.next ?? undefined,
  });
