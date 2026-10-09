import { router } from "expo-router";
import { Pressable, Switch, View } from "react-native";
import { api, errorMessage } from "../../../src/api/client";
import { toast } from "../../../src/components/Toast";
import { Divider, Header, Screen, Text } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space, useTheme } from "../../../src/theme";
import type { UserProfile } from "@projectfeed/shared";

export default function Privacy() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);

  const toggleProtected = async (value: boolean) => {
    try {
      const u = await api<UserProfile>("/me", { method: "PATCH", body: { isProtected: value } });
      setUser(u);
      toast(value ? "Your posts are now protected" : "Your posts are now public");
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const Link = ({ title, path }: { title: string; path: string }) => (
    <Pressable onPress={() => router.push(path as never)} style={{ padding: space.lg }}>
      <Text>{title}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <Header title="Privacy and safety" />
      <View style={{ flexDirection: "row", alignItems: "center", padding: space.lg, gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text>Protect your posts</Text>
          <Text muted size="sm">
            Only current followers and people you approve can see your posts. New followers must be approved.
          </Text>
        </View>
        <Switch value={!!me?.isProtected} onValueChange={(v) => void toggleProtected(v)} trackColor={{ true: t.accent }} />
      </View>
      <Divider />
      <Link title="Blocked accounts" path="/settings/blocked" />
      <Link title="Muted accounts" path="/settings/muted" />
      <Link title="Muted words" path="/settings/muted-words" />
    </Screen>
  );
}
