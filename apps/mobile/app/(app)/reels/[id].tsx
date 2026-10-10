import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ReelsViewer } from "../../../src/components/ReelsViewer";
import { IconButton } from "../../../src/components/ui";

/** Opened by tapping a video in any timeline: that video first, then the ranked Reels feed. */
export default function ReelsFromPost() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  return (
    <ReelsViewer
      startId={id}
      bottomInset={insets.bottom}
      header={<IconButton name="chevron-back" glass size={20} label="Back" color="#fff" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />}
    />
  );
}
