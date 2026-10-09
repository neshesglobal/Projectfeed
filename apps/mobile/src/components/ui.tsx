import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { UserSummary } from "@projectfeed/shared";
import { font, radius, space, useTheme } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Text({
  muted,
  weight,
  size = "md",
  style,
  ...rest
}: TextProps & { muted?: boolean; weight?: "400" | "500" | "600" | "700" | "800"; size?: keyof typeof font }) {
  const t = useTheme();
  return (
    <RNText
      {...rest}
      style={[{ color: muted ? t.textMuted : t.text, fontSize: font[size], fontWeight: weight ?? "400" }, style]}
    />
  );
}

export function Screen({ children, style, edges = [] }: { children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ("top" | "bottom")[] }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: t.bg, paddingTop: edges.includes("top") ? insets.top : 0, paddingBottom: edges.includes("bottom") ? insets.bottom : 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.border }, style]} />;
}

export function Avatar({ user, size = 40, onPress }: { user: Pick<UserSummary, "avatarUrl" | "displayName" | "handle"> | null; size?: number; onPress?: () => void }) {
  const t = useTheme();
  const initial = (user?.displayName || user?.handle || "?").charAt(0).toUpperCase();
  const content = user?.avatarUrl ? (
    <Image
      source={{ uri: user.avatarUrl }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bgInput }}
      contentFit="cover"
      transition={150}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bgInput, alignItems: "center", justifyContent: "center" }}>
      <Text weight="700" style={{ fontSize: size * 0.42, color: t.textMuted }}>
        {initial}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${user?.displayName ?? "User"}'s profile`} hitSlop={4}>
      {content}
    </Pressable>
  );
}

/** "ID verified" badge — shown for KYC level ≥ 1. Organisation badge (level 2) uses a square. */
export function VerifiedBadge({ level, size = 16 }: { level: number; size?: number }) {
  const t = useTheme();
  if (level < 1) return null;
  return (
    <Ionicons
      name={level >= 2 ? "shield-checkmark" : "checkmark-circle"}
      size={size}
      color={t.accent}
      accessibilityLabel={level >= 2 ? "Verified organisation" : "ID verified"}
      style={{ marginLeft: 2 }}
    />
  );
}

export function NameLine({ user, onPress, size = "md" }: { user: UserSummary; onPress?: () => void; size?: keyof typeof font }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
      <Text weight="700" size={size} numberOfLines={1} style={{ flexShrink: 1 }}>
        {user.displayName}
      </Text>
      <VerifiedBadge level={user.kycLevel} />
      {user.isProtected ? <Ionicons name="lock-closed" size={13} color="#888" style={{ marginLeft: 2 }} /> : null}
    </Pressable>
  );
}

type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  small,
  style,
  icon,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: IconName;
}) {
  const t = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: t.accent, fg: t.accentText, border: t.accent },
    secondary: { bg: t.text, fg: t.bg, border: t.text },
    outline: { bg: "transparent", fg: t.text, border: t.border },
    danger: { bg: "transparent", fg: t.danger, border: t.danger },
    ghost: { bg: "transparent", fg: t.accent, border: "transparent" },
  };
  const c = palette[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        {
          backgroundColor: c.bg,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: radius.pill,
          paddingHorizontal: small ? space.lg : space.xl,
          minHeight: small ? 34 : 48,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: space.sm,
          opacity: off ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={c.fg} /> : null}
          <RNText style={{ color: c.fg, fontWeight: "700", fontSize: small ? font.sm : font.md }}>{title}</RNText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  size = 22,
  label,
  style,
  ...rest
}: { name: IconName; onPress?: () => void; color?: string; size?: number; label: string; style?: StyleProp<ViewStyle> } & Omit<PressableProps, "style" | "onPress">) {
  const t = useTheme();
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [{ padding: 6, borderRadius: radius.pill, opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Ionicons name={name} size={size} color={color ?? t.text} />
    </Pressable>
  );
}

export function TextField({ label, error, style, ...rest }: TextInputProps & { label?: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text muted size="sm">
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.textMuted}
        {...rest}
        accessibilityLabel={label ?? rest.placeholder}
        style={[
          {
            borderWidth: 1,
            borderColor: error ? t.danger : t.border,
            borderRadius: radius.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.md,
            fontSize: font.lg,
            color: t.text,
            backgroundColor: t.bg,
          },
          style as StyleProp<TextStyle>,
        ]}
      />
      {error ? (
        <Text size="sm" style={{ color: t.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Header({ title, subtitle, right, back = true }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: t.bg,
        borderBottomWidth: 1,
        borderBottomColor: t.border,
      }}
    >
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, gap: space.md }}>
        {back ? <IconButton name="arrow-back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : null}
        <View style={{ flex: 1 }}>
          <Text weight="700" size="xl" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text muted size="xs" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={{ padding: space.xxl, gap: space.sm }}>
      <Text weight="800" size="xxl">
        {title}
      </Text>
      {body ? <Text muted>{body}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: "flex-start" }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ padding: space.xl, alignItems: "center" }, style]}>
      <ActivityIndicator color={t.accent} />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.md }}>
      <Text muted style={{ textAlign: "center" }}>
        {message}
      </Text>
      {onRetry ? <Button title="Retry" small onPress={onRetry} /> : null}
    </View>
  );
}

/** X-style underline tabs (For You / Following, Posts / Replies / Media / Likes…). */
export function TopTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: t.bg }}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flex: 1, alignItems: "center", paddingTop: space.md }}
          >
            <Text weight={active ? "700" : "500"} muted={!active} numberOfLines={1}>
              {tab.label}
            </Text>
            <View style={{ height: 4, width: active ? 56 : 0, borderRadius: 2, backgroundColor: t.accent, marginTop: space.md }} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function UserRow({ user, right, onPress }: { user: UserSummary; right?: ReactNode; onPress?: () => void }) {
  const go = onPress ?? (() => router.push(`/user/${user.handle}`));
  return (
    <Pressable onPress={go} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, opacity: pressed ? 0.85 : 1 })}>
      <Avatar user={user} size={44} />
      <View style={{ flex: 1 }}>
        <NameLine user={user} />
        <Text muted numberOfLines={1}>
          @{user.handle}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}
