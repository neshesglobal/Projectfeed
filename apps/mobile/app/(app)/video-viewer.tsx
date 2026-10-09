import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "../../src/components/ui";

/** Full-screen player with native controls (used for videos sent in messages). */
export default function VideoViewer() {
  const { url } = useLocalSearchParams<{ url: string; poster?: string }>();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.loop = false;
    p.play();
  });
  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls allowsPictureInPicture />
      <IconButton
        name="close"
        label="Close"
        color="#fff"
        style={{ position: "absolute", top: insets.top + 8, left: 8, backgroundColor: "rgba(0,0,0,0.5)" }}
        onPress={() => router.back()}
      />
    </View>
  );
}
