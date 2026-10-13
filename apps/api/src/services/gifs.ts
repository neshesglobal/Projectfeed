// GIF library for the composer's GIF button. The API proxies search so provider keys never ship in the app, and
// attaching a GIF goes by provider id: the server looks the GIF up itself, so a client can't attach arbitrary URLs.
//
// Providers: GIPHY (GIF_PROVIDER=giphy, GIPHY_API_KEY) or Tenor (GIF_PROVIDER=tenor, TENOR_API_KEY). Both require
// hotlinking from their CDN and showing attribution ("Powered by GIPHY" / "Via Tenor"), which the picker does.
// In development without a key, a demo provider serves a few locally generated animated GIFs.

import sharp from "sharp";
import type { Storage } from "../lib/storage";

export interface GifResult {
  id: string;
  title: string;
  /** Small animated preview for the picker grid. */
  previewUrl: string;
  /** The GIF shown in posts. */
  url: string;
  /** Still frame. */
  stillUrl: string;
  width: number;
  height: number;
}

export interface GifPage {
  items: GifResult[];
  next: string | null;
}

export interface GifProvider {
  name: "giphy" | "tenor" | "demo";
  attribution: string;
  trending(cursor: string | null, locale: string): Promise<GifPage>;
  search(q: string, cursor: string | null, locale: string): Promise<GifPage>;
  get(id: string): Promise<GifResult | null>;
}

const PAGE = 24;

/** Only provider CDN URLs are ever stored (defence in depth against a compromised or spoofed response). */
const ALLOWED_HOSTS: Record<"giphy" | "tenor", RegExp> = {
  giphy: /^https:\/\/(media\d*|i)\.giphy\.com\//,
  tenor: /^https:\/\/media\d*\.tenor\.com\//,
};
const allowed = (provider: "giphy" | "tenor", g: GifResult | null) =>
  !!g && [g.url, g.previewUrl, g.stillUrl].every((u) => ALLOWED_HOSTS[provider].test(u));

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GIF provider returned ${res.status}`);
  return (await res.json()) as T;
}

// ─────────────────────────────── GIPHY ───────────────────────────────

interface GiphyImage { url: string; webp?: string; width: string; height: string }
interface GiphyGif {
  id: string;
  title: string;
  images: { fixed_width: GiphyImage; fixed_width_still: GiphyImage; downsized_medium: GiphyImage; original: GiphyImage };
}

export class GiphyProvider implements GifProvider {
  name = "giphy" as const;
  attribution = "Powered by GIPHY";
  constructor(private key: string) {}

  private map(g: GiphyGif): GifResult {
    const main = g.images.downsized_medium?.url ? g.images.downsized_medium : g.images.original;
    return {
      id: g.id,
      title: g.title,
      previewUrl: g.images.fixed_width.webp ?? g.images.fixed_width.url,
      url: main.url,
      stillUrl: g.images.fixed_width_still.url,
      width: Number(main.width),
      height: Number(main.height),
    };
  }

  private async page(path: string, params: Record<string, string>, cursor: string | null): Promise<GifPage> {
    const offset = Number(cursor ?? 0) || 0;
    const qs = new URLSearchParams({ api_key: this.key, limit: String(PAGE), offset: String(offset), rating: "pg-13", ...params });
    const r = await getJson<{ data: GiphyGif[]; pagination: { total_count: number; count: number; offset: number } }>(
      `https://api.giphy.com/v1/gifs/${path}?${qs}`,
    );
    const next = r.pagination.offset + r.pagination.count;
    return { items: r.data.map((g) => this.map(g)).filter((g) => allowed("giphy", g)), next: next < Math.min(r.pagination.total_count, 4999) ? String(next) : null };
  }

  trending(cursor: string | null) {
    return this.page("trending", {}, cursor);
  }
  search(q: string, cursor: string | null, locale: string) {
    return this.page("search", { q, lang: locale.slice(0, 2) }, cursor);
  }
  async get(id: string) {
    if (!/^[A-Za-z0-9]{1,40}$/.test(id)) return null;
    const r = await getJson<{ data: GiphyGif }>(`https://api.giphy.com/v1/gifs/${id}?api_key=${this.key}`).catch(() => null);
    const g = r?.data ? this.map(r.data) : null;
    return allowed("giphy", g) ? g : null;
  }
}

// ─────────────────────────────── Tenor ───────────────────────────────

interface TenorFormat { url: string; dims: [number, number] }
interface TenorGif { id: string; content_description: string; media_formats: { gif?: TenorFormat; tinygif?: TenorFormat; gifpreview?: TenorFormat } }

export class TenorProvider implements GifProvider {
  name = "tenor" as const;
  attribution = "Via Tenor";
  constructor(private key: string) {}

  private map(g: TenorGif): GifResult | null {
    const f = g.media_formats;
    if (!f.gif || !f.tinygif) return null;
    return {
      id: g.id,
      title: g.content_description,
      previewUrl: f.tinygif.url,
      url: f.gif.url,
      stillUrl: f.gifpreview?.url ?? f.tinygif.url,
      width: f.gif.dims[0],
      height: f.gif.dims[1],
    };
  }

  private async page(path: string, params: Record<string, string>, cursor: string | null): Promise<GifPage> {
    const qs = new URLSearchParams({
      key: this.key,
      client_key: "projectfeed",
      limit: String(PAGE),
      contentfilter: "medium",
      media_filter: "gif,tinygif,gifpreview",
      ...(cursor ? { pos: cursor } : {}),
      ...params,
    });
    const r = await getJson<{ results: TenorGif[]; next?: string }>(`https://tenor.googleapis.com/v2/${path}?${qs}`);
    const items = r.results.map((g) => this.map(g)).filter((g): g is GifResult => allowed("tenor", g));
    return { items, next: r.next || null };
  }

  trending(cursor: string | null, locale: string) {
    return this.page("featured", { locale }, cursor);
  }
  search(q: string, cursor: string | null, locale: string) {
    return this.page("search", { q, locale }, cursor);
  }
  async get(id: string) {
    if (!/^[0-9]{1,30}$/.test(id)) return null;
    const qs = new URLSearchParams({ key: this.key, client_key: "projectfeed", ids: id, media_filter: "gif,tinygif,gifpreview" });
    const r = await getJson<{ results: TenorGif[] }>(`https://tenor.googleapis.com/v2/posts?${qs}`).catch(() => null);
    const g = r?.results[0] ? this.map(r.results[0]) : null;
    return allowed("tenor", g) ? g : null;
  }
}

// ─────────────────────────────── Demo ───────────────────────────────

const DEMO: { id: string; title: string; tags: string; hue: number; shape: "ball" | "bars" | "spin" | "pulse" }[] = [
  { id: "demo-yes", title: "Yes!", tags: "yes ok agree happy", hue: 140, shape: "pulse" },
  { id: "demo-wow", title: "Wow", tags: "wow amazing surprised", hue: 280, shape: "spin" },
  { id: "demo-thanks", title: "Thank you", tags: "thanks thank you shukriya dhanyavad", hue: 30, shape: "ball" },
  { id: "demo-lol", title: "LOL", tags: "lol funny haha laugh", hue: 50, shape: "bars" },
  { id: "demo-chai", title: "Chai time", tags: "chai tea coffee break", hue: 20, shape: "pulse" },
  { id: "demo-cricket", title: "Six!", tags: "cricket six win match india", hue: 210, shape: "ball" },
  { id: "demo-party", title: "Party", tags: "party celebrate diwali festival", hue: 320, shape: "spin" },
  { id: "demo-no", title: "Nope", tags: "no nope disagree", hue: 0, shape: "bars" },
  { id: "demo-love", title: "Love it", tags: "love heart like", hue: 340, shape: "pulse" },
  { id: "demo-hello", title: "Namaste", tags: "hello hi namaste welcome", hue: 260, shape: "ball" },
  { id: "demo-sad", title: "Sad", tags: "sad cry upset", hue: 220, shape: "bars" },
  { id: "demo-deal", title: "Deal!", tags: "deal done business handshake", hue: 170, shape: "spin" },
];

function demoFrame(d: (typeof DEMO)[number], i: number, n: number): string {
  const t = i / n;
  const bg = `hsl(${d.hue},65%,${38 + 6 * Math.sin(t * 2 * Math.PI)}%)`;
  let shape = "";
  if (d.shape === "ball") shape = `<circle cx="${60 + 200 * Math.abs(Math.sin(t * Math.PI))}" cy="${150 - 70 * Math.abs(Math.sin(t * 2 * Math.PI))}" r="26" fill="#fff" opacity="0.9"/>`;
  if (d.shape === "pulse") shape = `<circle cx="160" cy="110" r="${30 + 22 * Math.abs(Math.sin(t * 2 * Math.PI))}" fill="#fff" opacity="0.35"/>`;
  if (d.shape === "spin") shape = `<rect x="130" y="80" width="60" height="60" rx="10" fill="#fff" opacity="0.5" transform="rotate(${t * 360} 160 110)"/>`;
  if (d.shape === "bars")
    shape = [0, 1, 2, 3, 4].map((k) => {
      const h = 20 + 50 * Math.abs(Math.sin((t + k / 5) * Math.PI * 2));
      return `<rect x="${95 + k * 28}" y="${150 - h}" width="18" height="${h}" rx="4" fill="#fff" opacity="0.6"/>`;
    }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${bg}"/>${shape}
    <text x="160" y="205" text-anchor="middle" font-size="40" font-weight="800" font-family="Inter, DejaVu Sans, sans-serif" fill="#fff">${d.title}</text></svg>`;
}

/** Local animated GIFs for development and tests: no network, no key. Generated once into storage. */
export class DemoGifProvider implements GifProvider {
  name = "demo" as const;
  attribution = "Demo GIFs";
  private ready: Promise<void> | null = null;
  constructor(private storage: Storage) {}

  private key(id: string, still = false) {
    return `demo-gifs/${id}${still ? "_still.png" : ".gif"}`;
  }

  private ensure(): Promise<void> {
    this.ready ??= (async () => {
      for (const d of DEMO) {
        const frames = await Promise.all(Array.from({ length: 10 }, (_, i) => sharp(Buffer.from(demoFrame(d, i, 10))).png().toBuffer()));
        await this.storage.put(this.key(d.id), await sharp(frames, { join: { animated: true } }).gif({ delay: 90, loop: 0 }).toBuffer(), "image/gif");
        await this.storage.put(this.key(d.id, true), frames[0]!, "image/png");
      }
    })();
    return this.ready;
  }

  private result(d: (typeof DEMO)[number]): GifResult {
    const url = this.storage.url(this.key(d.id));
    return { id: d.id, title: d.title, previewUrl: url, url, stillUrl: this.storage.url(this.key(d.id, true)), width: 320, height: 240 };
  }

  /** Storage keys for a demo GIF (demo GIFs are served from our own storage, not hotlinked). */
  keys(id: string) {
    return { main: this.key(id), still: this.key(id, true) };
  }

  async trending(): Promise<GifPage> {
    await this.ensure();
    return { items: DEMO.map((d) => this.result(d)), next: null };
  }
  async search(q: string): Promise<GifPage> {
    await this.ensure();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = DEMO.filter((d) => words.some((w) => `${d.title} ${d.tags}`.toLowerCase().includes(w)));
    return { items: hits.map((d) => this.result(d)), next: null };
  }
  async get(id: string) {
    await this.ensure();
    const d = DEMO.find((x) => x.id === id);
    return d ? this.result(d) : null;
  }
}

/** GIF_PROVIDER: giphy | tenor | demo (development default) | off. */
export function createGifProvider(isProd: boolean, storage: Storage): GifProvider | null {
  const provider = process.env.GIF_PROVIDER ?? (process.env.GIPHY_API_KEY ? "giphy" : process.env.TENOR_API_KEY ? "tenor" : isProd ? "off" : "demo");
  if (provider === "giphy") {
    if (!process.env.GIPHY_API_KEY) throw new Error("GIF_PROVIDER=giphy needs GIPHY_API_KEY");
    return new GiphyProvider(process.env.GIPHY_API_KEY);
  }
  if (provider === "tenor") {
    if (!process.env.TENOR_API_KEY) throw new Error("GIF_PROVIDER=tenor needs TENOR_API_KEY");
    return new TenorProvider(process.env.TENOR_API_KEY);
  }
  if (provider === "demo" && !isProd) return new DemoGifProvider(storage);
  return null; // GIFs switched off: the app hides the button
}
