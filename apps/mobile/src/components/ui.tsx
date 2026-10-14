import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { BADGE_LABEL, type Badge, type UserSummary } from "@projectfeed/shared";
import { font, radius, space, useTheme } from "../theme";
import { Backdrop, Chip, Glass } from "./glass";

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
      style={[{ color: muted ? t.textMuted : t.text, fontSize: font[size], fontWeight: weight ?? "400", letterSpacing: size === "title" || size === "xxl" ? -0.5 : 0 }, style]}
    />
  );
}

/** Every screen sits on the ambient gradient backdrop. */
export function Screen({
  children,
  style,
  edges = [],
  plain,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: ("top" | "bottom")[];
  /** Solid black, for media surfaces (Reels, viewers). */
  plain?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        { flex: 1, backgroundColor: plain ? "#000" : t.bg, paddingTop: edges.includes("top") ? insets.top : 0, paddingBottom: edges.includes("bottom") ? insets.bottom : 0 },
        style,
      ]}
    >
      {plain ? null : <Backdrop />}
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: t.border }, style]} />;
}

export function Avatar({ user, size = 40, onPress }: { user: Pick<UserSummary, "avatarUrl" | "displayName" | "handle"> | null; size?: number; onPress?: () => void }) {
  const t = useTheme();
  const initial = (user?.displayName || user?.handle || "?").charAt(0).toUpperCase();
  // Fixed size: inside a column that stretches its children, an unsized wrapper would grow to full width.
  const ring: ViewStyle = { width: size, height: size, borderRadius: size / 2, borderWidth: StyleSheet.hairlineWidth, borderColor: t.cardBorder, overflow: "hidden", alignSelf: "flex-start" };
  const content = user?.avatarUrl ? (
    <View style={ring}>
      <Image source={{ uri: user.avatarUrl }} style={{ width: "100%", height: "100%", backgroundColor: t.bgInput }} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
    </View>
  ) : (
    <LinearGradient colors={t.accentGradient} style={[ring, { alignItems: "center", justifyContent: "center" }]}>
      <Text weight="700" style={{ fontSize: size * 0.42, color: "#fff" }}>
        {initial}
      </Text>
    </LinearGradient>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${user?.displayName ?? "User"}'s profile`} hitSlop={4} style={{ width: size, height: size, alignSelf: "flex-start" }}>
      {content}
    </Pressable>
  );
}

/** Gold "ID verified" seal (KYC level ≥ 1); organisations (level 2) get the shield. */
export function VerifiedBadge({ level, size = 16 }: { level: number; size?: number }) {
  const t = useTheme();
  if (level < 1) return null;
  return (
    <Ionicons
      name={level >= 2 ? "shield-checkmark" : "checkmark-circle"}
      size={size}
      color={t.verified}
      accessibilityLabel={level >= 2 ? "Verified organisation" : "ID verified"}
      style={{ marginLeft: 3 }}
    />
  );
}

const BADGE_STYLE: Record<Badge, { icon: IconName; color: string }> = {
  business: { icon: "briefcase", color: "#3B82F6" },
  creator: { icon: "star", color: "#8B5CF6" },
  public_figure: { icon: "ribbon", color: "#0EA5A4" },
  government: { icon: "business", color: "#64748B" },
  news: { icon: "newspaper", color: "#E85D3A" },
};

/**
 * The badges after a name: a business/creator/public-figure/government/news badge if the account has one,
 * otherwise the gold ID-verified tick; then the logo of the verified business the person works for.
 */
export function UserBadges({ user, size = 16 }: { user: Pick<UserSummary, "kycLevel" | "badge" | "affiliation">; size?: number }) {
  const b = user.badge ? BADGE_STYLE[user.badge] : null;
  return (
    <>
      {b ? (
        <View
          accessibilityLabel={BADGE_LABEL[user.badge!]}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: b.color, alignItems: "center", justifyContent: "center", marginLeft: 3 }}
        >
          <Ionicons name={b.icon} size={size * 0.6} color="#fff" />
        </View>
      ) : (
        <VerifiedBadge level={user.kycLevel} size={size} />
      )}
      {user.affiliation ? (
        <View accessibilityLabel={`Works at ${user.affiliation.displayName}`} style={{ marginLeft: 4 }}>
          {user.affiliation.avatarUrl ? (
            <Image source={{ uri: user.affiliation.avatarUrl }} style={{ width: size, height: size, borderRadius: 4 }} />
          ) : (
            <View style={{ width: size, height: size, borderRadius: 4, backgroundColor: BADGE_STYLE.business.color, alignItems: "center", justifyContent: "center" }}>
              <Text weight="800" style={{ color: "#fff", fontSize: size * 0.6, lineHeight: size * 0.8 }}>
                {user.affiliation.displayName.slice(0, 1)}
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </>
  );
}

export function NameLine({ user, onPress, size = "md" }: { user: UserSummary; onPress?: () => void; size?: keyof typeof font }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
      <Text weight="700" size={size} numberOfLines={1} style={{ flexShrink: 1 }}>
        {user.displayName}
      </Text>
      <UserBadges user={user} />
      {user.isProtected ? <Ionicons name="lock-closed" size={13} color={t.textMuted} style={{ marginLeft: 3 }} /> : null}
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
  const off = disabled || loading;
  const height = small ? 36 : 52;
  const fg =
    variant === "primary" ? "#fff" : variant === "secondary" ? t.bg : variant === "danger" ? t.danger : variant === "ghost" ? t.accent : t.text;
  const label = loading ? (
    <ActivityIndicator color={fg} />
  ) : (
    <>
      {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={fg} /> : null}
      <RNText style={{ color: fg, fontWeight: "700", fontSize: small ? font.sm : font.md }}>{title}</RNText>
    </>
  );
  const inner: ViewStyle = { minHeight: height, paddingHorizontal: small ? space.lg : space.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radius.pill };

  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        { borderRadius: radius.pill, opacity: off ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        null,
        style,
      ]}
    >
      {variant === "primary" ? (
        <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={inner}>
          {label}
        </LinearGradient>
      ) : variant === "secondary" ? (
        <View style={[inner, { backgroundColor: t.text }]}>{label}</View>
      ) : variant === "ghost" ? (
        <View style={inner}>{label}</View>
      ) : (
        <Glass radius={radius.pill} interactive style={inner}>
          {label}
        </Glass>
      )}
    </Pressable>
  );
}

/** Round glass icon button (header actions, overlays). */
export function IconButton({
  name,
  onPress,
  color,
  size = 22,
  label,
  style,
  glass,
  ...rest
}: { name: IconName; onPress?: () => void; color?: string; size?: number; label: string; style?: StyleProp<ViewStyle>; glass?: boolean } & Omit<PressableProps, "style" | "onPress">) {
  const t = useTheme();
  const icon = <Ionicons name={name} size={size} color={color ?? t.text} />;
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [{ borderRadius: radius.pill, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }, !glass ? { padding: 6 } : null, style]}
    >
      {glass ? (
        <Glass radius={radius.pill} interactive style={{ width: size + 20, height: size + 20, alignItems: "center", justifyContent: "center" }}>
          {icon}
        </Glass>
      ) : (
        icon
      )}
    </Pressable>
  );
}

export function TextField({ label, error, style, ...rest }: TextInputProps & { label?: string; error?: string | null }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text muted size="sm" weight="600" style={{ marginLeft: 4 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={t.textMuted}
        {...rest}
        accessibilityLabel={label ?? rest.placeholder}
        style={[
          {
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: error ? t.danger : t.cardBorder,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            paddingVertical: 14,
            fontSize: font.lg,
            color: t.text,
            backgroundColor: t.bgInput,
          },
          style as StyleProp<TextStyle>,
        ]}
      />
      {error ? (
        <Text size="sm" style={{ color: t.danger, marginLeft: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Top bar for pushed screens: a floating glass back button and a bold title, over the backdrop. */
export function Header({ title, subtitle, right, back = true }: { title: string; subtitle?: string; right?: ReactNode; back?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 4, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.md }}>
      {back ? <IconButton name="chevron-back" glass size={20} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : null}
      <View style={{ flex: 1 }}>
        <Text weight="800" size="xl" numberOfLines={1} style={{ letterSpacing: -0.3 }}>
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
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ padding: space.xxl, gap: space.sm, alignItems: "center" }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: space.sm }}>
        <Ionicons name="sparkles" size={28} color={t.accent} />
      </View>
      <Text weight="800" size="xl" style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body ? (
        <Text muted style={{ textAlign: "center", lineHeight: 21 }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
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

/** Segmented pill chips (replaces X-style underline tabs). Scrolls horizontally when there are many. */
export function TopTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (k: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
      {tabs.map((tab) => (
        <Chip key={tab.key} label={tab.label} active={tab.key === value} onPress={() => onChange(tab.key)} />
      ))}
    </ScrollView>
  );
}

export function UserRow({ user, right, onPress, subtitle }: { user: UserSummary; right?: ReactNode; onPress?: () => void; subtitle?: string }) {
  const t = useTheme();
  const go = onPress ?? (() => router.push(`/user/${user.handle}`));
  return (
    <Pressable
      onPress={go}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: pressed ? t.cardPressed : "transparent" })}
    >
      <Avatar user={user} size={46} />
      <View style={{ flex: 1 }}>
        <NameLine user={user} />
        <Text muted size="sm" numberOfLines={1}>
          {subtitle ?? `@${user.handle}`}
        </Text>
      </View>
      {right}
    </Pressable>
  );
}

/** iOS-style inset grouped container for settings and lists of rows. */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          marginHorizontal: space.lg,
          borderRadius: radius.lg,
          overflow: "hidden",
          backgroundColor: t.card,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: t.cardBorder,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
