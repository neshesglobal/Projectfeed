import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGIONS, REGION_HINT, REGION_LABEL, type Region } from "@projectfeed/shared";
import { Glass } from "../../src/components/glass";
import { Button, Text } from "../../src/components/ui";
import { AUDIENCE_OPTIONS, regionsSummary, useReplySettings } from "../../src/store/replySettings";
import { radius, space, useTheme } from "../../src/theme";

function Check({ on, round }: { on: boolean; round?: boolean }) {
  const t = useTheme();
  return (
    <Ionicons
      name={round ? (on ? "radio-button-on" : "radio-button-off") : on ? "checkbox" : "square-outline"}
      size={24}
      color={on ? t.accent : t.textMuted}
    />
  );
}

/** Regions panel: every region is selected by default; people untick the ones they don't want. */
function RegionsPanel({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const saved = useReplySettings((s) => s.regions);
  const setRegions = useReplySettings((s) => s.setRegions);
  const [picked, setPicked] = useState<Set<Region>>(new Set(saved));
  const all = picked.size === REGIONS.length;
  const toggle = (r: Region) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  const done = () => {
    setRegions(REGIONS.filter((r) => picked.has(r)));
    onBack();
  };

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xs }}>
        <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={t.text} />
        </Pressable>
        <Text weight="800" size="lg" style={{ flex: 1 }}>
          Regions
        </Text>
        <Pressable onPress={() => setPicked(all ? new Set() : new Set(REGIONS))} hitSlop={8} accessibilityRole="button">
          <Text weight="700" style={{ color: t.accent }}>
            {all ? "Deselect all" : "Select all"}
          </Text>
        </Pressable>
      </View>
      <Text muted size="sm" style={{ marginBottom: space.sm }}>
        Only people whose verified ID is from these regions can reply. A VPN doesn't change this.
      </Text>
      <ScrollView style={{ maxHeight: 420 }}>
        {REGIONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => toggle(r)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: picked.has(r) }}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ flex: 1 }}>
              <Text weight="700">{REGION_LABEL[r]}</Text>
              <Text muted size="xs" numberOfLines={1}>
                {REGION_HINT[r]}
              </Text>
            </View>
            <Check on={picked.has(r)} />
          </Pressable>
        ))}
      </ScrollView>
      <Button title={picked.size === 0 ? "Choose at least one region" : "Done"} disabled={picked.size === 0} onPress={done} style={{ marginTop: space.md }} />
    </>
  );
}

/** "Who can reply?" sheet opened from the composer. */
export default function ReplySettings() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const audience = useReplySettings((s) => s.audience);
  const setAudience = useReplySettings((s) => s.setAudience);
  const regions = useReplySettings((s) => s.regions);
  const [panel, setPanel] = useState<"main" | "regions">("main");

  return (
    <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: t.overlay }}>
      <Pressable style={{ flex: 1 }} onPress={() => router.back()} accessibilityLabel="Close" />
      <View style={{ paddingHorizontal: space.md, paddingBottom: insets.bottom + space.md, width: "100%", maxWidth: 560, alignSelf: "center" }}>
        <Glass radius={radius.xl} style={{ padding: space.lg }}>
          {panel === "regions" ? (
            <RegionsPanel onBack={() => setPanel("main")} />
          ) : (
            <>
              <Text weight="800" size="lg">
                Who can reply?
              </Text>
              <Text muted size="sm" style={{ marginTop: 2, marginBottom: space.sm }}>
                Pick who can reply to this post. Anyone you mention can always reply.
              </Text>
              {AUDIENCE_OPTIONS.map((o) => (
                <Pressable
                  key={o.key}
                  onPress={() => setAudience(o.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: audience === o.key }}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={o.icon as never} size={19} color={t.accent} />
                  </View>
                  <Text weight="700" style={{ flex: 1 }}>
                    {o.label}
                  </Text>
                  <Check on={audience === o.key} round />
                </Pressable>
              ))}
              <View style={{ height: 1, backgroundColor: t.border, marginVertical: space.sm }} />
              <Pressable
                onPress={() => setPanel("regions")}
                accessibilityRole="button"
                accessibilityLabel={`Regions: ${regionsSummary(regions)}`}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="globe-outline" size={19} color={t.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text weight="700">Regions</Text>
                  <Text muted size="xs">
                    {regionsSummary(regions)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={t.textMuted} />
              </Pressable>
              <Button title="Done" onPress={() => router.back()} style={{ marginTop: space.md }} />
            </>
          )}
        </Glass>
      </View>
    </View>
  );
}
