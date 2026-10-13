// Account location signals for "About this account".
//
// X derives an account's country from its connection, so a VPN changes it in seconds. We rank three signals by
// how hard they are to fake: the KYC document country (cannot be faked with a VPN), the OTP-verified phone
// country, and the connection country — computed only from connections that are NOT VPNs, proxies, Tor exits
// or hosting providers. VPN use is not penalised or labelled: those connections are simply ignored.

import net from "node:net";
import maxmind, { type AnonymousIPResponse, type CountryResponse, type Reader } from "maxmind";
import type { Db } from "../db";

export interface GeoResult {
  /** ISO 3166-1 alpha-2, upper case; null if unknown (private address, not in database). */
  country: string | null;
  /** VPN, public proxy, Tor exit node, residential proxy or hosting provider. */
  anonymous: boolean;
}

export interface GeoIpProvider {
  readonly name: string;
  /** False when VPN detection is not configured: the connection signal is then not shown at all. */
  readonly detectsAnonymous: boolean;
  lookup(ip: string): GeoResult;
}

const PRIVATE = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^f[cd]/i, /^fe80:/i, /^::ffff:127\./];
export const isPrivateIp = (ip: string) => !net.isIP(ip) || PRIVATE.some((r) => r.test(ip));

/** MaxMind GeoIP2/GeoLite2 Country plus the GeoIP2 Anonymous IP database (paid) for VPN/proxy detection. */
export class MaxMindGeoIp implements GeoIpProvider {
  readonly name = "maxmind";
  constructor(
    private country: Reader<CountryResponse>,
    private anon: Reader<AnonymousIPResponse> | null,
  ) {}
  get detectsAnonymous() {
    return !!this.anon;
  }
  static async open(countryDb: string, anonymousDb?: string): Promise<MaxMindGeoIp> {
    return new MaxMindGeoIp(await maxmind.open<CountryResponse>(countryDb), anonymousDb ? await maxmind.open<AnonymousIPResponse>(anonymousDb) : null);
  }
  lookup(ip: string): GeoResult {
    if (isPrivateIp(ip)) return { country: null, anonymous: false };
    const c = this.country.get(ip);
    const a = this.anon?.get(ip);
    const anonymous = !!(a && (a.is_anonymous || a.is_anonymous_vpn || a.is_public_proxy || a.is_tor_exit_node || a.is_hosting_provider || a.is_residential_proxy));
    return { country: c?.country?.iso_code ?? c?.registered_country?.iso_code ?? null, anonymous };
  }
}

/** Fixed table of addresses: development and tests. Unlisted addresses are unknown. */
export class StaticGeoIp implements GeoIpProvider {
  readonly name = "static";
  readonly detectsAnonymous = true;
  constructor(private table: Record<string, GeoResult> = {}) {}
  lookup(ip: string): GeoResult {
    return this.table[ip] ?? { country: null, anonymous: false };
  }
}

export async function createGeoIp(isProd: boolean): Promise<GeoIpProvider> {
  const countryDb = process.env.GEOIP_COUNTRY_DB;
  if (countryDb) return MaxMindGeoIp.open(countryDb, process.env.GEOIP_ANONYMOUS_DB);
  if (isProd) console.warn("GEOIP_COUNTRY_DB not set: 'Usually connects from' is disabled");
  return new StaticGeoIp();
}

// ───────────────────────────── Recording and computing ─────────────────────────────

/** Rolling window and thresholds for "usually connects from". */
export const CONNECTION_WINDOW_DAYS = 30;
const MIN_DAYS = 3; // distinct days with a usable (non-anonymous, known-country) connection
const MAJORITY = 0.6; // share of those days in one country

const countryNames = new Intl.DisplayNames(["en-GB"], { type: "region" });
export const countryName = (code: string | null | undefined) => {
  if (!code) return null;
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * Records connections cheaply: one database write per user, day and address (an in-memory set absorbs repeats),
 * and recomputes the connection country on the first usable connection of each day.
 */
export class ConnectionTracker {
  private seen = new Set<string>();
  private seenDay = "";

  constructor(
    private sql: Db,
    private geo: GeoIpProvider,
  ) {}

  async record(userId: string, ip: string): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.seenDay) {
      this.seen.clear();
      this.seenDay = day;
    }
    const key = `${userId}|${ip}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 200_000) this.seen.clear();

    const g = this.geo.lookup(ip);
    const [row] = await this.sql<{ first: boolean }[]>`
      INSERT INTO connection_signals AS c (user_id, day, country, anonymous) VALUES (${userId}, ${day}, ${g.country ?? ""}, ${g.anonymous})
      ON CONFLICT (user_id, day, country, anonymous) DO UPDATE SET hits = c.hits + 1
      RETURNING (xmax = 0) AS first`;
    if (row?.first && g.country && !g.anonymous) await recomputeConnectionCountry(this.sql, userId);
  }
}

/** Majority country over the window from usable connections only; updates the profile and logs changes. */
export async function recomputeConnectionCountry(sql: Db, userId: string): Promise<string | null> {
  const rows = await sql<{ country: string; days: number }[]>`
    SELECT country, count(DISTINCT day)::int AS days FROM connection_signals
    WHERE user_id = ${userId} AND NOT anonymous AND country <> '' AND day > current_date - ${CONNECTION_WINDOW_DAYS}::int
    GROUP BY country ORDER BY days DESC`;
  const total = rows.reduce((n, r) => n + r.days, 0);
  const top = rows[0];
  const next = top && total >= MIN_DAYS && top.days / total >= MAJORITY ? top.country : null;
  const [u] = await sql<{ conn_country: string | null }[]>`SELECT conn_country FROM users WHERE id = ${userId}`;
  if (next && u && u.conn_country !== next) {
    // Only a settled new majority counts as a change; an unsettled period keeps the last known country.
    await sql`UPDATE users SET conn_country = ${next}, conn_country_since = now() WHERE id = ${userId}`;
    await sql`INSERT INTO conn_country_history (user_id, from_country, to_country) VALUES (${userId}, ${u.conn_country}, ${next})`;
  }
  return next;
}

/** Retention: daily counts older than 400 days are deleted (they only feed the 30-day window and the change log). */
export async function pruneConnectionSignals(sql: Db): Promise<void> {
  await sql`DELETE FROM connection_signals WHERE day < current_date - 400`;
}

/** Read-only view of the connection signal for the About panel. */
export async function connectionStatus(
  sql: Db,
  geo: GeoIpProvider,
  userId: string,
): Promise<{ status: "ok" | "insufficient" | "varies" | "unavailable"; country: string | null }> {
  if (!geo.detectsAnonymous) return { status: "unavailable", country: null }; // never show an unfiltered country
  const rows = await sql<{ country: string; days: number }[]>`
    SELECT country, count(DISTINCT day)::int AS days FROM connection_signals
    WHERE user_id = ${userId} AND NOT anonymous AND country <> '' AND day > current_date - ${CONNECTION_WINDOW_DAYS}::int
    GROUP BY country ORDER BY days DESC`;
  const total = rows.reduce((n, r) => n + r.days, 0);
  if (total < MIN_DAYS) return { status: "insufficient", country: null };
  const top = rows[0]!;
  return top.days / total >= MAJORITY ? { status: "ok", country: top.country } : { status: "varies", country: null };
}
