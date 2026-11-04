import type { LatLng } from "./maps";

/** Post search filters (the Filters panel). Defaults mean "no filter". */
export interface SearchFilters {
  from: "anyone" | "following";
  since: "all" | "day" | "week" | "month";
  /** Language code from LANGUAGES, or null for any. */
  lang: string | null;
  activity: SearchActivity;
  /** Only posts tagged with a place within NEAR_RADIUS_KM of this point. */
  near: LatLng | null;
  excludeReplies: boolean;
  /** Muted accounts are hidden unless switched off. Blocked accounts are always hidden. */
  hideMuted: boolean;
}

export type SearchActivity = "any" | "likes10" | "likes100" | "likes1000" | "replies10" | "reposts10";

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  from: "anyone",
  since: "all",
  lang: null,
  activity: "any",
  near: null,
  excludeReplies: false,
  hideMuted: true,
};

export const NEAR_RADIUS_KM = 50;

export const SEARCH_SINCE: { key: SearchFilters["since"]; label: string; hours: number | null }[] = [
  { key: "all", label: "All time", hours: null },
  { key: "day", label: "Past 24 hours", hours: 24 },
  { key: "week", label: "Past week", hours: 24 * 7 },
  { key: "month", label: "Past month", hours: 24 * 30 },
];

export const SEARCH_ACTIVITY: { key: SearchActivity; label: string; param?: "minLikes" | "minReplies" | "minReposts"; min?: number }[] = [
  { key: "any", label: "Any" },
  { key: "likes10", label: "At least 10 likes", param: "minLikes", min: 10 },
  { key: "likes100", label: "At least 100 likes", param: "minLikes", min: 100 },
  { key: "likes1000", label: "At least 1,000 likes", param: "minLikes", min: 1000 },
  { key: "replies10", label: "At least 10 replies", param: "minReplies", min: 10 },
  { key: "reposts10", label: "At least 10 reposts", param: "minReposts", min: 10 },
];

/** Query-string parameters for /search/posts; defaults are left out. */
export function searchFilterParams(f: SearchFilters): Record<string, string | undefined> {
  const a = SEARCH_ACTIVITY.find((x) => x.key === f.activity);
  return {
    from: f.from === "following" ? "following" : undefined,
    since: f.since === "all" ? undefined : f.since,
    lang: f.lang ?? undefined,
    ...(a?.param ? { [a.param]: String(a.min) } : {}),
    near: f.near ? `${f.near.lat.toFixed(3)},${f.near.lng.toFixed(3)}` : undefined,
    replies: f.excludeReplies ? "exclude" : undefined,
    muted: f.hideMuted ? undefined : "show",
  };
}

/** How many filters differ from the defaults (for the badge on the Filters button). */
export function activeFilterCount(f: SearchFilters): number {
  const d = DEFAULT_SEARCH_FILTERS;
  return (
    Number(f.from !== d.from) +
    Number(f.since !== d.since) +
    Number(f.lang !== d.lang) +
    Number(f.activity !== d.activity) +
    Number(f.near !== null) +
    Number(f.excludeReplies !== d.excludeReplies) +
    Number(f.hideMuted !== d.hideMuted)
  );
}
