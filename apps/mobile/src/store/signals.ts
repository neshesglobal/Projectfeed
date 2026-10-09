import { create } from "zustand";

/** Cross-screen UI signals, e.g. "scroll Home to the top" after the user posts. */
export const useSignals = create<{ homeScrollTop: number; scrollHomeToTop: () => void }>((set) => ({
  homeScrollTop: 0,
  scrollHomeToTop: () => set((s) => ({ homeScrollTop: s.homeScrollTop + 1 })),
}));
