import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import { formatRelativeTime, type Conversation } from "@projectfeed/shared";
import { useConversations } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { TabHeader } from "../../../src/components/HomeHeader";
import { Avatar, Button, EmptyState, Loading, NameLine, Screen, Text, TopTabs } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { conversationTitle } from "../../../src/lib/format";
import { space, useTheme } from "../../../src/theme";

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
    <Pressable onPress={() => router.push(`/conversation/${c.id}`)} style={({ pressed }) => ({ flexDirection: "row", gap: space.md, padding: space.lg, backgroundColor: pressed ? t.bgElevated : t.bg })}>
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
    </Pressable>
  );
}

export default function Messages() {
  const t = useTheme();
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const q = useConversations(tab);
  return (
    <Screen>
      <TabHeader title="Messages" right={<Ionicons name="create-outline" size={22} color={t.text} onPress={() => router.push("/new-message")} accessibilityLabel="New message" />}>
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
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <ConversationRow c={item} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.accent} />}
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
