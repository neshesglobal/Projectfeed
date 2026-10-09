import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_POST_LENGTH, weightedLength, type Media, type Post } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { updatePostEverywhere } from "../../src/api/cache";
import { useCreatePost } from "../../src/api/hooks";
import { formatDuration, uploadWithProgress, waitUntilReady, type LocalAsset } from "../../src/lib/upload";
import { QuotedPost } from "../../src/components/PostCard";
import { useSheet } from "../../src/components/Sheet";
import { toast } from "../../src/components/Toast";
import { Avatar, Button, IconButton, Text } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { useSignals } from "../../src/store/signals";
import { radius, space, useTheme } from "../../src/theme";

/** A photo or video attached in the composer. Uploading starts as soon as it's picked (as on X). */
interface Attachment {
  localId: string;
  asset: LocalAsset;
  state: "uploading" | "processing" | "ready" | "failed";
  progress: number;
  media?: Media;
  error?: string;
  altText: string;
}

interface Draft {
  text: string;
  attachments: Attachment[];
  poll: string[] | null;
}

const emptyDraft = (): Draft => ({ text: "", attachments: [], poll: null });
const MAX_VIDEO_MS = 10 * 60 * 1000;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
let nextLocalId = 1;

function AttachmentTile({ a, onRemove, onAlt }: { a: Attachment; onRemove: () => void; onAlt: () => void }) {
  const t = useTheme();
  const isVideo = a.asset.kind === "video";
  const preview = a.media?.status === "ready" && a.media.thumbUrl ? a.media.thumbUrl : isVideo ? null : a.asset.uri;
  const width = isVideo ? 200 : 120;
  return (
    <View style={{ width, height: isVideo ? 140 : 120, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#111" }}>
      {preview ? <Image source={{ uri: preview }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : null}
      {a.state !== "ready" ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", gap: 6, padding: 8 }}>
          {a.state === "failed" ? (
            <>
              <Ionicons name="alert-circle" size={26} color={t.danger} />
              <Text size="xs" style={{ color: "#fff", textAlign: "center" }}>
                {a.error ?? "Upload failed"}
              </Text>
            </>
          ) : (
            <>
              <ActivityIndicator color="#fff" />
              <Text size="xs" weight="700" style={{ color: "#fff" }}>
                {a.state === "uploading" ? `Uploading ${Math.round(a.progress * 100)}%` : "Processing video…"}
              </Text>
              {a.state === "uploading" ? (
                <View style={{ width: "80%", height: 3, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2 }}>
                  <View style={{ width: `${a.progress * 100}%`, height: 3, backgroundColor: t.accent, borderRadius: 2 }} />
                </View>
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {isVideo ? (
        <View style={{ position: "absolute", left: 6, bottom: 6, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
          <Ionicons name="videocam" size={12} color="#fff" />
          <Text size="xs" weight="700" style={{ color: "#fff" }}>
            {formatDuration(a.media?.durationMs ?? a.asset.durationMs)}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onAlt}
          accessibilityRole="button"
          accessibilityLabel="Add image description"
          style={{ position: "absolute", left: 6, bottom: 6, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}
        >
          <Text size="xs" weight="800" style={{ color: "#fff" }}>
            {a.altText ? "ALT ✓" : "+ALT"}
          </Text>
        </Pressable>
      )}
      <IconButton name="close" label="Remove attachment" size={16} color="#fff" onPress={onRemove} style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.7)" }} />
    </View>
  );
}

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
  const params = useLocalSearchParams<{ replyToId?: string; quoteOfId?: string; editId?: string; pick?: string }>();
  const create = useCreatePost();
  const openSheet = useSheet((s) => s.open);

  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [active, setActive] = useState(0);
  const [audience, setAudience] = useState<Audience>("everyone");
  const [busy, setBusy] = useState(false);
  const [altEditing, setAltEditing] = useState<{ localId: string; text: string } | null>(null);

  const related = useQuery({
    queryKey: ["post", params.replyToId ?? params.quoteOfId ?? params.editId],
    enabled: !!(params.replyToId ?? params.quoteOfId ?? params.editId),
    queryFn: () => api<Post>(`/posts/${params.replyToId ?? params.quoteOfId ?? params.editId}`),
  });

  useEffect(() => {
    if (params.editId && related.data) setDrafts([{ text: related.data.text, attachments: [], poll: null }]);
  }, [params.editId, related.data]);

  const update = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const patchAttachment = (localId: string, patch: Partial<Attachment>) =>
    setDrafts((ds) => ds.map((d) => ({ ...d, attachments: d.attachments.map((a) => (a.localId === localId ? { ...a, ...patch } : a)) })));
  const removeAttachment = (localId: string) => setDrafts((ds) => ds.map((d) => ({ ...d, attachments: d.attachments.filter((a) => a.localId !== localId) })));

  const isEdit = !!params.editId;
  const all = drafts.flatMap((d) => d.attachments);
  const uploading = all.some((a) => a.state === "uploading" || a.state === "processing");
  const valid = drafts.every(
    (d) =>
      weightedLength(d.text) <= MAX_POST_LENGTH &&
      (d.text.trim().length > 0 || d.attachments.length > 0 || (drafts.length === 1 && !!params.quoteOfId)) &&
      (!d.poll || d.poll.filter((o) => o.trim()).length >= 2) &&
      d.attachments.every((a) => a.state === "ready"),
  );

  /** Start uploading immediately so processing overlaps with writing the post. */
  const startUpload = (asset: LocalAsset): Attachment => {
    const a: Attachment = { localId: String(nextLocalId++), asset, state: "uploading", progress: 0, altText: "" };
    void (async () => {
      try {
        const media = await uploadWithProgress(asset, (progress) => patchAttachment(a.localId, { progress }));
        patchAttachment(a.localId, { media, state: media.status === "processing" ? "processing" : "ready" });
        if (media.status === "processing") {
          const ready = await waitUntilReady(media);
          patchAttachment(a.localId, { media: ready, state: "ready" });
        }
      } catch (e) {
        patchAttachment(a.localId, { state: "failed", error: errorMessage(e) });
      }
    })();
    return a;
  };

  const addAssets = (i: number, assets: ImagePicker.ImagePickerAsset[]) => {
    const current = drafts[i]!;
    const videos = assets.filter((x) => x.type === "video");
    const images = assets.filter((x) => x.type !== "video");
    const hasVideo = current.attachments.some((a) => a.asset.kind === "video");
    for (const v of videos) {
      if ((v.duration ?? 0) > MAX_VIDEO_MS) return toast("Videos can be up to 10 minutes long");
      if ((v.fileSize ?? 0) > MAX_VIDEO_BYTES) return toast("Videos must be under 512MB");
    }
    if (videos.length > 0 && (videos.length > 1 || images.length > 0 || current.attachments.length > 0)) {
      return toast("A post can have one video, or up to 4 photos");
    }
    if (hasVideo && images.length) return toast("A post can have one video, or up to 4 photos");
    const toLocal = (x: ImagePicker.ImagePickerAsset): LocalAsset => ({
      uri: x.uri,
      mimeType: x.mimeType ?? undefined,
      kind: x.type === "video" ? "video" : "image",
      width: x.width,
      height: x.height,
      durationMs: x.duration ?? null,
      fileName: x.fileName ?? null,
    });
    const added = [...videos, ...images].slice(0, 4 - current.attachments.length).map((x) => startUpload(toLocal(x)));
    update(i, { attachments: [...current.attachments, ...added] });
  };

  const pickMedia = async (i: number, only?: "videos") => {
    const current = drafts[i]!;
    if (current.poll) return toast("Remove the poll to add media");
    if (current.attachments.length >= 4 || current.attachments.some((a) => a.asset.kind === "video")) return toast("A post can have one video, or up to 4 photos");
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: only === "videos" ? ["videos"] : ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: 4 - current.attachments.length,
      quality: 0.9,
      videoMaxDuration: MAX_VIDEO_MS / 1000,
    });
    if (!res.canceled) addAssets(i, res.assets);
  };

  const openCamera = async (i: number) => {
    if (Platform.OS === "web") return toast("The camera is available in the iOS and Android apps");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return toast("Allow camera access in Settings to take photos and videos");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 0.9, videoMaxDuration: MAX_VIDEO_MS / 1000 });
    if (!res.canceled) addAssets(i, res.assets);
  };

  // Opened from "Post a video" (e.g. the empty Reels screen): go straight to the video picker.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (params.pick === "video" && !autoPicked.current) {
      autoPicked.current = true;
      void pickMedia(0, "videos");
    }
  });

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
          for (const a of d.attachments) {
            if (a.altText && a.media) await api(`/media/${a.media.id}`, { method: "PATCH", body: { altText: a.altText } });
            mediaIds.push(a.media!.id);
          }
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
          title={uploading ? "Uploading…" : isEdit ? "Update" : params.replyToId ? "Reply" : drafts.length > 1 ? "Post all" : "Post"}
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
              {d.attachments.length > 0 ? (
                <ScrollView horizontal style={{ marginTop: space.sm }} contentContainerStyle={{ gap: space.sm }}>
                  {d.attachments.map((a) => (
                    <AttachmentTile
                      key={a.localId}
                      a={a}
                      onRemove={() => removeAttachment(a.localId)}
                      onAlt={() => setAltEditing({ localId: a.localId, text: a.altText })}
                    />
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
            <IconButton name="image-outline" label="Add photos or video" color={t.accent} onPress={() => void pickMedia(active)} />
            <IconButton name="camera-outline" label="Take a photo or video" color={t.accent} onPress={() => void openCamera(active)} />
            <IconButton name="film-outline" label="Add a video" color={t.accent} onPress={() => void pickMedia(active, "videos")} />
            <IconButton
              name="stats-chart-outline"
              label="Add poll"
              color={t.accent}
              onPress={() => (drafts[active]!.attachments.length ? toast("Remove media to add a poll") : update(active, { poll: drafts[active]!.poll ?? ["", ""] }))}
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

      <Modal visible={!!altEditing} transparent animationType="fade" onRequestClose={() => setAltEditing(null)}>
        <View style={{ flex: 1, backgroundColor: t.overlay, justifyContent: "center", padding: space.xl }}>
          <View style={{ backgroundColor: t.bg, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
            <Text weight="800" size="lg">
              Image description
            </Text>
            <Text muted size="sm">
              Describe the image for people who are blind or have low vision.
            </Text>
            <TextInput
              value={altEditing?.text ?? ""}
              onChangeText={(text) => setAltEditing((e) => (e ? { ...e, text } : e))}
              placeholder="Description"
              placeholderTextColor={t.textMuted}
              multiline
              maxLength={1000}
              autoFocus
              accessibilityLabel="Image description"
              style={{ minHeight: 90, borderWidth: 1, borderColor: t.border, borderRadius: radius.sm, padding: space.md, color: t.text, textAlignVertical: "top" }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
              <Button title="Cancel" variant="outline" small onPress={() => setAltEditing(null)} />
              <Button
                title="Save"
                small
                onPress={() => {
                  if (altEditing) patchAttachment(altEditing.localId, { altText: altEditing.text.trim() });
                  setAltEditing(null);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
