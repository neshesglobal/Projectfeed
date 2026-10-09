import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { registerSchema, type AuthTokens } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { Button, Header, Screen, Text, TextField } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { space } from "../../src/theme";

export default function Signup() {
  const signIn = useAuth((s) => s.signIn);
  const [form, setForm] = useState({ displayName: "", handle: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    const input = { ...form, handle: form.handle.replace(/^@/, ""), email: form.email.trim() };
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const t = await api<AuthTokens>("/auth/register", { method: "POST", body: parsed.data, auth: false });
      await signIn(t);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Create your account" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.lg }} keyboardShouldPersistTaps="handled">
          <TextField label="Name" value={form.displayName} onChangeText={set("displayName")} maxLength={50} autoComplete="name" error={errors.displayName} />
          <TextField
            label="Handle"
            value={form.handle}
            onChangeText={set("handle")}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={16}
            placeholder="@yourhandle"
            error={errors.handle}
          />
          <TextField
            label="Email"
            value={form.email}
            onChangeText={set("email")}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            error={errors.email}
          />
          <TextField
            label="Password (10+ characters)"
            value={form.password}
            onChangeText={set("password")}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            error={errors.password}
          />
          {error ? <Text style={{ color: "#F4212E" }}>{error}</Text> : null}
          <View style={{ height: space.md }} />
          <Button title="Sign up" onPress={submit} loading={busy} />
          <Text muted size="xs">
            Identity verification (KYC) will be required before posting once it launches. Your data is handled under UK GDPR.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
