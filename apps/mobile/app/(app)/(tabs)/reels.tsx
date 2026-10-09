import { ReelsViewer } from "../../../src/components/ReelsViewer";
import { Text } from "../../../src/components/ui";

export default function ReelsTab() {
  return (
    <ReelsViewer
      header={
        <Text weight="800" size="xl" style={{ color: "#fff", paddingHorizontal: 8, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 }}>
          Reels
        </Text>
      }
    />
  );
}
