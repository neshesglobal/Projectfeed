import { languageFromLocale } from "@projectfeed/shared";
import { usePrefs } from "../store/prefs";

/** The device's language, mapped to a supported translation language (falls back to English). */
export function deviceLanguage(): string {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "en";
  }
}

/** The language posts are translated into: the user's choice, or the device language. */
export function useTranslateTarget(): string {
  const pref = usePrefs((s) => s.translateTo);
  return pref ?? deviceLanguage();
}
