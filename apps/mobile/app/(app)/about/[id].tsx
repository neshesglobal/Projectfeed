import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import { useAbout } from "../../../src/api/hooks";
import { ErrorView, Group, Header, Loading, Screen, Text, type IconName } from "../../../src/components/ui";
import { flag } from "../../../src/lib/country";
import { space, useTheme } from "../../../src/theme";

const month = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Row({ icon, label, value, note, first, tone }: { icon: IconName; label: string; value: ReactNode; note?: string; first?: boolean; tone?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.md, padding: space.lg, borderTopWidth: first ? 0 : 1, borderTopColor: t.border }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={18} color={tone ?? t.accent} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text muted size="sm">
          {label}
        </Text>
        <Text weight="700">{value}</Text>
        {note ? (
          <Text muted size="xs">
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * About this account: where the account really is. The country comes first from the verified ID document, then
 * the verified phone number, then everyday connections — with VPN, proxy and hosting connections left out.
 */
export default function About() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAbout(id);
  if (q.isLoading) return <Screen><Header title="About this account" /><Loading /></Screen>;
  if (!q.data) return <Screen><Header title="About this account" /><ErrorView message={errorMessage(q.error)} /></Screen>;
  const a = q.data;
  const c = a.connection;
  const connValue =
    c.status === "ok" && c.country
      ? `${flag(c.country.code)} ${c.country.name}`
      : c.status === "varies"
        ? "Varies"
        : c.status === "insufficient"
          ? "Not enough data yet"
          : "Not available";

  return (
    <Screen>
      <Header title="About this account" subtitle={`@${a.handle}`} />
      <ScrollView contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 80 }}>
        <Text muted size="sm" weight="600" style={{ marginLeft: space.xl, marginBottom: space.sm }}>
          WHERE THIS ACCOUNT IS BASED
        </Text>
        <Group>
          <Row
            first
            icon="shield-checkmark"
            tone={a.identity.verified ? t.verified : t.textMuted}
            label="Identity verified"
            value={a.identity.verified && a.identity.country ? `${flag(a.identity.country.code)} ${a.identity.country.name}` : a.identity.verified ? "Verified" : "Not verified"}
            note={a.identity.verified ? `Government ID checked${a.identity.verifiedAt ? ` · ${month(a.identity.verifiedAt)}` : ""}. Can't be changed with a VPN.` : "This account hasn't completed ID verification."}
          />
          {a.phoneCountry ? (
            <Row icon="call-outline" label="Phone number" value={`${flag(a.phoneCountry.code)} ${a.phoneCountry.name}`} note="Country of the verified mobile number." />
          ) : null}
          <Row
            icon="globe-outline"
            label="Usually connects from"
            value={connValue}
            note={
              c.status === "ok"
                ? `Last 30 days. VPN and proxy connections aren't counted.${c.changesLastYear ? ` Changed ${c.changesLastYear} ${c.changesLastYear === 1 ? "time" : "times"} in the past year.` : ""}`
                : "Last 30 days. VPN and proxy connections aren't counted."
            }
          />
        </Group>

        <Text muted size="sm" weight="600" style={{ marginLeft: space.xl, marginTop: space.xl, marginBottom: space.sm }}>
          ACCOUNT HISTORY
        </Text>
        <Group>
          <Row first icon="calendar-outline" label="Joined" value={month(a.joinedAt)} />
          <Row
            icon="at-outline"
            label="Username changes"
            value={a.handleChanges.length === 0 ? "None" : `${a.handleChanges.length} ${a.handleChanges.length === 1 ? "change" : "changes"}`}
            note={a.handleChanges.map((h) => `@${h.from} → @${h.to} · ${day(h.at)}`).join("\n") || undefined}
          />
          {a.cleanRecord ? <Row icon="ribbon-outline" tone={t.success} label="Conduct" value="No rule violations in 12 months" /> : null}
        </Group>
        <Text muted size="xs" style={{ marginHorizontal: space.xl, marginTop: space.lg, textAlign: "center" }}>
          Projectfeed shows the country only — never a city or precise location.
        </Text>
      </ScrollView>
    </Screen>
  );
}
