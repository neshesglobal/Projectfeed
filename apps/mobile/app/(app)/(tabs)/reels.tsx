import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReelsViewer } from "../../../src/components/ReelsViewer";
import { Text } from "../../../src/components/ui";
import { tabBarSpace } from "../../../src/theme";

export default function ReelsTab() {
  const insets = useSafeAreaInsets();
  return (
    <ReelsViewer
      bottomInset={tabBarSpace(insets.bottom) - 16}
      header={
        <Text weight="800" size="title" style={{ color: "#fff", paddingHorizontal: 8, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 6 }}>
          Reels
        </Text>
      }
    />
  );
}
