import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_POST_LENGTH, weightedLength, type Post } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { updatePostEverywhere } from "../../src/api/cache";
import { uploadImage, useCreatePost } from "../../src/api/hooks";
import { QuotedPost } from "../../src/components/PostCard";
import { useSheet } from "../../src/components/Sheet";
import { toast } from "../../src/components/Toast";
import { Avatar, Button, IconButton, Text } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { useSignals } from "../../src/store/signals";
import { radius, space, useTheme } from "../../src/theme";

interface Attachment {
  uri: string;
  mimeType?: string;
}

interface Draft {
  text: string;
  images: Attachment[];
  poll: string[] | null;
}

const emptyDraft = (): Draft => ({ text: "", images: [], poll: null });

const AUDIENCE_LABEL = { everyone: "Everyone can reply", following: "Accounts you follow can reply", mentioned: "Only accounts you mention can reply" } as const;
type Audience = keyof typeof AUDIENCE_LABEL;

/** Circular-ish character counter: turns amber at 20 left, red past the limit. */
function Counter({ text }: { text: string }) {
  const t = useTheme();
  const used = weightedLength(text);
  const left = MAX_POST_LENGTH - used;
  if (used === 0) return null;
  const color = left < 0 ? t.danger : left <= 20 ? t.accent : t.textMuted;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2.5, borderColor: t.border, overflow: "hidden", justifyContent: "flex-end" }}>
        <View style={{ height: `${Math.min(100, (used / MAX_POST_LENGTH) * 100)}%`, backgroundColor: color }} />
      </View>
      {left <= 20 ? (
        <Text size="sm" style={{ color }}>
          {left}
        </Text>
      ) : null}
    </View>
  );
}

export default function Compose() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const params = useLocalSearchParams<{ replyToId?: string; quoteOfId?: string; editId?: string }>();
  const create = useCreatePost();
  const openSheet = useSheet((s) => s.open);

  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [active, setActive] = useState(0);
  const [audience, setAudience] = useState<Audience>("everyone");
  const [busy, setBusy] = useState(false);

  const related = useQuery({
    queryKey: ["post", params.replyToId ?? params.quoteOfId ?? params.editId],
    enabled: !!(params.replyToId ?? params.quoteOfId ?? params.editId),
    queryFn: () => api<Post>(`/posts/${params.replyToId ?? params.quoteOfId ?? params.editId}`),
  });

  useEffect(() => {
    if (params.editId && related.data) setDrafts([{ text: related.data.text, images: [], poll: null }]);
  }, [params.editId, related.data]);

  const update = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const isEdit = !!params.editId;
  const valid = drafts.every(
    (d) =>
      weightedLength(d.text) <= MAX_POST_LENGTH &&
      (d.text.trim().length > 0 || d.images.length > 0 || (drafts.length === 1 && !!params.quoteOfId)) &&
      (!d.poll || d.poll.filter((o) => o.trim()).length >= 2),
  );

  const pickImages = async (i: number) => {
    const current = drafts[i]!;
    if (current.poll) return toast("Remove the poll to add photos");
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 4 - current.images.length,
      quality: 0.9,
    });
    if (res.canceled) return;
    update(i, { images: [...current.images, ...res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? undefined }))].slice(0, 4) });
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (isEdit) {
        const updated = await api<Post>(`/posts/${params.editId}`, { method: "PATCH", body: { text: drafts[0]!.text } });
        updatePostEverywhere(qc, updated.id, () => updated);
        toast("Post updated");
      } else {
        // Threads post sequentially, each replying to the previous one.
        let replyTo = params.replyToId;
        for (const [i, d] of drafts.entries()) {
          const mediaIds: string[] = [];
          for (const img of d.images) mediaIds.push((await uploadImage(img.uri, img.mimeType)).id);
          const post = await create.mutateAsync({
            text: d.text,
            replyToId: replyTo,
            quoteOfId: i === 0 ? params.quoteOfId : undefined,
            mediaIds,
            replyAudience: audience,
            poll: d.poll ? { options: d.poll.map((o) => o.trim()).filter(Boolean), durationMinutes: 24 * 60 } : undefined,
          });
          replyTo = post.id;
        }
        toast(params.replyToId ? "Your reply was sent" : "Your post was sent");
        router.back();
        if (!params.replyToId) {
          // Once Home is visible again and its timeline includes the new post, bring it into view.
          await qc.invalidateQueries({ queryKey: ["feed", "following"] });
          useSignals.getState().scrollHomeToTop();
        }
        return;
      }
      router.back();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseAudience = () =>
    openSheet(
      (Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => ({
        label: AUDIENCE_LABEL[a],
        icon: a === audience ? "checkmark" : undefined,
        onPress: () => setAudience(a),
      })),
      "Who can reply?",
    );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: Platform.OS === "android" ? insets.top : space.md, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: space.sm }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text>Cancel</Text>
        </Pressable>
        <Button
          title={isEdit ? "Update" : params.replyToId ? "Reply" : drafts.length > 1 ? "Post all" : "Post"}
          small
          onPress={submit}
          loading={busy}
          disabled={!valid}
        />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }}>
        {params.replyToId && related.data ? (
          <Text muted style={{ marginLeft: 52, marginBottom: space.sm }}>
            Replying to <Text style={{ color: t.accent }}>@{related.data.author.handle}</Text>
          </Text>
        ) : null}
        {drafts.map((d, i) => (
          <View key={i} style={{ flexDirection: "row", gap: space.md, opacity: i === active ? 1 : 0.6 }}>
            <View style={{ alignItems: "center" }}>
              <Avatar user={me} size={40} />
              {i < drafts.length - 1 ? <View style={{ width: 2, flex: 1, backgroundColor: t.border, marginVertical: 4 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: space.lg }}>
              <TextInput
                value={d.text}
                onChangeText={(text) => update(i, { text })}
                onFocus={() => setActive(i)}
                placeholder={i > 0 ? "Add another post" : params.replyToId ? "Post your reply" : "What's happening?"}
                placeholderTextColor={t.textMuted}
                multiline
                autoFocus={i === active}
                accessibilityLabel="Post text"
                style={{ color: t.text, fontSize: 18, minHeight: 60, textAlignVertical: "top" }}
              />
              {d.images.length > 0 ? (
                <ScrollView horizontal style={{ marginTop: space.sm }} contentContainerStyle={{ gap: space.sm }}>
                  {d.images.map((img, j) => (
                    <View key={img.uri}>
                      <Image source={{ uri: img.uri }} style={{ width: 120, height: 120, borderRadius: radius.md }} contentFit="cover" />
                      <IconButton
                        name="close"
                        label="Remove image"
                        size={16}
                        color="#fff"
                        onPress={() => update(i, { images: d.images.filter((_, k) => k !== j) })}
                        style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.7)" }}
                      />
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {d.poll ? (
                <View style={{ marginTop: space.md, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
                  {d.poll.map((opt, j) => (
                    <TextInput
                      key={j}
                      value={opt}
                      onChangeText={(v) => update(i, { poll: d.poll!.map((o, k) => (k === j ? v : o)) })}
                      placeholder={`Choice ${j + 1}${j >= 2 ? " (optional)" : ""}`}
                      placeholderTextColor={t.textMuted}
                      maxLength={25}
                      style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.sm, padding: space.md, color: t.text }}
                    />
                  ))}
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    {d.poll.length < 4 ? <Button title="Add choice" variant="ghost" small onPress={() => update(i, { poll: [...d.poll!, ""] })} /> : <View />}
                    <Button title="Remove poll" variant="danger" small onPress={() => update(i, { poll: null })} />
                  </View>
                  <Text muted size="sm">
                    Poll length: 1 day
                  </Text>
                </View>
              ) : null}
              {i === 0 && params.quoteOfId && related.data ? <QuotedPost post={related.data} /> : null}
            </View>
            {drafts.length > 1 ? (
              <IconButton name="close-circle" label="Remove from thread" size={18} color={t.textMuted} onPress={() => { setDrafts((ds) => ds.filter((_, k) => k !== i)); setActive(0); }} />
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={{ borderTopWidth: 1, borderTopColor: t.border, paddingBottom: insets.bottom || space.md }}>
        {!params.replyToId && !isEdit ? (
          <Pressable onPress={chooseAudience} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
            <Ionicons name="earth" size={16} color={t.accent} />
            <Text weight="700" size="sm" style={{ color: t.accent }}>
              {AUDIENCE_LABEL[audience]}
            </Text>
          </Pressable>
        ) : null}
        {!isEdit ? (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, gap: space.xs }}>
            <IconButton name="image-outline" label="Add photos" color={t.accent} onPress={() => void pickImages(active)} />
            <IconButton
              name="stats-chart-outline"
              label="Add poll"
              color={t.accent}
              onPress={() => (drafts[active]!.images.length ? toast("Remove photos to add a poll") : update(active, { poll: drafts[active]!.poll ?? ["", ""] }))}
            />
            <View style={{ flex: 1 }} />
            <Counter text={drafts[active]!.text} />
            {!params.quoteOfId ? (
              <IconButton
                name="add-circle-outline"
                label="Add to thread"
                color={t.accent}
                onPress={() => {
                  setDrafts((ds) => [...ds, emptyDraft()]);
                  setActive(drafts.length);
                }}
              />
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: space.md }}>
            <Counter text={drafts[0]!.text} />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
