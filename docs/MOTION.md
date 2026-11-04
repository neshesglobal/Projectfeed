# Motion

Motion in Projectfeed explains what changed. It isn't decoration. Every animation takes its timing from `apps/mobile/src/theme/motion.ts`. The reusable pieces live in `apps/mobile/src/components/motion.tsx`. A 33-second screen recording is in `docs/motion-demo.mp4`.

## Principles

1. **Touch answers within a frame.** Presses use springs, not fixed curves, so controls feel attached to the finger.
2. **New things arrive, old things don't dance.** Content fades and rises in when it first appears. A list that re-sorts or scrolls never re-animates.
3. **Celebrate sparingly.** Only actions that mean something to a person get a flourish: like, bookmark, repost, and a new badge count.
4. **Ambient motion is slow.** Brand backdrops drift on a 9-second cycle and banners on a 14-second one. They should be felt, not watched.
5. **Reduce Motion is honoured everywhere.** With the accessibility setting on, movement becomes a simple fade or a still image. This is checked with `useReducedMotion`, and every entering/exiting animation uses `ReduceMotion.System`.

## Tokens

| Token | Use |
| --- | --- |
| `spring.press` | Sinking under the finger and springing back (buttons, chips, cards, icon buttons) |
| `spring.snappy` | Selection moving (tab bar pill, search tab underline, rolling counts) |
| `spring.bouncy` | One clear overshoot (like, bookmark, badge pop, compose button appearing) |
| `spring.gentle` | Panels arriving (Filters panel) |
| `duration.fast / base / slow / ambient` | 180 / 260 / 420 / 9000 ms |
| `enterItem(i)` | Rise 12 pt and fade, staggered 45 ms per item up to 8 items |

## Where it is used

| Surface | Motion |
| --- | --- |
| Welcome, sign-in, sign-up | Drifting radial colour fields (`Aurora`), or a looping brand video if one is configured. Content is revealed in reading order. |
| Home welcome card | Colour fields drift, stars twinkle |
| Feeds (Home, Search, profiles, lists) | Shimmer placeholders shaped like posts, then the list rises in once |
| Post actions | Like: the heart dips, springs and throws six sparks inside an expanding ring. Repost: the arrows turn. Bookmark: drops in. Counts roll up or down. Haptic tap on iPhone and Android. |
| Tab bar | A soft pill slides to the selected tab, the icon pops, and the unread badge bounces when its number changes |
| Compose button | Springs in, sinks under the finger, and its plus turns a quarter |
| Buttons, icon buttons, chips, cards | Press-scale spring. Chips fade between outline and fill. |
| Search | The underline slides between Top, Latest, People, Videos and Photos. The filter count badge pops. The Filters panel springs up over a fading backdrop, and option lists slide in from the right. |
| Hashtag panel | Native iOS/Android sheet: drag between half, most and full screen |
| Toasts, "New posts" pill | Spring down from the top, fade away |
| Empty states | Icon floats, then title, text and action appear in turn |
| Activity, Messages, people lists | Row-shaped shimmer placeholders while loading |
| Profile | Banner slowly pushes in. The avatar springs in. |

## Brand video slot

`apps/mobile/src/theme/media.ts` holds `WELCOME_VIDEO`. Set it to a short looping clip and the welcome, sign-in and sign-up screens play it behind a readability scrim instead of the drawn colour fields. With Reduce Motion on, they fall back to the still version. The brief for the clip (for Higgsfield or similar) is in that file.

## Rules for adding motion

- Take timing from `theme/motion.ts`; don't invent a new curve.
- Never use enter animations on rows of a FlashList. It recycles row views, so per-row enter animations misfire when rows are reused or re-sorted. We hit this and fixed it: rows showed stale content after a re-rank. Animate the list as a whole instead.
- Every new animation must have a Reduce Motion path.
