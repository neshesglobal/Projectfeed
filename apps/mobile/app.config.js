// Adds the Google Maps SDK key for Android at build time, from the environment, so it never sits in git.
// iOS uses Apple Maps (MapKit), which needs no key. The Maps SDK for Android is free for map display;
// directions open in the phone's own Maps app, so no paid Places or Directions API is used.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ["react-native-maps", process.env.GOOGLE_MAPS_ANDROID_KEY ? { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY } : {}],
  ],
});
