import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { WELCOME_VIDEO } from "../theme/media";
import { useTheme } from "../theme";
import { Aurora } from "./motion";

/**
 * The backdrop for brand moments (welcome, sign-in): a looping ambient video when one is configured
 * (theme/media.ts), otherwise drifting colour fields. A gradient scrim keeps text readable over either.
 */
export function BrandBackdrop() {
  const t = useTheme();
  const reduce = useReducedMotion();
  const dark = t.mode === "dark";
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {WELCOME_VIDEO !== null && !reduce ? (
        <AmbientVideo source={WELCOME_VIDEO} />
      ) : (
        <Aurora colors={dark ? ["#1D4ED8", "#0E7490", "#312E81"] : ["#60A5FA", "#22D3EE", "#818CF8"]} />
      )}
      <LinearGradient
        colors={dark ? ["rgba(11,16,24,0.35)", "rgba(11,16,24,0.75)", t.bg] : ["rgba(250,250,248,0.2)", "rgba(250,250,248,0.75)", t.bg]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function AmbientVideo({ source }: { source: number }) {
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} allowsPictureInPicture={false} />;
}
