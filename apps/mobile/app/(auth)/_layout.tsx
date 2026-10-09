import { Stack } from "expo-router";
import { useTheme } from "../../src/theme";

export const unstable_settings = { initialRouteName: "welcome" };

export default function AuthLayout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}
