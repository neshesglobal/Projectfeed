// Brand media slots. The app runs without any of these: each slot falls back to motion drawn in code (Aurora).
//
// WELCOME_VIDEO: a short ambient clip behind the welcome screen.
//   Brief for the clip (e.g. generated with Higgsfield): 8–10 s, seamless loop, no text, no faces, slow camera,
//   deep navy and blue light (tanker lights at dusk, a port at night, light moving over metal), 1080×1920 portrait,
//   H.264 MP4 under 4 MB, silent. Save it as apps/mobile/assets/motion/welcome.mp4 and set:
//     export const WELCOME_VIDEO: number | null = require("../../assets/motion/welcome.mp4");
// The screen darkens the video so text stays readable, and shows the still Aurora instead when Reduce Motion is on.
export const WELCOME_VIDEO: number | null = null;
