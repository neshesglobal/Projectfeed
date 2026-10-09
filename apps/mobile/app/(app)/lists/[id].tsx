import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { api, errorMessage } from "../../../src/api/client";
import { useList, useListTimeline } from "../../../src/api/hooks";
import { Feed } from "../../../src/components/Feed";
import { useSheet } from "../../../src/components/Sheet";
import { toast } from "../../../src/components/Toast";
import { Button, EmptyState, Header, IconButton, Screen, Text } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space } from "../../../src/theme";

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const list = useList(id);
  const timeline = useListTimeline(id);
  const openSheet = useSheet((s) => s.open);
  const l = list.data;
  const own = l?.owner.id === me?.id;

  const refresh = () => {
    void list.refetch();
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      refresh();
      toast(msg);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const menu = () =>
    l &&
    openSheet([
      {
        label: l.viewerPinned ? "Unpin from Home" : "Pin to Home",
        icon: "pin-outline",
        onPress: () => void run(() => api(`/lists/${id}/pin`, { method: "PUT", body: { pinned: !l.viewerPinned } }), l.viewerPinned ? "Unpinned" : "Pinned to Home"),
      },
      { label: "View members", icon: "people-outline", onPress: () => router.push({ pathname: "/list-members", params: { id } }) },
      ...(own
        ? [
            {
              label: "Delete list",
              icon: "trash-outline" as const,
              destructive: true,
              onPress: () =>
                void run(async () => {
                  await api(`/lists/${id}`, { method: "DELETE" });
                  router.back();
                }, "List deleted"),
            },
          ]
        : []),
    ]);

  return (
    <Screen>
      <Header title={l?.name ?? "List"} subtitle={l ? `@${l.owner.handle}` : undefined} right={<IconButton name="ellipsis-horizontal" label="List options" onPress={menu} />} />
      <Feed
        query={timeline}
        surface={`list:${id}`}
        header={
          l ? (
            <View style={{ padding: space.lg, gap: space.sm, alignItems: "center" }}>
              <Text weight="800" size="xl">
                {l.name}
              </Text>
              {l.description ? <Text muted>{l.description}</Text> : null}
              <Text muted size="sm">
                {l.memberCount} members · {l.followerCount} followers
              </Text>
              {!own ? (
                <Button
                  title={l.viewerFollowing ? "Following" : "Follow"}
                  small
                  variant={l.viewerFollowing ? "outline" : "secondary"}
                  onPress={() => void run(() => api(`/lists/${id}/follow`, { method: l.viewerFollowing ? "DELETE" : "POST" }), l.viewerFollowing ? "Unfollowed list" : "Following list")}
                />
              ) : null}
            </View>
          ) : null
        }
        empty={<EmptyState title="No posts yet" body={own ? "Add people from their profile menu (⋯ → Add/remove from Lists)." : undefined} />}
      />
    </Screen>
  );
}
