import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  DEFAULT_SEARCH_FILTERS,
  LANGUAGES,
  languageByCode,
  NEAR_RADIUS_KM,
  SEARCH_ACTIVITY,
  SEARCH_SINCE,
  type SearchFilters,
} from "@projectfeed/shared";
import { currentLocation } from "../lib/maps";
import { toast } from "./Toast";
import { Button, Text } from "./ui";
import { radius, space, useTheme } from "../theme";

type Picker = "from" | "since" | "lang" | "activity";

const FROM = [
  { key: "anyone", label: "Anyone" },
  { key: "following", label: "People you follow" },
] as const;

/**
 * The Filters panel: slides over the search results. Choices are drafts until "Search" is pressed;
 * the cross discards them, "Reset" returns everything to the defaults.
 */
export function SearchFiltersPanel({ value, onApply, onClose }: { value: SearchFilters; onApply: (f: SearchFilters) => void; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<SearchFilters>(value);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [locating, setLocating] = useState(false);
  const set = (patch: Partial<SearchFilters>) => setDraft((d) => ({ ...d, ...patch }));

  const toggleNear = async (on: boolean) => {
    if (!on) return set({ near: null });
    setLocating(true);
    const r = await currentLocation();
    setLocating(false);
    if (r.ok) set({ near: r.coords });
    else toast(r.reason);
  };

  const Row = ({ label, value: v, onPress }: { label: string; value: string; onPress: () => void }) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${v}`} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: space.lg, opacity: pressed ? 0.6 : 1 })}>
      <Text size="lg" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text muted size="lg">
        {v}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} style={{ marginLeft: space.sm }} />
    </Pressable>
  );

  const Toggle = ({ label, body, on, onChange, disabled }: { label: string; body?: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: space.md, gap: space.md }}>
      <View style={{ flex: 1 }}>
        <Text size="lg">{label}</Text>
        {body ? (
          <Text muted size="sm">
            {body}
          </Text>
        ) : null}
      </View>
      <Switch value={on} onValueChange={onChange} disabled={disabled} trackColor={{ true: t.accent }} accessibilityLabel={label} />
    </View>
  );

  const options: Record<Picker, { title: string; items: { key: string; label: string }[]; current: string; pick: (k: string) => void }> = {
    from: { title: "From", items: [...FROM], current: draft.from, pick: (k) => set({ from: k as SearchFilters["from"] }) },
    since: { title: "Date posted", items: SEARCH_SINCE, current: draft.since, pick: (k) => set({ since: k as SearchFilters["since"] }) },
    lang: {
      title: "Language",
      items: [{ key: "", label: "Any" }, ...LANGUAGES.map((l) => ({ key: l.code, label: l.native === l.name ? l.name : `${l.name} · ${l.native}` }))],
      current: draft.lang ?? "",
      pick: (k) => set({ lang: k || null }),
    },
    activity: { title: "Post activity", items: SEARCH_ACTIVITY, current: draft.activity, pick: (k) => set({ activity: k as SearchFilters["activity"] }) },
  };

  const open = picker ? options[picker] : null;

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end" }}>
      <Pressable style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.overlay }} onPress={onClose} accessibilityLabel="Close filters" />
      <View
        style={{
          backgroundColor: t.bgElevated,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          maxHeight: "85%",
          paddingBottom: insets.bottom + space.md,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Pressable onPress={open ? () => setPicker(null) : onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={open ? "Back" : "Close filters"}>
            <Ionicons name={open ? "chevron-back" : "close"} size={24} color={t.text} />
          </Pressable>
          <Text size="lg" weight="700" style={{ flex: 1, textAlign: "center" }}>
            {open ? open.title : "Filters"}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        {open ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg }}>
            {open.items.map((it) => (
              <Pressable
                key={it.key}
                onPress={() => {
                  open.pick(it.key);
                  setPicker(null);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: it.key === open.current }}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingVertical: space.md, opacity: pressed ? 0.6 : 1 })}
              >
                <Text size="lg" style={{ flex: 1 }}>
                  {it.label}
                </Text>
                {it.key === open.current ? <Ionicons name="checkmark" size={22} color={t.accent} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <>
            <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg }}>
              <Row label="From" value={FROM.find((f) => f.key === draft.from)!.label} onPress={() => setPicker("from")} />
              <Row label="Date posted" value={SEARCH_SINCE.find((s) => s.key === draft.since)!.label} onPress={() => setPicker("since")} />
              <Row label="Language" value={languageByCode(draft.lang)?.name ?? "Any"} onPress={() => setPicker("lang")} />
              <Row label="Post activity" value={SEARCH_ACTIVITY.find((a) => a.key === draft.activity)!.label} onPress={() => setPicker("activity")} />
              <Toggle
                label="Near you"
                body={locating ? "Finding your location…" : `Posts tagged with a place within ${NEAR_RADIUS_KM} km`}
                on={draft.near !== null}
                disabled={locating}
                onChange={(v) => void toggleNear(v)}
              />
              <Toggle label="Exclude replies" on={draft.excludeReplies} onChange={(v) => set({ excludeReplies: v })} />
              <Toggle label="Hide muted accounts" body="Blocked accounts are always hidden" on={draft.hideMuted} onChange={(v) => set({ hideMuted: v })} />
            </ScrollView>
            <View style={{ flexDirection: "row", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md }}>
              <Button title="Reset" variant="secondary" style={{ flex: 1, borderRadius: radius.pill }} onPress={() => setDraft(DEFAULT_SEARCH_FILTERS)} />
              <Button title="Search" style={{ flex: 1, borderRadius: radius.pill }} onPress={() => onApply(draft)} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}
