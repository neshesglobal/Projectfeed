// Motion tokens. Every animation in the app takes its timing from here, so the app moves with one personality:
// quick and physical for touch feedback, softer for content arriving, and still when the person asks for less motion.
//
// Principles
// 1. Motion explains, it doesn't decorate: things enter from where they come from and leave the way they came.
// 2. Touch answers within a frame (springs, not fixed curves), so the interface feels attached to the finger.
// 3. Content arrives together, with a short stagger that stops after the first screenful.
// 4. Reduce Motion (iOS / Android accessibility setting) turns movement into simple fades or nothing.

import { Easing, FadeIn, FadeInDown, FadeOut, ReduceMotion, SlideInDown, SlideOutDown } from "react-native-reanimated";

/** Springs, as Reanimated spring configs. */
export const spring = {
  /** Touch feedback (press, toggle): settles in ~180 ms without visible bounce. */
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  /** Selection moving between options (tab indicator, segmented controls). */
  snappy: { damping: 20, stiffness: 260, mass: 0.8 },
  /** Celebratory feedback (like, follow, badge): one clear overshoot. */
  bouncy: { damping: 9, stiffness: 300, mass: 0.7 },
  /** Panels and sheets arriving. */
  gentle: { damping: 22, stiffness: 180, mass: 1 },
} as const;

/** Durations in ms, for timing-based animations. */
export const duration = { instant: 120, fast: 180, base: 260, slow: 420, ambient: 9000 } as const;

export const easing = {
  /** Standard: things already on screen moving. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** Entering: decelerate into place. */
  enter: Easing.bezier(0, 0, 0.2, 1),
  /** Leaving: accelerate out of the way. */
  exit: Easing.bezier(0.4, 0, 1, 1),
};

/** Stagger between list items arriving; only the first STAGGER_LIMIT items are staggered. */
export const STAGGER_MS = 45;
export const STAGGER_LIMIT = 8;

/** Content arriving in a list: rise 12 pt and fade, staggered by position. Reduce Motion: no movement. */
export const enterItem = (index = 0) =>
  FadeInDown.duration(duration.base)
    .delay(Math.min(index, STAGGER_LIMIT) * STAGGER_MS)
    .withInitialValues({ transform: [{ translateY: 12 }] })
    .easing(easing.enter)
    .reduceMotion(ReduceMotion.System);

export const fadeIn = (delay = 0) => FadeIn.duration(duration.base).delay(delay).reduceMotion(ReduceMotion.System);
export const fadeOut = () => FadeOut.duration(duration.fast).reduceMotion(ReduceMotion.System);

/** Bottom panels: spring up from below, slide back down when closed. */
export const sheetIn = () => SlideInDown.springify().damping(spring.gentle.damping).stiffness(spring.gentle.stiffness).reduceMotion(ReduceMotion.System);
export const sheetOut = () => SlideOutDown.duration(duration.fast).easing(easing.exit).reduceMotion(ReduceMotion.System);
