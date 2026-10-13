import { create } from "zustand";
import { REGIONS, REGION_LABEL, type Region, type ReplyAudience } from "@projectfeed/shared";

/** "Who can reply" for the post being composed, shared between the composer and the reply-settings sheet. */
interface ReplySettings {
  audience: ReplyAudience;
  regions: Region[];
  setAudience: (a: ReplyAudience) => void;
  setRegions: (r: Region[]) => void;
  reset: () => void;
}

export const useReplySettings = create<ReplySettings>((set) => ({
  audience: "everyone",
  regions: [...REGIONS],
  setAudience: (audience) => set({ audience }),
  setRegions: (regions) => set({ regions }),
  reset: () => set({ audience: "everyone", regions: [...REGIONS] }),
}));

export const AUDIENCE_OPTIONS: { key: ReplyAudience; label: string; short: string; icon: string }[] = [
  { key: "everyone", label: "Everyone", short: "Everyone can reply", icon: "earth" },
  { key: "following", label: "Accounts you follow", short: "Accounts you follow can reply", icon: "person-add" },
  { key: "following_network", label: "Accounts you follow and who they follow", short: "Your follows and their follows can reply", icon: "people" },
  { key: "mentioned", label: "Only accounts you mention", short: "Only accounts you mention can reply", icon: "at" },
];

/** The API value: null when every region is allowed. */
export const regionsPayload = (regions: Region[]) => (regions.length >= REGIONS.length ? null : regions);

export function regionsSummary(regions: Region[]): string {
  if (regions.length >= REGIONS.length) return "All regions";
  if (regions.length === 1) return REGION_LABEL[regions[0]!];
  if (regions.length === 2) return `${REGION_LABEL[regions[0]!]} and ${REGION_LABEL[regions[1]!]}`;
  return `${regions.length} regions`;
}

export function replyLabel(audience: ReplyAudience, regions: Region[]): string {
  const base = AUDIENCE_OPTIONS.find((o) => o.key === audience)!.short;
  return regions.length >= REGIONS.length ? base : `${base} · ${regionsSummary(regions)}`;
}
