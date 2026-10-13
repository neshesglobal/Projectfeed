import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { BADGE_LABEL, REGISTRATION_TYPES, validateRegistration, type RegistrationType } from "@projectfeed/shared";
import { errorMessage } from "../../../src/api/client";
import { useVerification, useVerificationAction } from "../../../src/api/hooks";
import { Card, Chip } from "../../../src/components/glass";
import { toast } from "../../../src/components/Toast";
import { Avatar, Button, ErrorView, Header, Loading, NameLine, Screen, Text, TextField, UserBadges } from "../../../src/components/ui";
import { space, useTheme } from "../../../src/theme";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text muted size="sm" weight="600" style={{ marginLeft: 4, marginTop: space.lg }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function BusinessForm({ onDone }: { onDone: () => void }) {
  const act = useVerificationAction();
  const [f, setF] = useState({ legalName: "", regType: "GSTIN" as RegistrationType, regNumber: "", website: "", signatoryName: "", signatoryRole: "" });
  const regError = f.regNumber ? validateRegistration(f.regType, f.regNumber) : null;
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Card style={{ gap: space.md }}>
      <TextField label="Registered business name" value={f.legalName} onChangeText={set("legalName")} />
      <Text muted size="sm" weight="600">
        Registration
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {REGISTRATION_TYPES.map((r) => (
          <Chip key={r} label={r === "OTHER" ? "Outside India" : r} active={f.regType === r} onPress={() => setF({ ...f, regType: r })} />
        ))}
      </View>
      <TextField label={f.regType === "OTHER" ? "Company registration number" : `${f.regType} number`} value={f.regNumber} onChangeText={set("regNumber")} autoCapitalize="characters" error={regError} />
      <TextField label="Website (optional)" value={f.website} onChangeText={set("website")} autoCapitalize="none" keyboardType="url" />
      <TextField label="Authorised signatory" value={f.signatoryName} onChangeText={set("signatoryName")} />
      <TextField label="Their role (e.g. Director)" value={f.signatoryRole} onChangeText={set("signatoryRole")} />
      <Button
        title="Submit for review"
        loading={act.isPending}
        disabled={!f.legalName || !f.regNumber || !!regError || !f.signatoryName || !f.signatoryRole}
        onPress={() =>
          act.mutate(
            { path: "/me/verification/apply", body: { kind: "business", ...f, website: f.website.trim() } },
            { onSuccess: () => (toast("Submitted. We'll review it and send pricing and an invoice."), onDone()), onError: (e) => toast(errorMessage(e)) },
          )
        }
      />
    </Card>
  );
}

function CreatorForm({ onDone }: { onDone: () => void }) {
  const act = useVerificationAction();
  const [category, setCategory] = useState("");
  const [link, setLink] = useState("");
  const [about, setAbout] = useState("");
  return (
    <Card style={{ gap: space.md }}>
      <TextField label="What do you create? (e.g. Market education)" value={category} onChangeText={setCategory} />
      <TextField label="Link to your work (optional)" value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url" />
      <TextField label="About you (optional)" value={about} onChangeText={setAbout} multiline style={{ minHeight: 80, textAlignVertical: "top" }} />
      <Button
        title="Submit for review"
        loading={act.isPending}
        disabled={category.trim().length < 2}
        onPress={() =>
          act.mutate(
            { path: "/me/verification/apply", body: { kind: "creator", category, links: link.trim() ? [link.trim()] : [], about } },
            { onSuccess: () => (toast("Submitted for review."), onDone()), onError: (e) => toast(errorMessage(e)) },
          )
        }
      />
    </Card>
  );
}

/** Settings → Verification: ID status, business/creator badges and team affiliations. */
export default function Verification() {
  const t = useTheme();
  const q = useVerification();
  const act = useVerificationAction();
  const [form, setForm] = useState<"business" | "creator" | null>(null);
  const [invite, setInvite] = useState({ handle: "", title: "" });

  if (q.isLoading) return <Screen><Header title="Verification" /><Loading /></Screen>;
  if (!q.data) return <Screen><Header title="Verification" /><ErrorView message={errorMessage(q.error)} /></Screen>;
  const v = q.data;
  const pending = v.applications.find((a) => a.status === "pending");
  const lastDecision = v.applications.find((a) => a.status === "rejected");
  const run = (path: string, method: "POST" | "DELETE" = "POST", body?: unknown, ok?: string) =>
    act.mutate({ path, method, body }, { onSuccess: () => ok && toast(ok), onError: (e) => toast(errorMessage(e)) });

  return (
    <Screen>
      <Header title="Verification" />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 80, gap: space.sm }}>
        <Card style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
          <Ionicons name={v.kycLevel >= 1 ? "checkmark-circle" : "shield-outline"} size={34} color={v.kycLevel >= 1 ? t.verified : t.textMuted} />
          <View style={{ flex: 1 }}>
            <Text weight="800">{v.kycLevel >= 1 ? "Identity verified" : "Identity not verified yet"}</Text>
            <Text muted size="sm">
              {v.kycLevel >= 1
                ? "Your profile shows the gold tick and your verified country."
                : "Every account verifies a government ID with a quick selfie check. ID verification is free."}
            </Text>
          </View>
        </Card>

        <Section title="BADGES">
          {v.badge ? (
            <Card style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <UserBadges user={{ kycLevel: v.kycLevel as 0 | 1 | 2, badge: v.badge, affiliation: null }} size={20} />
                <Text weight="800">{BADGE_LABEL[v.badge]}</Text>
              </View>
              {v.subscription ? (
                <Text muted size="sm">
                  Plan active until {date(v.subscription.currentPeriodEnd)}
                </Text>
              ) : (
                <Text muted size="sm">
                  Granted by Projectfeed. This badge is never sold.
                </Text>
              )}
            </Card>
          ) : pending ? (
            <Card>
              <Text weight="700">{pending.kind === "business" ? "Business verification" : "Creator application"} under review</Text>
              <Text muted size="sm">
                Submitted {date(pending.createdAt)}. We check registrations against the official registry and will contact you with pricing.
              </Text>
              <Button title="Withdraw application" variant="ghost" small onPress={() => run("/me/verification/withdraw", "POST", undefined, "Application withdrawn")} />
            </Card>
          ) : (
            <>
              {lastDecision?.reviewNote ? (
                <Text muted size="sm">
                  Last application not approved: {lastDecision.reviewNote}
                </Text>
              ) : null}
              <Card style={{ gap: space.sm }}>
                <Text weight="800">Verified business</Text>
                <Text muted size="sm">
                  A blue business badge, your logo on your team's profiles and "Paid partnership" labels. Checked against your GSTIN, CIN or Udyam registration. Paid monthly.
                </Text>
                {form === "business" ? <BusinessForm onDone={() => setForm(null)} /> : <Button title="Apply as a business" variant="outline" small disabled={v.kycLevel < 1} onPress={() => setForm("business")} />}
              </Card>
              <Card style={{ gap: space.sm }}>
                <Text weight="800">Creator</Text>
                <Text muted size="sm">For influencers and educators: a creator badge and "Paid partnership" labels for sponsored posts. Paid monthly.</Text>
                {form === "creator" ? <CreatorForm onDone={() => setForm(null)} /> : <Button title="Apply as a creator" variant="outline" small disabled={v.kycLevel < 1} onPress={() => setForm("creator")} />}
              </Card>
              <Text muted size="xs" style={{ textAlign: "center" }}>
                Public figure, government and news badges are granted by Projectfeed on published criteria. They can't be bought.
              </Text>
            </>
          )}
        </Section>

        {v.affiliations.length ? (
          <Section title="WHERE YOU WORK">
            {v.affiliations.map((a) => (
              <Card key={a.org.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Avatar user={a.org} size={40} />
                <View style={{ flex: 1 }}>
                  <NameLine user={a.org} />
                  <Text muted size="sm">
                    {a.status === "pending" ? `Invited you${a.title ? ` as ${a.title}` : ""}` : a.title || "Affiliated"}
                  </Text>
                </View>
                {a.status === "pending" ? (
                  <View style={{ gap: 6 }}>
                    <Button title="Accept" small onPress={() => run(`/me/affiliations/${a.org.id}/accept`, "POST", undefined, `${a.org.displayName}'s logo now shows on your profile`)} />
                    <Button title="Decline" variant="ghost" small onPress={() => run(`/me/affiliations/${a.org.id}/decline`)} />
                  </View>
                ) : (
                  <Button title="Leave" variant="ghost" small onPress={() => run(`/me/affiliations/${a.org.id}/leave`)} />
                )}
              </Card>
            ))}
          </Section>
        ) : null}

        {v.badge === "business" ? (
          <Section title="YOUR TEAM">
            <Card style={{ gap: space.sm }}>
              <Text muted size="sm">
                Add the people who work for you. Once they accept, your logo shows next to their name.
              </Text>
              <TextField label="Username" value={invite.handle} onChangeText={(h) => setInvite({ ...invite, handle: h })} autoCapitalize="none" />
              <TextField label="Title (optional)" value={invite.title} onChangeText={(x) => setInvite({ ...invite, title: x })} />
              <Button
                title="Send invitation"
                small
                disabled={!invite.handle}
                onPress={() => (run("/me/affiliates", "POST", { handle: invite.handle.replace(/^@/, ""), title: invite.title }, "Invitation sent"), setInvite({ handle: "", title: "" }))}
              />
            </Card>
            {v.affiliates.map((a) => (
              <Card key={a.member.id} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Avatar user={a.member} size={36} />
                <View style={{ flex: 1 }}>
                  <NameLine user={a.member} />
                  <Text muted size="sm">
                    {a.status === "pending" ? "Invitation pending" : a.title || "Team member"}
                  </Text>
                </View>
                <Button title="Remove" variant="ghost" small onPress={() => run(`/me/affiliates/${a.member.id}`, "DELETE")} />
              </Card>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
