import { router, useLocalSearchParams } from "expo-router";
import type { Collection } from "@projectfeed/shared";
import { Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCollection, useCollectionAction } from "../../../src/api/hooks";
import { NoteGrid } from "../../../src/components/NoteGrid";
import { useSheet } from "../../../src/components/Sheet";
import { toast } from "../../../src/components/Toast";
import { EmptyState, Header, IconButton, Screen } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space, useTheme } from "../../../src/theme";

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  const q = useCollection(id);
  const action = useCollectionAction();
  const openSheet = useSheet((s) => s.open);
  const first = q.data?.pages[0];
  const c = first?.collection as Collection | undefined;
  const own = first?.ownerId === me?.id;

  const remove = () => {
    const go = () => action.mutate({ kind: "delete", id }, { onSuccess: () => (toast("Collection deleted"), router.back()) });
    if (Platform.OS === "web") return go();
    Alert.alert("Delete collection?", "The notes stay in All saves.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: go },
    ]);
  };

  const menu = () =>
    c &&
    openSheet([
      { label: c.isPrivate ? "Make public" : "Make private", icon: c.isPrivate ? "lock-open-outline" : "lock-closed-outline", onPress: () => action.mutate({ kind: "update", id, isPrivate: !c.isPrivate }) },
      { label: "Delete collection", icon: "trash-outline", destructive: true, onPress: remove },
    ]);

  return (
    <Screen>
      <Header
        title={c?.name ?? "Collection"}
        subtitle={c ? `${c.itemCount} saved${c.isPrivate ? " · Private" : ""}` : undefined}
        right={own ? <IconButton name="ellipsis-horizontal" glass size={18} color={t.text} label="Collection options" onPress={menu} /> : null}
      />
      <NoteGrid query={q} bottomInset={insets.bottom + space.xxl} empty={<EmptyState title="Nothing saved here yet" body="Tap Save on a note and choose this collection." />} />
    </Screen>
  );
}
