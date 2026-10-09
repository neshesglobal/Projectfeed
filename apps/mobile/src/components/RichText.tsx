import { router } from "expo-router";
import { Linking, Text as RNText, type TextStyle } from "react-native";
import { extractEntities } from "@projectfeed/shared";
import { track } from "../lib/events";
import { font, useTheme } from "../theme";

/** Post text with tappable @mentions, #hashtags, $cashtags and links. */
export function RichText({ text, size = "md", postId }: { text: string; size?: keyof typeof font; postId?: string }) {
  const t = useTheme();
  const entities = extractEntities(text);
  const base: TextStyle = { color: t.text, fontSize: font[size], lineHeight: font[size] * 1.35 };
  const link: TextStyle = { color: t.accent };

  const parts: React.ReactNode[] = [];
  let last = 0;
  entities.forEach((e, i) => {
    if (e.start > last) parts.push(text.slice(last, e.start));
    const label = text.slice(e.start, e.end);
    const onPress = () => {
      if (e.type === "mention") router.push(`/user/${e.value}`);
      else if (e.type === "hashtag") router.push({ pathname: "/search-results", params: { q: `#${e.value}` } });
      else if (e.type === "cashtag") router.push({ pathname: "/search-results", params: { q: `$${e.value}` } });
      else {
        if (postId) track({ type: "click_link", postId, surface: "post" });
        void Linking.openURL(e.value);
      }
    };
    const display = e.type === "url" ? shortenUrl(e.value) : label;
    parts.push(
      <RNText key={i} style={link} onPress={onPress} accessibilityRole="link" suppressHighlighting>
        {display}
      </RNText>,
    );
    last = e.end;
  });
  if (last < text.length) parts.push(text.slice(last));

  return <RNText style={base}>{parts}</RNText>;
}

function shortenUrl(url: string): string {
  const s = url.replace(/^https?:\/\/(www\.)?/, "");
  return s.length > 30 ? `${s.slice(0, 29)}…` : s;
}
