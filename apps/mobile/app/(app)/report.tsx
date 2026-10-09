import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { REPORT_REASONS } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { toast } from "../../src/components/Toast";
import { Button, Header, Screen, Text, TextField } from "../../src/components/ui";
import { radius, space, useTheme } from "../../src/theme";

const LABELS: Record<(typeof REPORT_REASONS)[number], [string, string]> = {
  spam: ["Spam", "Fake engagement, scams via links, repetitive posts"],
  scam_fraud: ["Scam or fraud", "Fake offers, advance-fee requests, fake documents or funds"],
  harassment: ["Harassment", "Insults, unwanted sexual content, targeted abuse"],
  hate: ["Hate", "Slurs, hateful references or imagery"],
  violence: ["Violent speech", "Threats, incitement or glorification of violence"],
  impersonation: ["Impersonation", "Pretending to be someone else or a company"],
  child_safety: ["Child safety", "Child sexual exploitation or abuse"],
  terrorism: ["Terrorism", "Promotion of terrorist organisations or acts"],
  self_harm: ["Suicide or self-harm", "Encouraging or promoting self-harm"],
  illegal_goods: ["Illegal goods or services", "Sanctioned trade, weapons, drugs"],
  other: ["Something else", "Tell us what's wrong"],
};

export default function Report() {
  const t = useTheme();
  const { targetType, targetId } = useLocalSearchParams<{ targetType: "post" | "user" | "message"; targetId: string }>();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      await api("/reports", { method: "POST", body: { targetType, targetId, reason, details: details || undefined } });
      toast("Thanks — we've received your report");
      router.back();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={`Report ${targetType}`} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 60 }}>
        <Text weight="800" size="xl">
          What type of issue are you reporting?
        </Text>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r}
            onPress={() => setReason(r)}
            accessibilityRole="radio"
            accessibilityState={{ checked: reason === r }}
            style={{ borderWidth: 1, borderColor: reason === r ? t.accent : t.border, borderRadius: radius.md, padding: space.md }}
          >
            <Text weight="700">{LABELS[r][0]}</Text>
            <Text muted size="sm">
              {LABELS[r][1]}
            </Text>
          </Pressable>
        ))}
        <View style={{ marginTop: space.md }}>
          <TextField label="Anything else? (optional)" value={details} onChangeText={setDetails} multiline maxLength={1000} style={{ minHeight: 80 }} />
        </View>
        <Button title="Submit report" onPress={submit} loading={busy} disabled={!reason} style={{ marginTop: space.md }} />
        <Text muted size="xs">
          If someone is in immediate danger, contact local emergency services.
        </Text>
      </ScrollView>
    </Screen>
  );
}
