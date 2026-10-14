import { router } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../store/auth";
import { space, useTheme } from "../theme";
import { Chip } from "./glass";
import { Icon, type IconSymbol } from "./Icon";
import { Logo } from "./Logo";
import { Avatar, Text } from "./ui";

/**
 * Large-title header for tab screens (Apple style): bold title on the left, actions and the
 * account avatar on the right, optional search/chips underneath. Sits directly on the backdrop.
 */
export function TabHeader({ title = "Projectfeed", right, children }: { title?: string; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  return (
    <View style={{ paddingTop: insets.top + space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <Text weight="800" size="title" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {right}
        <Avatar user={me} size={36} onPress={() => router.push("/account-menu")} />
      </View>
      {children}
    </View>
  );
}

/** 44 × 44 pt header action: a bare SF Symbol (no circular background), with an optional unread badge. */
export function HeaderAction({ icon, label, onPress, badge }: { icon: IconSymbol; label: string; onPress: () => void; badge?: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
    >
      <Icon name={icon} size={22} color={t.text} />
      {badge ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 6, right: 4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: t.like, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: t.bg }}
        >
          <Text weight="700" style={{ color: "#fff", fontSize: 10, lineHeight: 12 }} allowFontScaling={false}>
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Home's compact header: brand mark on the left; search, messages and the account avatar on the right. */
export function HomeTopBar({ unreadMessages }: { unreadMessages: number }) {
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  return (
    <View style={{ paddingTop: insets.top + 2, paddingHorizontal: space.lg - 4, flexDirection: "row", alignItems: "center" }}>
      <View style={{ paddingHorizontal: 4, flex: 1 }} accessibilityRole="header" accessibilityLabel="Projectfeed">
        <Logo size={32} />
      </View>
      <HeaderAction icon="magnifyingglass" label="Search" onPress={() => router.push("/search")} />
      <HeaderAction icon="paperplane" label="Messages" badge={unreadMessages} onPress={() => router.push("/messages")} />
      <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: 2 }}>
        <Avatar user={me} size={34} onPress={() => router.push("/account-menu")} />
      </View>
    </View>
  );
}

export interface FeedFilter {
  key: string;
  label: string;
  icon?: IconSymbol;
}

/** One horizontal row of feed filters; a thin divider separates the timeline filters from topic filters. */
export function FeedFilters({ primary, topics, value, onChange }: { primary: FeedFilter[]; topics: FeedFilter[]; value: string; onChange: (k: string) => void }) {
  const t = useTheme();
  const chip = (f: FeedFilter) => (
    <Chip
      key={f.key}
      label={f.label}
      active={f.key === value}
      onPress={() => onChange(f.key)}
      icon={f.icon ? <Icon name={f.icon} size={15} color={f.key === value ? "#FFFFFF" : t.text} /> : undefined}
    />
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, alignItems: "center" }}
      accessibilityRole="tablist"
    >
      {primary.map(chip)}
      {topics.length ? <View style={{ width: StyleSheet.hairlineWidth * 2, height: 22, backgroundColor: t.border, marginHorizontal: 2 }} /> : null}
      {topics.map(chip)}
    </ScrollView>
  );
}
