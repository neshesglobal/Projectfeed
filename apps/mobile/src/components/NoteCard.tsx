import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, View } from "react-native";
import type { Post } from "@projectfeed/shared";
import { Text } from "./ui";
import { radius, space, useTheme } from "../theme";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** "Readers added context": a Community Note rated helpful by people with different viewpoints. */
export function NoteCard({ post }: { post: Post }) {
  const t = useTheme();
  if (!post.note) return null;
  return (
    <View style={{ marginTop: space.sm, borderWidth: 1, borderColor: t.cardBorder, borderRadius: radius.md, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, paddingVertical: 8, backgroundColor: t.accentSoft }}>
        <Ionicons name="people" size={15} color={t.accent} />
        <Text weight="700" size="sm">
          Readers added context
        </Text>
      </View>
      <View style={{ padding: space.md, gap: 6 }}>
        <Text size="sm">{post.note.text}</Text>
        {post.note.sources.map((s) => (
          <Text key={s} size="sm" style={{ color: t.accent }} onPress={() => void Linking.openURL(s)} accessibilityRole="link" numberOfLines={1}>
            {host(s)}
          </Text>
        ))}
        <Pressable onPress={() => router.push(`/notes/${post.id}`)} hitSlop={6} accessibilityRole="button">
          <Text muted size="xs">
            Community Notes are shown when people with different points of view rate them helpful. Rate it ›
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
