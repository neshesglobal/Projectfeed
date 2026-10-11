// Languages for post translation: English plus the 22 languages of the Eighth Schedule of the
// Constitution of India. Codes are BCP-47 / ISO 639 as used by Google Cloud Translation.

export interface Language {
  code: string;
  /** English name. */
  name: string;
  /** Name in the language's own script (shown in the picker). */
  native: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "ur", name: "Urdu", native: "اردو" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "as", name: "Assamese", native: "অসমীয়া" },
  { code: "mai", name: "Maithili", native: "मैथिली" },
  { code: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ" },
  { code: "ks", name: "Kashmiri", native: "کٲشُر" },
  { code: "ne", name: "Nepali", native: "नेपाली" },
  { code: "gom", name: "Konkani", native: "कोंकणी" },
  { code: "sd", name: "Sindhi", native: "سنڌي" },
  { code: "doi", name: "Dogri", native: "डोगरी" },
  { code: "mni-Mtei", name: "Manipuri (Meitei)", native: "ꯃꯤꯇꯩꯂꯣꯟ" },
  { code: "brx", name: "Bodo", native: "बड़ो" },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
export const languageByCode = (code: string | null | undefined): Language | undefined => (code ? BY_CODE.get(code) : undefined);
export const isLanguageCode = (code: unknown): code is string => typeof code === "string" && BY_CODE.has(code);

/** Map a device locale ("hi-IN", "ta_IN", "en-GB") to a supported translation language. */
export function languageFromLocale(locale: string | null | undefined): string {
  const base = (locale ?? "en").replace("_", "-").split("-")[0]!.toLowerCase();
  return BY_CODE.has(base) ? base : "en";
}

/** Unicode script blocks and the language a post in that script most likely uses. */
const SCRIPTS: [number, number, string][] = [
  [0x0900, 0x097f, "hi"], // Devanagari: also Marathi, Nepali, Sanskrit, Maithili, Konkani, Dogri, Bodo
  [0x0980, 0x09ff, "bn"], // Bengali–Assamese
  [0x0a00, 0x0a7f, "pa"], // Gurmukhi
  [0x0a80, 0x0aff, "gu"], // Gujarati
  [0x0b00, 0x0b7f, "or"], // Odia
  [0x0b80, 0x0bff, "ta"], // Tamil
  [0x0c00, 0x0c7f, "te"], // Telugu
  [0x0c80, 0x0cff, "kn"], // Kannada
  [0x0d00, 0x0d7f, "ml"], // Malayalam
  [0x1c50, 0x1c7f, "sat"], // Ol Chiki
  [0xabc0, 0xabff, "mni-Mtei"], // Meetei Mayek
  [0x0600, 0x06ff, "ur"], // Arabic script: also Sindhi, Kashmiri
];

const STRIP_RE = /\bhttps?:\/\/\S+|[@#$][\p{L}\p{M}\p{N}_]+/gu;

/**
 * Cheap, offline language guess from the dominant script, used to decide when to offer "Translate".
 * Shared scripts (Devanagari, Bengali, Arabic) map to their most common language; the translation
 * provider's own detection corrects this on first translation. Latin text is treated as English,
 * which includes romanised Hindi ("Hinglish"): the provider handles that case.
 * Returns null when there is too little text to tell.
 */
export function detectLanguage(text: string): string | null {
  const counts = new Map<string, number>();
  let latin = 0;
  for (const ch of text.replace(STRIP_RE, " ")) {
    const cp = ch.codePointAt(0)!;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a) || (cp >= 0xc0 && cp <= 0x24f)) {
      latin++;
      continue;
    }
    for (const [lo, hi, lang] of SCRIPTS) {
      if (cp >= lo && cp <= hi) {
        counts.set(lang, (counts.get(lang) ?? 0) + 1);
        break;
      }
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [lang, n] of counts) if (n > bestN) [best, bestN] = [lang, n];
  if (bestN >= latin && bestN >= 2) return best;
  return latin >= 3 ? "en" : null;
}
