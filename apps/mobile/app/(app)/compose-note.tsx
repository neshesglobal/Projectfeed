import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_NOTE_MEDIA, MAX_NOTE_TEXT, type Media } from "@projectfeed/shared";
import { errorMessage } from "../../src/api/client";
import { useCreateNote, usePlace } from "../../src/api/hooks";
import { Backdrop, Card, Chip } from "../../src/components/glass";
import { StarInput } from "../../src/components/Stars";
import { toast } from "../../src/components/Toast";
import { Button, Text } from "../../src/components/ui";
import { formatDuration, uploadWithProgress, waitUntilReady, type LocalAsset } from "../../src/lib/upload";
import { useAuth } from "../../src/store/auth";
import { useNotePlace } from "../../src/store/noteDraft";
import { font, radius, space, useTheme } from "../../src/theme";

interface Attachment {
  localId: string;
  asset: LocalAsset;
  state: "uploading" | "processing" | "ready" | "failed";
  progress: number;
  media?: Media;
  error?: string;
}

const MAX_VIDEO_MS = 10 * 60 * 1000;
const MAX_TITLE = 60;
let nextLocalId = 1;

/** First day of a month, `monthsAgo` before this one, as YYYY-MM-DD. */
function monthStart(monthsAgo: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
const VISITED: { label: string; value: string | undefined }[] = [
  { label: "This month", value: monthStart(0) },
  { label: "Last month", value: monthStart(1) },
  { label: "Earlier", value: undefined },
];

function Tile({ a, onRemove, cover }: { a: Attachment; onRemove: () => void; cover: boolean }) {
  const t = useTheme();
  const isVideo = a.asset.kind === "video";
  const preview = a.media?.status === "ready" && a.media.thumbUrl ? a.media.thumbUrl : isVideo ? null : a.asset.uri;
  return (
    <View style={{ width: 96, height: 128, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#111" }}>
      {preview ? <Image source={{ uri: preview }} style={{ width: "100%", height: "100%" }} contentFit="cover" /> : null}
      {a.state !== "ready" ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 6 }}>
          {a.state === "failed" ? (
            <>
              <Ionicons name="alert-circle" size={22} color={t.danger} />
              <Text size="xs" numberOfLines={3} style={{ color: "#fff", textAlign: "center" }}>
                {a.error ?? "Upload failed"}
              </Text>
            </>
          ) : (
            <Text size="xs" weight="700" style={{ color: "#fff" }}>
              {a.state === "processing" ? "Processing…" : `${Math.round(a.progress * 100)}%`}
            </Text>
          )}
        </View>
      ) : null}
      {cover ? (
        <View style={{ position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: "rgba(10,9,17,0.7)" }}>
          <Text size="xs" weight="700" style={{ color: "#fff" }}>
            {isVideo ? formatDuration(a.asset.durationMs) : "Cover"}
          </Text>
        </View>
      ) : null}
      <Pressable onPress={onRemove} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove" style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="close" size={15} color="#fff" />
      </Pressable>
    </View>
  );
}

function Row({ icon, label, value, onPress, right }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value?: string; onPress?: () => void; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md }}>
      <Ionicons name={icon} size={20} color={t.accent} />
      <Text weight="600" style={{ flex: 1 }} numberOfLines={1}>
        {value ?? label}
      </Text>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null)}
    </Pressable>
  );
}

/** Compose a Discover note: photos (up to 10) or one video, a title, text, a place, and optionally a verified review. */
export default function ComposeNote() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ placeId?: string; review?: string }>();
  const me = useAuth((s) => s.user);
  const create = useCreateNote();
  const place = useNotePlace((s) => s.place);
  const setPlace = useNotePlace((s) => s.setPlace);
  const preset = usePlace(params.placeId ?? "");
  const [items, setItems] = useState<Attachment[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [isReview, setIsReview] = useState(params.review === "1");
  const [rating, setRating] = useState(0);
  const [visitedOn, setVisitedOn] = useState<string | undefined>(VISITED[0]!.value);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const canLabelPaid = me?.badge === "business" || me?.badge === "creator";

  // A fresh composer each time; "Write review" from a place page preselects that place.
  useEffect(() => {
    setPlace(null);
    return () => setPlace(null);
  }, [setPlace]);
  useEffect(() => {
    if (params.placeId && preset.data) setPlace(preset.data);
  }, [params.placeId, preset.data, setPlace]);

  const patch = (localId: string, p: Partial<Attachment>) => setItems((xs) => xs.map((x) => (x.localId === localId ? { ...x, ...p } : x)));

  const startUpload = (asset: LocalAsset): Attachment => {
    const a: Attachment = { localId: String(nextLocalId++), asset, state: "uploading", progress: 0 };
    void (async () => {
      try {
        const media = await uploadWithProgress(asset, (progress) => patch(a.localId, { progress }));
        patch(a.localId, { media, state: media.status === "processing" ? "processing" : "ready" });
        if (media.status === "processing") patch(a.localId, { media: await waitUntilReady(media), state: "ready" });
      } catch (e) {
        patch(a.localId, { state: "failed", error: errorMessage(e) });
      }
    })();
    return a;
  };

  const hasVideo = items.some((a) => a.asset.kind === "video");

  const add = (assets: ImagePicker.ImagePickerAsset[]) => {
    const videos = assets.filter((x) => x.type === "video");
    const images = assets.filter((x) => x.type !== "video");
    if (videos.length && (videos.length > 1 || images.length || items.length)) return toast(`A note has one video, or up to ${MAX_NOTE_MEDIA} photos`);
    if (hasVideo) return toast(`A note has one video, or up to ${MAX_NOTE_MEDIA} photos`);
    if (videos.some((v) => (v.duration ?? 0) > MAX_VIDEO_MS)) return toast("Videos can be up to 10 minutes long");
    const toLocal = (x: ImagePicker.ImagePickerAsset): LocalAsset => ({
      uri: x.uri,
      mimeType: x.mimeType ?? undefined,
      kind: x.type === "video" ? "video" : "image",
      width: x.width,
      height: x.height,
      durationMs: x.duration ?? null,
      fileName: x.fileName ?? null,
    });
    const added = [...videos, ...images].slice(0, MAX_NOTE_MEDIA - items.length).map((x) => startUpload(toLocal(x)));
    setItems((xs) => [...xs, ...added]);
  };

  const pick = async () => {
    if (hasVideo || items.length >= MAX_NOTE_MEDIA) return toast(`A note has one video, or up to ${MAX_NOTE_MEDIA} photos`);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: items.length ? ["images"] : ["images", "videos"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_NOTE_MEDIA - items.length,
      orderedSelection: true,
      quality: 0.9,
      videoMaxDuration: MAX_VIDEO_MS / 1000,
    });
    if (!res.canceled) add(res.assets);
  };

  const camera = async () => {
    if (Platform.OS === "web") return toast("The camera is available in the iOS and Android apps");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return toast("Allow camera access in Settings to take photos and videos");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: hasVideo || items.length ? ["images"] : ["images", "videos"], quality: 0.9, videoMaxDuration: MAX_VIDEO_MS / 1000 });
    if (!res.canceled) add(res.assets);
  };

  const uploading = items.some((a) => a.state === "uploading" || a.state === "processing");
  const missing =
    items.length === 0 ? "Add a photo or video" : title.trim().length < 2 ? "Add a title" : isReview && !place ? "Add the place you're reviewing" : isReview && !rating ? "Choose a star rating" : null;
  const valid = !missing && items.every((a) => a.state === "ready") && text.length <= MAX_NOTE_TEXT;

  const close = () => {
    if (!items.length && !title && !text) return router.back();
    if (Platform.OS === "web") return router.back();
    Alert.alert("Discard note?", "Your photos and text won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => router.back() },
    ]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const post = await create.mutateAsync({
        title: title.trim(),
        text,
        mediaIds: items.map((a) => a.media!.id),
        placeId: place?.id,
        review: isReview && rating ? { rating, visitedOn } : undefined,
        paidPartnership: paid || undefined,
      });
      toast(isReview ? "Your review is live" : "Your note is live");
      router.back();
      router.push(`/note/${post.id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: t.bg }}>
      <Backdrop />
      <View style={{ paddingTop: Platform.OS === "android" ? insets.top : space.md, paddingHorizontal: space.lg, flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.sm }}>
        <Pressable onPress={close} accessibilityRole="button" hitSlop={8}>
          <Text>Cancel</Text>
        </Pressable>
        <Text weight="800" size="lg" style={{ flex: 1, textAlign: "center" }}>
          {isReview ? "New review" : "New note"}
        </Text>
        <Button title={uploading ? "Uploading…" : "Post"} small onPress={submit} loading={busy} disabled={!valid} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + 80 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {items.map((a, i) => (
            <Tile key={a.localId} a={a} cover={i === 0} onRemove={() => setItems((xs) => xs.filter((x) => x.localId !== a.localId))} />
          ))}
          {!hasVideo && items.length < MAX_NOTE_MEDIA ? (
            <>
              <Pressable
                onPress={() => void pick()}
                accessibilityRole="button"
                accessibilityLabel="Add photos or a video"
                style={{ width: 96, height: 128, borderRadius: radius.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.accent, alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: t.accentSoft }}
              >
                <Ionicons name="images-outline" size={26} color={t.accent} />
                <Text size="xs" weight="700" style={{ color: t.accent, textAlign: "center" }}>
                  {items.length ? `${items.length}/${MAX_NOTE_MEDIA}` : "Photos or\nvideo"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void camera()}
                accessibilityRole="button"
                accessibilityLabel="Take a photo or video"
                style={{ width: 64, height: 128, borderRadius: radius.md, borderWidth: 1, borderColor: t.cardBorder, alignItems: "center", justifyContent: "center", backgroundColor: t.bgInput }}
              >
                <Ionicons name="camera-outline" size={24} color={t.text} />
              </Pressable>
            </>
          ) : null}
        </ScrollView>
        {items.length === 0 ? (
          <Text muted size="sm">
            The first photo is the cover in Discover. Add up to {MAX_NOTE_MEDIA} photos, or one video.
          </Text>
        ) : null}

        <View style={{ gap: 2 }}>
          <TextInput
            value={title}
            onChangeText={(v) => setTitle(v.slice(0, MAX_TITLE))}
            placeholder="Add a title"
            placeholderTextColor={t.textMuted}
            accessibilityLabel="Title"
            style={{ color: t.text, fontSize: font.xl, fontWeight: "800", paddingVertical: space.sm }}
          />
          <View style={{ height: 1, backgroundColor: t.border }} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={isReview ? "What was it like? Prices, what to order, the best time to go…" : "Tell people about it. Add #hashtags so it's easy to find."}
            placeholderTextColor={t.textMuted}
            multiline
            accessibilityLabel="Text"
            style={{ color: t.text, fontSize: font.md, minHeight: 110, textAlignVertical: "top", paddingTop: space.md }}
          />
          <Text size="xs" muted style={{ alignSelf: "flex-end", color: text.length > MAX_NOTE_TEXT ? t.danger : t.textMuted }}>
            {title.length}/{MAX_TITLE} · {text.length}/{MAX_NOTE_TEXT}
          </Text>
        </View>

        <Card padding={space.md} style={{ paddingVertical: 0 }}>
          <Row
            icon="location-outline"
            label="Add location"
            value={place ? `${place.name}${place.city ? ` · ${place.city}` : ""}` : undefined}
            onPress={() => router.push("/place-picker")}
            right={
              place ? (
                <Pressable onPress={() => setPlace(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove location">
                  <Ionicons name="close-circle" size={20} color={t.textMuted} />
                </Pressable>
              ) : undefined
            }
          />
          <View style={{ height: 1, backgroundColor: t.border }} />
          <Row icon="star-outline" label="This is a review" right={<Switch value={isReview} onValueChange={setIsReview} trackColor={{ true: t.accent }} />} />
          {isReview ? (
            <View style={{ gap: space.md, paddingBottom: space.md }}>
              <StarInput value={rating} onChange={setRating} />
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                {VISITED.map((v) => (
                  <Chip key={v.label} label={`Visited ${v.label.toLowerCase()}`} active={visitedOn === v.value} onPress={() => setVisitedOn(v.value)} />
                ))}
              </View>
              <Text muted size="xs">
                Shown as a Verified review: your ID is checked, so readers know a real person wrote it. Reviews must be about your own visit; paid or incentivised reviews must be labelled.
              </Text>
            </View>
          ) : null}
          {canLabelPaid ? (
            <>
              <View style={{ height: 1, backgroundColor: t.border }} />
              <Row icon="pricetag-outline" label="Paid partnership" right={<Switch value={paid} onValueChange={setPaid} trackColor={{ true: t.accent }} />} />
            </>
          ) : null}
        </Card>
        {missing && items.length > 0 ? (
          <Text muted size="sm" style={{ textAlign: "center" }}>
            {missing}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
