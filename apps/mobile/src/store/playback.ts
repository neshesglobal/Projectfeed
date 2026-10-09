import { create } from "zustand";

/**
 * Global playback coordination: at most one inline video plays at a time (the most visible one),
 * and sound is a single app-wide toggle, as on X.
 */
interface PlaybackState {
  activeKey: string | null;
  muted: boolean;
  setActive: (key: string | null) => void;
  toggleMuted: () => void;
  setMuted: (m: boolean) => void;
}

export const usePlayback = create<PlaybackState>((set) => ({
  activeKey: null,
  muted: true,
  setActive: (activeKey) => set({ activeKey }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  setMuted: (muted) => set({ muted }),
}));

export const videoKey = (surface: string, postId: string) => `${surface}:${postId}`;
