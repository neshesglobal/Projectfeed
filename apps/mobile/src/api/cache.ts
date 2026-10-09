import type { QueryClient } from "@tanstack/react-query";
import type { Post } from "@projectfeed/shared";

function isPost(v: unknown): v is Post {
  return typeof v === "object" && v !== null && "counts" in v && "viewer" in v && "author" in v && "id" in v;
}

/** Return a copy of `data` with every embedded copy of the post (feeds, threads, quotes) transformed. */
function deepMapPosts(data: unknown, postId: string, fn: (p: Post) => Post): unknown {
  if (Array.isArray(data)) {
    let changed = false;
    const out = data.map((x) => {
      const y = deepMapPosts(x, postId, fn);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : data;
  }
  if (typeof data !== "object" || data === null) return data;
  let obj = data as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const y = deepMapPosts(v, postId, fn);
    if (y !== v) changed = true;
    next[k] = y;
  }
  if (changed) obj = next;
  if (isPost(obj) && obj.id === postId) return fn(obj);
  return obj;
}

/**
 * Optimistic updates: one like must show everywhere the post is on screen at once,
 * so we patch every cached query rather than tracking which screens hold the post.
 */
export function updatePostEverywhere(qc: QueryClient, postId: string, fn: (p: Post) => Post): () => void {
  const snapshots: [readonly unknown[], unknown][] = [];
  for (const q of qc.getQueryCache().getAll()) {
    const data = q.state.data;
    if (data === undefined) continue;
    const next = deepMapPosts(data, postId, fn);
    if (next !== data) {
      snapshots.push([q.queryKey, data]);
      qc.setQueryData(q.queryKey, next);
    }
  }
  return () => {
    for (const [key, data] of snapshots) qc.setQueryData(key, data);
  };
}

/** Remove a deleted post from every cached list. */
export function removePostEverywhere(qc: QueryClient, postId: string): void {
  const strip = (data: unknown): unknown => {
    if (Array.isArray(data)) {
      return data
        .filter((x) => !(isPost(x) && x.id === postId) && !(typeof x === "object" && x && "post" in x && isPost((x as { post: unknown }).post) && (x as { post: Post }).post.id === postId))
        .map(strip);
    }
    if (typeof data !== "object" || data === null) return data;
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, strip(v)]));
  };
  for (const q of qc.getQueryCache().getAll()) {
    if (q.state.data !== undefined && (q.queryKey[0] === "feed" || q.queryKey[0] === "userPosts" || q.queryKey[0] === "thread" || q.queryKey[0] === "bookmarks" || q.queryKey[0] === "search" || q.queryKey[0] === "listTimeline")) {
      qc.setQueryData(q.queryKey, strip(q.state.data));
    }
  }
}
