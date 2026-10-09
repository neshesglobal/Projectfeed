import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SECTORS, type UserProfile } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { uploadImage } from "../../src/api/hooks";
import { toast } from "../../src/components/Toast";
import { Avatar, Button, Header, Screen, Text, TextField } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";
import { radius, space, useTheme } from "../../src/theme";

export default function EditProfile() {
  const t = useTheme();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [form, setForm] = useState({
    displayName: me.displayName,
    bio: me.bio,
    location: me.location,
    website: me.website,
    company: me.company,
    role: me.role,
  });
  const [sectors, setSectors] = useState<string[]>(me.sectors);
  const [avatar, setAvatar] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [banner, setBanner] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pick = async (aspect: [number, number], setter: (v: { uri: string; mimeType?: string }) => void) => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect, quality: 0.9 });
    if (!res.canceled && res.assets[0]) setter({ uri: res.assets[0].uri, mimeType: res.assets[0].mimeType ?? undefined });
  };

  const save = async () => {
    setBusy(true);
    try {
      const avatarMediaId = avatar ? (await uploadImage(avatar.uri, avatar.mimeType)).id : undefined;
      const bannerMediaId = banner ? (await uploadImage(banner.uri, banner.mimeType)).id : undefined;
      const website = form.website && !/^https?:\/\//.test(form.website) ? `https://${form.website}` : form.website;
      const u = await api<UserProfile>("/me", { method: "PATCH", body: { ...form, website, sectors, avatarMediaId, bannerMediaId } });
      setUser(u);
      void qc.invalidateQueries({ queryKey: ["user"] });
      router.back();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Edit profile" right={<Button title="Save" small onPress={save} loading={busy} disabled={!form.displayName.trim()} />} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => void pick([3, 1], setBanner)} accessibilityLabel="Change header photo">
            {banner || me.bannerUrl ? (
              <Image source={{ uri: banner?.uri ?? me.bannerUrl! }} style={{ height: 120 }} contentFit="cover" />
            ) : (
              <View style={{ height: 120, backgroundColor: t.bgInput, alignItems: "center", justifyContent: "center" }}>
                <Text muted>Add header photo</Text>
              </View>
            )}
          </Pressable>
          <View style={{ paddingHorizontal: space.lg, marginTop: -32 }}>
            <Pressable onPress={() => void pick([1, 1], setAvatar)} accessibilityLabel="Change profile photo" style={{ alignSelf: "flex-start", borderWidth: 4, borderColor: t.bg, borderRadius: 44 }}>
              {avatar ? <Image source={{ uri: avatar.uri }} style={{ width: 72, height: 72, borderRadius: 36 }} /> : <Avatar user={me} size={72} />}
            </Pressable>
          </View>
          <View style={{ padding: space.lg, gap: space.lg }}>
            <TextField label="Name" value={form.displayName} onChangeText={set("displayName")} maxLength={50} />
            <TextField label="Bio" value={form.bio} onChangeText={set("bio")} maxLength={160} multiline style={{ minHeight: 80 }} />
            <TextField label="Company" value={form.company} onChangeText={set("company")} maxLength={60} />
            <TextField label="Role" value={form.role} onChangeText={set("role")} maxLength={60} />
            <TextField label="Location" value={form.location} onChangeText={set("location")} maxLength={30} />
            <TextField label="Website" value={form.website} onChangeText={set("website")} autoCapitalize="none" keyboardType="url" maxLength={100} />
            <View style={{ gap: space.sm }}>
              <Text muted size="sm">
                Sectors (up to 5) — used to personalise your For You feed
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {SECTORS.map((s) => {
                  const on = sectors.includes(s);
                  return (
                    <Pressable
                      key={s}
                      onPress={() => setSectors((cur) => (on ? cur.filter((x) => x !== s) : cur.length < 5 ? [...cur, s] : cur))}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={{ borderWidth: 1, borderColor: on ? t.accent : t.border, backgroundColor: on ? t.accent : "transparent", borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 }}
                    >
                      <Text size="sm" weight="600" style={{ color: on ? t.accentText : t.text }}>
                        {s}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
