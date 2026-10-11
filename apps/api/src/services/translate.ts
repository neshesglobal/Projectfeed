// Post translation. Providers sit behind one interface (like upload screening), so the engine can change
// without touching routes or clients:
//   - GoogleTranslator: Google Cloud Translation (Basic, v2). Covers English and the Indian scheduled languages.
//   - DemoTranslator: development only. Returns hand-written translations of the seed posts and refuses anything else.
//
// Tickers, hashtags, @mentions and links are protected: they are passed to the provider as "do not translate"
// spans, so "#EN590", "$XAU" and "@amara_fuel" come back unchanged.

import { LANGUAGES, extractEntities } from "@projectfeed/shared";
import { DEMO_TRANSLATIONS } from "./translate-demo";

export interface Segment {
  text: string;
  /** Protected span (URL, mention, hashtag, cashtag): never translated. */
  keep: boolean;
}

export interface TranslateResult {
  text: string;
  /** Source language as detected by the provider (more precise than our script heuristic). */
  detectedSource: string | null;
}

export interface Translator {
  readonly name: string;
  readonly languages: string[];
  translate(segments: Segment[], target: string, source: string | null): Promise<TranslateResult>;
}

export class TranslationUnavailable extends Error {}

/** Split post text into translatable runs and protected entity spans. */
export function segment(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const e of extractEntities(text)) {
    if (e.start > at) out.push({ text: text.slice(at, e.start), keep: false });
    out.push({ text: text.slice(e.start, e.end), keep: true });
    at = e.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), keep: false });
  return out;
}

// ───────────────────────────── Google Cloud Translation ─────────────────────────────

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unescapeHtml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/** HTML mode lets us mark protected spans translate="no" and keep line breaks as <br>. */
export function toHtml(segments: Segment[]): string {
  return segments
    .map((s) => {
      const html = escapeHtml(s.text).replace(/\n/g, "<br>");
      return s.keep ? `<span translate="no">${html}</span>` : html;
    })
    .join("");
}

export function fromHtml(html: string): string {
  return unescapeHtml(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<span translate="no">([\s\S]*?)<\/span>/g, "$1")
      .replace(/<\/?[a-z][^>]*>/gi, ""),
  );
}

export class GoogleTranslator implements Translator {
  readonly name = "google";
  readonly languages: string[];

  constructor(
    private apiKey: string,
    languages?: string[],
    private fetchImpl: typeof fetch = fetch,
    private endpoint = "https://translation.googleapis.com/language/translate/v2",
  ) {
    this.languages = languages ?? LANGUAGES.map((l) => l.code);
  }

  async translate(segments: Segment[], target: string, source: string | null): Promise<TranslateResult> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      // Our script-based source guess is deliberately not sent: Devanagari could be Hindi, Marathi or Nepali,
      // so Google's own detection is more reliable. `source` is kept in the interface for providers that need it.
      body: JSON.stringify({ q: [toHtml(segments)], target, format: "html" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new TranslationUnavailable(`Google Translation returned ${res.status}`);
    const body = (await res.json()) as { data?: { translations?: { translatedText: string; detectedSourceLanguage?: string }[] } };
    const t = body.data?.translations?.[0];
    if (!t) throw new TranslationUnavailable("Empty translation response");
    void source;
    return { text: fromHtml(t.translatedText), detectedSource: t.detectedSourceLanguage ?? null };
  }
}

// ───────────────────────────── Demo ─────────────────────────────

/** Development only: hand-written translations of the demo seed posts. Anything else is refused, never faked. */
export class DemoTranslator implements Translator {
  readonly name = "demo";
  // Advertises the full list so the picker looks as it will in production; unknown texts are refused.
  readonly languages = LANGUAGES.map((l) => l.code);

  async translate(segments: Segment[], target: string): Promise<TranslateResult> {
    const original = segments.map((s) => s.text).join("");
    const hit = DEMO_TRANSLATIONS.find((d) => d.texts[target] !== undefined && Object.values(d.texts).includes(original));
    if (!hit) throw new TranslationUnavailable("Demo mode translates only the seeded demo posts. Configure TRANSLATE_PROVIDER for real translation.");
    const source = Object.entries(hit.texts).find(([, v]) => v === original)![0];
    return { text: hit.texts[target]!, detectedSource: source };
  }
}

export function createTranslator(isProd: boolean): Translator | null {
  const provider = process.env.TRANSLATE_PROVIDER ?? (isProd ? "" : "demo");
  if (provider === "google") {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!key) throw new Error("TRANSLATE_PROVIDER=google needs GOOGLE_TRANSLATE_API_KEY");
    const langs = process.env.TRANSLATE_LANGUAGES?.split(",").map((s) => s.trim()).filter(Boolean);
    return new GoogleTranslator(key, langs);
  }
  if (provider === "demo" && !isProd) return new DemoTranslator();
  return null; // translation switched off: the app hides the button
}
