import { Stack } from "expo-router";
import { useTheme } from "../../src/theme";

export const unstable_settings = { initialRouteName: "(tabs)" };

export default function AppLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="compose" options={{ presentation: "modal" }} />
      <Stack.Screen name="compose-note" options={{ presentation: "modal" }} />
      <Stack.Screen name="place-picker" options={{ presentation: "modal" }} />
      <Stack.Screen name="save-to-collection" options={{ presentation: "transparentModal", animation: "fade" }} />
      <Stack.Screen name="reply-settings" options={{ presentation: "transparentModal", animation: "fade" }} />
      <Stack.Screen name="gif-picker" options={{ presentation: "modal" }} />
      <Stack.Screen name="report" options={{ presentation: "modal" }} />
      <Stack.Screen name="new-message" options={{ presentation: "modal" }} />
      <Stack.Screen name="account-menu" options={{ presentation: "transparentModal", animation: "fade" }} />
      <Stack.Screen name="reels/[id]" options={{ animation: "slide_from_bottom", contentStyle: { backgroundColor: "#000" } }} />
      <Stack.Screen name="video-viewer" options={{ presentation: "fullScreenModal", animation: "fade" }} />
      <Stack.Screen name="media-viewer" options={{ presentation: "fullScreenModal", animation: "fade" }} />
    </Stack>
  );
}
