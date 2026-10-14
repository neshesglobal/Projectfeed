import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount } from "@projectfeed/shared";
import { api } from "../../src/api/client";
import { Icon, type IconSymbol } from "../../src/components/Icon";
import { Avatar, NameLine, Text } from "../../src/components/ui";
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
  const Item = ({ icon, label, path, onPress, danger }: { icon: IconSymbol; label: string; path?: string; onPress?: () => void; danger?: boolean }) => (
    <Pressable
      onPress={onPress ?? (() => go(path!))}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.lg,
        minHeight: 52,
        paddingHorizontal: space.xl,
        backgroundColor: pressed ? t.cardPressed : "transparent",
      })}
    >
      <Icon name={icon} size={22} color={danger ? t.danger : t.text} />
      <Text weight="600" size="lg" style={{ color: danger ? t.danger : t.text }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.overlay }}>
      {/* Solid panel from the left edge (a drawer, not floating glass), so text always has full contrast. */}
      <View
        style={{
          width: "82%",
          maxWidth: 320,
          backgroundColor: t.mode === "dark" ? t.bgElevated : t.bg,
          // Rounded on the open side, close to the iPhone's own screen-corner curve.
          borderTopRightRadius: 32,
          borderBottomRightRadius: 32,
          overflow: "hidden",
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: t.cardBorder,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.sm,
        }}
        accessibilityViewIsModal
      >
        <ScrollView contentContainerStyle={{ paddingBottom: space.lg }}>
          <View style={{ paddingHorizontal: space.xl, gap: space.md, paddingBottom: space.lg }}>
            <Avatar user={me} size={48} onPress={() => go(`/user/${me.handle}`)} />
            <View>
              <NameLine user={me} size="lg" />
              <Text muted size="sm">
                @{me.handle}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: space.lg }}>
              <Text size="sm">
                <Text size="sm" weight="700">
                  {formatCount(me.followingCount)}
                </Text>{" "}
                <Text size="sm" muted>
                  Following
                </Text>
              </Text>
              <Text size="sm">
                <Text size="sm" weight="700">
                  {formatCount(me.followersCount)}
                </Text>{" "}
                <Text size="sm" muted>
                  Followers
                </Text>
              </Text>
            </View>
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginBottom: space.sm }} />
          <Item icon="person" label="Profile" path={`/user/${me.handle}`} />
          <Item icon="bookmark" label="Bookmarks" path="/bookmarks" />
          <Item icon="folder" label="Collections" path="/collections" />
          <Item icon="list.bullet" label="Lists" path="/lists" />
          <Item icon="person.2" label="Follow requests" path="/follow-requests" />
          <Item icon="person.badge.plus" label="Connect" path="/connect" />
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: space.sm, marginHorizontal: space.xl }} />
          <Item icon="checkmark.shield" label="Verification" path="/settings/verification" />
          <Item icon="gearshape" label="Settings & privacy" path="/settings" />
        </ScrollView>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
        <Item
          icon="rectangle.portrait.and.arrow.right"
          label="Log out"
          danger
          onPress={async () => {
            const rt = useAuth.getState().refreshToken;
            router.back();
            await api("/auth/logout", { method: "POST", body: { refreshToken: rt }, auth: false }).catch(() => {});
            await signOut();
          }}
        />
      </View>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close menu" />
    </View>
  );
}
