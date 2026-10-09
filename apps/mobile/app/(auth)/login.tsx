import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import type { AuthTokens } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { Button, Header, Screen, Text, TextField } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { space } from "../../src/theme";

export default function Login() {
  const signIn = useAuth((s) => s.signIn);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api<AuthTokens>("/auth/login", { method: "POST", body: { identifier: identifier.trim(), password }, auth: false });
      await signIn(t);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Log in" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ padding: space.xl, gap: space.lg, flex: 1 }}>
          <Text weight="800" size="title">
            Sign in to Projectfeed
          </Text>
          <TextField
            label="Email or handle"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={submit}
          />
          {error ? (
            <Text style={{ color: "#F4212E" }} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <View style={{ flex: 1 }} />
          <Button title="Log in" onPress={submit} loading={busy} disabled={!identifier || !password} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
