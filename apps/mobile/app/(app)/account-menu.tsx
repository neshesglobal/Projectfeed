import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount } from "@projectfeed/shared";
import { api } from "../../src/api/client";
import { Glass } from "../../src/components/glass";
import { Avatar, Divider, NameLine, Text, type IconName } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { radius, space, useTheme } from "../../src/theme";

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
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={19} color={t.accent} />
      </View>
      <Text weight="700" size="lg">
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.overlay }}>
      <Glass
        radius={radius.xl}
        style={{ width: "82%", maxWidth: 340, marginLeft: space.sm, marginTop: insets.top + space.sm, marginBottom: insets.bottom + space.sm, paddingTop: space.xl, paddingHorizontal: space.xl, paddingBottom: space.lg }}
      >
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
          <Item icon="folder-open-outline" label="Collections" path="/collections" />
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
      </Glass>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close menu" />
    </View>
  );
}
