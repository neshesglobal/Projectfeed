// "About this account" and username changes.

import type { FastifyPluginAsync } from "fastify";
import { changeHandleSchema, type AccountAbout, type Country } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { AppError, conflict, notFound, parse } from "../lib/errors";
import { isId } from "../lib/ids";
import { userProfile } from "../services/hydrate";
import { connectionStatus, countryName } from "../services/location";

/** Strikes that count against a clean record (unless overturned on appeal). */
const STRIKE_ACTIONS = ["remove_post", "warn", "suspend", "ban"];
const CLEAN_RECORD_MIN_AGE_DAYS = 90;
const HANDLE_COOLDOWN_DAYS = Number(process.env.HANDLE_CHANGE_COOLDOWN_DAYS ?? 30);

const country = (code: string | null | undefined): Country | null => (code ? { code: code.trim(), name: countryName(code.trim())! } : null);

const aboutRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, geo, requireVerified } = app.ctx;

  app.get<{ Params: { id: string } }>("/users/:id/about", async (req): Promise<AccountAbout> => {
    const viewer = req.user?.id ?? "0";
    if (!isId(req.params.id)) throw notFound("User");
    const [u] = await sql<
      { id: string; handle: string; created_at: Date; kyc_level: number; id_country: string | null; id_verified_at: Date | null; phone_country: string | null; blocked: boolean }[]
    >`
      SELECT u.id, u.handle::text AS handle, u.created_at, u.kyc_level, u.id_country, u.id_verified_at, u.phone_country,
             EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = ${viewer} AND b.blocked_id = u.id)
                                             OR (b.blocker_id = u.id AND b.blocked_id = ${viewer})) AS blocked
      FROM users u WHERE u.id = ${req.params.id} AND (u.status = 'active' OR u.id = ${viewer})`;
    if (!u || u.blocked) throw notFound("User");

    const [conn, changes, handles, strikes] = await Promise.all([
      connectionStatus(sql, geo, u.id),
      sql<{ n: number }[]>`SELECT count(*)::int AS n FROM conn_country_history
                           WHERE user_id = ${u.id} AND from_country IS NOT NULL AND changed_at > now() - interval '1 year'`,
      sql<{ old_handle: string; new_handle: string; changed_at: Date }[]>`
        SELECT old_handle::text, new_handle::text, changed_at FROM handle_history WHERE user_id = ${u.id} ORDER BY changed_at DESC LIMIT 10`,
      sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM moderation_actions a LEFT JOIN appeals ap ON ap.action_id = a.id
        WHERE a.user_id = ${u.id} AND a.action = ANY(${STRIKE_ACTIONS}) AND a.created_at > now() - interval '1 year'
          AND (ap.status IS NULL OR ap.status <> 'overturned')`,
    ]);

    return {
      userId: u.id,
      handle: u.handle,
      joinedAt: u.created_at.toISOString(),
      identity: { verified: u.kyc_level >= 1, country: u.kyc_level >= 1 ? country(u.id_country) : null, verifiedAt: u.id_verified_at?.toISOString() ?? null },
      phoneCountry: country(u.phone_country),
      connection: { status: conn.status, country: country(conn.country), changesLastYear: changes[0]!.n },
      handleChanges: handles.map((h) => ({ from: h.old_handle, to: h.new_handle, at: h.changed_at.toISOString() })),
      // Only meaningful for accounts old enough to have a record.
      cleanRecord: strikes[0]!.n === 0 && Date.now() - u.created_at.getTime() > CLEAN_RECORD_MIN_AGE_DAYS * 86400_000,
    };
  });

  /** Change username. Every change is public in "About this account", with a cooldown against rename abuse. */
  app.patch("/me/handle", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const { handle } = parse(changeHandleSchema, req.body);
    await sql.begin(async (tx) => {
      const [u] = await tx<{ handle: string; handle_changed_at: Date | null }[]>`
        SELECT handle::text AS handle, handle_changed_at FROM users WHERE id = ${me.id} FOR UPDATE`;
      if (u!.handle === handle) return;
      if (u!.handle_changed_at && Date.now() - u!.handle_changed_at.getTime() < HANDLE_COOLDOWN_DAYS * 86400_000) {
        throw new AppError(429, "HANDLE_COOLDOWN", `You can change your username once every ${HANDLE_COOLDOWN_DAYS} days`);
      }
      try {
        await tx`UPDATE users SET handle = ${handle}, handle_changed_at = now() WHERE id = ${me.id}`;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw conflict("That handle is taken", "HANDLE_TAKEN");
        throw e;
      }
      await tx`INSERT INTO handle_history (user_id, old_handle, new_handle) VALUES (${me.id}, ${u!.handle}, ${handle})`;
    });
    return userProfile({ db: sql, storage }, me.id, me.id);
  });
};

export default aboutRoutes;
