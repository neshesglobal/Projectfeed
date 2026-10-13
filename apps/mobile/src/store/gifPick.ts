import { create } from "zustand";
import type { Media } from "@projectfeed/shared";

/** The GIF chosen in the picker, handed back to the composer. */
export const useGifPick = create<{ picked: Media | null; set: (m: Media | null) => void }>((set) => ({
  picked: null,
  set: (picked) => set({ picked }),
}));
