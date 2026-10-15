import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { formatRelativeTime, type Conversation } from "@projectfeed/shared";
import { useConversations } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { TabHeader } from "../../../src/components/HomeHeader";
import { Card } from "../../../src/components/glass";
import { Avatar, Button, EmptyState, IconButton, Loading, NameLine, Screen, Text, TopTabs } from "../../../src/components/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../../src/store/auth";
import { conversationTitle } from "../../../src/lib/format";
import { radius, space, tabBarSpace, useTheme } from "../../../src/theme";
import { usePullRefresh } from "../../../src/lib/usePullRefresh";

function ConversationRow({ c }: { c: Conversation }) {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const other = c.participants[0] ?? null;
  const last = c.lastMessage;
  const preview = last
    ? last.deleted
      ? "Message deleted"
      : `${last.sender.id === me?.id ? "You: " : ""}${last.text || (last.sharedPost ? "Shared a post" : "Sent a photo")}`
    : "No messages yet";
  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
    <Card onPress={() => router.push(`/conversation/${c.id}`)} style={{ flexDirection: "row", gap: space.md, alignItems: "center", borderRadius: radius.xl }}>
      <Avatar user={other} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {c.isGroup || !other ? (
            <Text weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
              {conversationTitle(c)}
            </Text>
          ) : (
            <>
              <NameLine user={other} />
              <Text muted numberOfLines={1} style={{ flexShrink: 1 }}>
                @{other.handle}
              </Text>
            </>
          )}
          <Text muted size="sm">
            · {formatRelativeTime(c.updatedAt)}
          </Text>
        </View>
        <Text muted={c.unreadCount === 0} weight={c.unreadCount > 0 ? "700" : "400"} numberOfLines={1}>
          {preview}
        </Text>
      </View>
      {c.unreadCount > 0 ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.accent, alignSelf: "center" }} /> : null}
    </Card>
    </View>
  );
}

export default function Messages() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const q = useConversations(tab);
  const pull = usePullRefresh(q.refetch);
  return (
    <Screen>
      <TabHeader title="Messages" right={<IconButton name="create-outline" glass size={18} label="New message" onPress={() => router.push("/new-message")} />}>
        <TopTabs
          tabs={[
            { key: "inbox", label: "Inbox" },
            { key: "requests", label: "Requests" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </TabHeader>
      <FlashList
        data={q.data?.items ?? []}
        contentContainerStyle={{ paddingBottom: tabBarSpace(insets.bottom) + 24 }}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow c={item} />}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />}
        ListEmptyComponent={
          q.isLoading ? (
            <Loading />
          ) : tab === "inbox" ? (
            <EmptyState
              title="Welcome to your inbox!"
              body="Drop a line, share posts and more with private conversations between you and others."
              action={<Button title="Write a message" onPress={() => router.push("/new-message")} />}
            />
          ) : (
            <EmptyState title="No message requests" body="Messages from people you don't follow appear here until you reply." />
          )
        }
      />
      <Fab icon="mail-outline" label="New message" onPress={() => router.push("/new-message")} />
    </Screen>
  );
}
