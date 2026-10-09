import type { FastifyPluginAsync } from "fastify";
import { reportSchema } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { badRequest, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";

/** Queue priority: 1 = act within the hour (legal duty), 3 = standard 24h SLA. */
const PRIORITY: Record<string, number> = {
  child_safety: 1,
  terrorism: 1,
  self_harm: 1,
  scam_fraud: 2,
  violence: 2,
  illegal_goods: 2,
};

const safetyRoutes: FastifyPluginAsync = async (app) => {
  const { sql } = app.ctx;

  // Reporting must stay available even to unverified users, so it uses plain auth, not the KYC gate.
  app.post("/reports", async (req, reply) => {
    const me = requireUser(req);
    const input = parse(reportSchema, req.body);
    if (!isId(input.targetId)) throw badRequest("Invalid target");
    const id = newId();
    await sql`
      INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, priority)
      VALUES (${id}, ${me.id}, ${input.targetType}, ${input.targetId}, ${input.reason}, ${input.details ?? ""},
              ${PRIORITY[input.reason] ?? 3})`;
    reply.status(201);
    return { id, status: "received" };
  });
};

export default safetyRoutes;
