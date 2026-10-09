import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount } from "@projectfeed/shared";
import { api } from "../../src/api/client";
import { Avatar, Divider, NameLine, Text, type IconName } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { space, useTheme } from "../../src/theme";

/** X's left drawer: profile summary and navigation to secondary screens. */
export default function AccountMenu() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  if (!me) return null;

  const go = (path: string) => {
    router.back();
    setTimeout(() => router.push(path as never), 10);
  };
  const Item = ({ icon, label, path, onPress }: { icon: IconName; label: string; path?: string; onPress?: () => void }) => (
    <Pressable
      onPress={onPress ?? (() => go(path!))}
      accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.lg, paddingVertical: space.md, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={24} color={t.text} />
      <Text weight="700" size="xl">
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: "80%", maxWidth: 340, backgroundColor: t.bg, paddingTop: insets.top + space.lg, paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.lg }}>
        <ScrollView contentContainerStyle={{ gap: space.xs }}>
          <Avatar user={me} size={44} onPress={() => go(`/user/${me.handle}`)} />
          <View style={{ marginTop: space.sm }}>
            <NameLine user={me} size="lg" />
            <Text muted>@{me.handle}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: space.lg, marginVertical: space.md }}>
            <Text>
              <Text weight="700">{formatCount(me.followingCount)}</Text> <Text muted>Following</Text>
            </Text>
            <Text>
              <Text weight="700">{formatCount(me.followersCount)}</Text> <Text muted>Followers</Text>
            </Text>
          </View>
          <Item icon="person-outline" label="Profile" path={`/user/${me.handle}`} />
          <Item icon="bookmark-outline" label="Bookmarks" path="/bookmarks" />
          <Item icon="list-outline" label="Lists" path="/lists" />
          <Item icon="people-outline" label="Follow requests" path="/follow-requests" />
          <Item icon="person-add-outline" label="Connect" path="/connect" />
          <Divider style={{ marginVertical: space.md }} />
          <Item icon="shield-checkmark-outline" label="Verification" path="/settings/verification" />
          <Item icon="settings-outline" label="Settings & privacy" path="/settings" />
          <Item
            icon="log-out-outline"
            label="Log out"
            onPress={async () => {
              const rt = useAuth.getState().refreshToken;
              router.back();
              await api("/auth/logout", { method: "POST", body: { refreshToken: rt }, auth: false }).catch(() => {});
              await signOut();
            }}
          />
        </ScrollView>
      </View>
      <Pressable style={{ flex: 1, backgroundColor: t.overlay }} onPress={() => router.back()} accessibilityLabel="Close menu" />
    </View>
  );
}
