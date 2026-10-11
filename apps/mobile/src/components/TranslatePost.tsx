import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { languageByCode, type Post } from "@projectfeed/shared";
import { errorMessage } from "../api/client";
import { usePostTranslation, useTranslationConfig } from "../api/hooks";
import { useTranslateTarget } from "../lib/language";
import { RichText } from "./RichText";
import { Text } from "./ui";
import { font, radius, space, useTheme } from "../theme";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", demo: "demo translations" };

/**
 * "Translate post" for posts written in a language other than the reader's. On demand only: nothing is sent
 * for translation until the reader taps. Translations are cached server-side per post and language.
 */
export function TranslatePost({ post, size = "md" }: { post: Post; size?: keyof typeof font }) {
  const t = useTheme();
  const config = useTranslationConfig().data;
  const to = useTranslateTarget();
  const [open, setOpen] = useState(false);
  const q = usePostTranslation(post, to, open);

  const offer = !!config?.enabled && config.languages.includes(to) && !!post.text.trim() && post.lang !== to;
  if (!offer) return null;
  const target = languageByCode(to);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Translate post into ${target?.name ?? to}`}
        style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6, alignSelf: "flex-start" }}
      >
        <Ionicons name="language-outline" size={15} color={t.accent} />
        <Text size="sm" weight="600" style={{ color: t.accent }}>
          {to === "en" ? "Translate post" : `Translate · ${target?.native ?? to}`}
        </Text>
      </Pressable>
    );
  }

  const from = languageByCode(q.data?.sourceLang);
  return (
    <View style={{ marginTop: space.sm, backgroundColor: t.accentSoft, borderRadius: radius.md, padding: space.md, gap: 6 }}>
      {q.isLoading ? (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <ActivityIndicator size="small" color={t.accent} />
          <Text muted size="sm">
            Translating…
          </Text>
        </View>
      ) : q.error ? (
        <Text muted size="sm">
          {errorMessage(q.error)}
        </Text>
      ) : q.data?.sameLanguage ? (
        <Text muted size="sm">
          This post is already in {target?.native ?? to}.
        </Text>
      ) : q.data ? (
        <>
          <RichText text={q.data.text} size={size} postId={post.id} />
          <Text muted size="xs">
            Translated from {from?.name ?? "another language"} by {PROVIDER_LABEL[q.data.provider] ?? q.data.provider}
          </Text>
        </>
      ) : null}
      <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button" style={{ alignSelf: "flex-start" }}>
        <Text size="sm" weight="600" style={{ color: t.accent }}>
          Hide translation
        </Text>
      </Pressable>
    </View>
  );
}
