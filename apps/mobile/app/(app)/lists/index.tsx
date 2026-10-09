import { useQueries, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { Page, UserList, UserSummary } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useMyLists } from "../../../src/api/hooks";
import { toast } from "../../../src/components/Toast";
import { Button, EmptyState, Header, Loading, Screen, Text, TextField } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space, useTheme } from "../../../src/theme";

export default function Lists() {
  const t = useTheme();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const { addUserId } = useLocalSearchParams<{ addUserId?: string }>();
  const lists = useMyLists();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const owned = (lists.data?.items ?? []).filter((l) => l.owner.id === me?.id);
  const shown = addUserId ? owned : (lists.data?.items ?? []);

  // When adding someone to lists, we need to know which lists already contain them.
  const memberships = useQueries({
    queries: addUserId
      ? owned.map((l) => ({ queryKey: ["listMembers", l.id], queryFn: () => api<Page<UserSummary>>(`/lists/${l.id}/members`) }))
      : [],
  });
  const isMember = (listId: string) => {
    const i = owned.findIndex((l) => l.id === listId);
    return !!memberships[i]?.data?.items.some((u) => u.id === addUserId);
  };

  const create = async () => {
    setCreating(true);
    try {
      await api<UserList>("/lists", { method: "POST", body: { name } });
      setName("");
      void lists.refetch();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const toggleMember = async (l: UserList) => {
    const member = isMember(l.id);
    try {
      await api(`/lists/${l.id}/members/${addUserId}`, { method: member ? "DELETE" : "PUT" });
      void qc.invalidateQueries({ queryKey: ["listMembers", l.id] });
      void lists.refetch();
      toast(member ? `Removed from ${l.name}` : `Added to ${l.name}`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <Screen>
      <Header title={addUserId ? "Add to Lists" : "Lists"} subtitle={me ? `@${me.handle}` : undefined} />
      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <TextField placeholder="New list name" value={name} onChangeText={setName} maxLength={25} />
        </View>
        <Button title="Create" small onPress={create} loading={creating} disabled={!name.trim()} style={{ marginBottom: 6 }} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => (addUserId ? void toggleMember(item) : router.push(`/lists/${item.id}`))}
            style={({ pressed }) => ({ padding: space.lg, flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: pressed ? t.bgElevated : t.bg })}
          >
            <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
              <Text weight="800" size="xl" style={{ color: t.accentText }}>
                {item.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="700">
                {item.name} {item.isPrivate ? "🔒" : ""}
              </Text>
              <Text muted size="sm">
                {item.memberCount} members · @{item.owner.handle}
                {item.viewerPinned ? " · Pinned" : ""}
              </Text>
            </View>
            {addUserId ? <Text style={{ color: t.accent }}>{isMember(item.id) ? "✓ Added" : "Add"}</Text> : null}
          </Pressable>
        )}
        ListEmptyComponent={lists.isLoading ? <Loading /> : <EmptyState title="No lists yet" body="Lists let you curate a timeline from accounts you choose — pin one to Home as a tab." />}
      />
    </Screen>
  );
}
