import { create } from "zustand";
import type { PlaceSummary } from "@projectfeed/shared";

/** The place chosen in the location picker, handed back to the note composer. */
export const useNotePlace = create<{ place: PlaceSummary | null; setPlace: (p: PlaceSummary | null) => void }>((set) => ({
  place: null,
  setPlace: (place) => set({ place }),
}));
