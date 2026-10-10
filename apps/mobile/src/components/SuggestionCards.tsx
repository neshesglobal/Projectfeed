import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { UserSummary } from "@projectfeed/shared";
import { useFollow } from "../api/hooks";
import { space, useTheme } from "../theme";
import { Card } from "./glass";
import { Avatar, Button, NameLine, Text } from "./ui";

/** Horizontal "Suggested connections" cards: avatar, name, subtitle and a Follow pill. */
export function SuggestionCards({ users, subtitles }: { users: UserSummary[]; subtitles?: Record<string, string> }) {
  const t = useTheme();
  const follow = useFollow();
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  if (users.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}>
      {users.map((u) => {
        const done = followed.has(u.id);
        return (
          <Card key={u.id} onPress={() => router.push(`/user/${u.handle}`)} style={{ width: 168, alignItems: "flex-start", gap: space.sm }}>
            <Avatar user={u} size={56} />
            <View style={{ alignSelf: "stretch" }}>
              <NameLine user={u} />
              <Text muted size="sm" numberOfLines={1}>
                {subtitles?.[u.id] ?? `@${u.handle}`}
              </Text>
            </View>
            <Button
              title={done ? "Following" : "Follow"}
              small
              variant={done ? "outline" : "primary"}
              onPress={() => {
                setFollowed((s) => new Set(s).add(u.id));
                follow.mutate({ user: u, follow: true });
              }}
              style={{ alignSelf: "stretch", marginTop: space.xs }}
            />
          </Card>
        );
      })}
      <View style={{ width: 1, backgroundColor: t.border, opacity: 0 }} />
    </ScrollView>
  );
}
