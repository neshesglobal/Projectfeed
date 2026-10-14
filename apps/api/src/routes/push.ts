import type { FastifyPluginAsync } from "fastify";
import { pushPrefsPatchSchema, pushTokenDeleteSchema, pushTokenSchema } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { parse } from "../lib/errors";
import { pushPrefs } from "../services/push";

const pushRoutes: FastifyPluginAsync = async (app) => {
  const { sql } = app.ctx;

  /** Called by the app on every launch once notifications are allowed (tokens can change). */
  app.put("/me/push-tokens", async (req, reply) => {
    const me = requireUser(req);
    const { token, platform } = parse(pushTokenSchema, req.body);
    // A device belongs to whoever signed in on it last.
    await sql`
      INSERT INTO push_tokens (token, user_id, platform) VALUES (${token}, ${me.id}, ${platform})
      ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`;
    reply.status(204);
  });

  app.delete("/me/push-tokens", async (req, reply) => {
    const me = requireUser(req);
    const { token } = parse(pushTokenDeleteSchema, req.body);
    await sql`DELETE FROM push_tokens WHERE token = ${token} AND user_id = ${me.id}`;
    reply.status(204);
  });

  app.get("/me/push-settings", async (req) => {
    const me = requireUser(req);
    const [u] = await sql<{ push_prefs: unknown }[]>`SELECT push_prefs FROM users WHERE id = ${me.id}`;
    return pushPrefs(u?.push_prefs);
  });

  app.patch("/me/push-settings", async (req) => {
    const me = requireUser(req);
    const patch = parse(pushPrefsPatchSchema, req.body);
    const [u] = await sql<{ push_prefs: unknown }[]>`
      UPDATE users SET push_prefs = push_prefs || ${sql.json(patch)} WHERE id = ${me.id} RETURNING push_prefs`;
    return pushPrefs(u?.push_prefs);
  });
};

export default pushRoutes;
