import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Collection, Post } from "@projectfeed/shared";
import { errorMessage } from "../../src/api/client";
import { useCollectionAction, useMyCollections, useSavedIn, useThread, useToggleBookmark } from "../../src/api/hooks";
import { Glass } from "../../src/components/glass";
import { toast } from "../../src/components/Toast";
import { Button, Loading, Text, TextField } from "../../src/components/ui";
import { radius, space, useTheme } from "../../src/theme";

function Cover({ c }: { c?: Collection }) {
  const t = useTheme();
  return (
    <View style={{ width: 48, height: 48, borderRadius: 12, overflow: "hidden", backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
      {c?.covers[0] ? <Image source={{ uri: c.covers[0] }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <Ionicons name={c ? "folder-outline" : "bookmark"} size={22} color={t.accent} />}
    </View>
  );
}

function Picker({ post }: { post: Post }) {
  const t = useTheme();
  const collections = useMyCollections();
  const savedIn = useSavedIn(post.id);
  const action = useCollectionAction();
  const bookmark = useToggleBookmark();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const inSet = new Set(savedIn.data?.collectionIds ?? []);

  const toggle = (c: Collection) =>
    action.mutate({ kind: inSet.has(c.id) ? "remove" : "add", id: c.id, post }, { onError: (e) => toast(errorMessage(e)) });

  const create = () =>
    action.mutate(
      { kind: "create", name: name.trim(), isPrivate },
      {
        onSuccess: (c) => {
          if (c && typeof c === "object" && "id" in c) action.mutate({ kind: "add", id: (c as Collection).id, post });
          toast(`Saved to “${name.trim()}”`);
          setCreating(false);
          setName("");
        },
        onError: (e) => toast(errorMessage(e)),
      },
    );

  const row = (key: string, c: Collection | undefined, label: string, sub: string, checked: boolean, onPress: () => void) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, opacity: pressed ? 0.6 : 1 })}>
      <Cover c={c} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </Text>
          {c?.isPrivate ? <Ionicons name="lock-closed" size={12} color={t.textMuted} /> : null}
        </View>
        <Text muted size="xs">
          {sub}
        </Text>
      </View>
      <Ionicons name={checked ? "checkmark-circle" : "ellipse-outline"} size={24} color={checked ? t.accent : t.textMuted} />
    </Pressable>
  );

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: space.sm }}>
        <Text weight="800" size="lg" style={{ flex: 1 }}>
          Save to collection
        </Text>
        <Button small variant="ghost" title="Done" onPress={() => router.back()} />
      </View>
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {row("all", undefined, "All saves", post.viewer.bookmarked ? "Saved" : "Not saved", post.viewer.bookmarked, () => bookmark.mutate(post))}
        {collections.isLoading || savedIn.isLoading ? <Loading /> : null}
        {(collections.data?.items ?? []).map((c) => row(c.id, c, c.name, `${c.itemCount} saved`, inSet.has(c.id), () => toggle(c)))}
      </ScrollView>
      {creating ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <TextField value={name} onChangeText={setName} placeholder="Collection name, e.g. Goa trip" maxLength={40} autoFocus />
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ flex: 1 }}>Private (only you can see it)</Text>
            <Switch value={isPrivate} onValueChange={setIsPrivate} trackColor={{ true: t.accent }} />
          </View>
          <Button title="Create and save" onPress={create} loading={action.isPending} disabled={!name.trim()} />
        </View>
      ) : (
        <Button variant="outline" icon="add" title="New collection" onPress={() => setCreating(true)} style={{ marginTop: space.md }} />
      )}
      <Text muted size="xs" style={{ marginTop: space.md, textAlign: "center" }}>
        Saving to a collection also adds it to All saves. Removing it from All saves takes it out of your collections too.
      </Text>
    </>
  );
}

/** Bottom sheet: save a note or post into one or more collections. */
export default function SaveToCollection() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const thread = useThread(postId);
  return (
    <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: t.overlay }}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close" />
      <View style={{ paddingHorizontal: space.md, paddingBottom: insets.bottom + space.md, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        <Glass radius={radius.xl} style={{ padding: space.lg }}>
          {thread.data ? <Picker post={thread.data.post} /> : <Loading />}
        </Glass>
      </View>
    </View>
  );
}
