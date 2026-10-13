import { buildApp } from "./app";
import { config } from "./config";
import { createDb, migrate } from "./db";
import { pruneConnectionSignals } from "./services/location";
import { rescoreNotes } from "./services/notes";
import { refreshStaleTrust } from "./services/trust";

const sql = createDb(config.databaseUrl);
const ran = await migrate(sql);
if (ran.length) console.log(`Applied migrations: ${ran.join(", ")}`);

const app = await buildApp(config, sql, { logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });

// Background upkeep: trust scores drift as accounts age and strikes expire; connection counts have a retention limit.
const upkeep = setInterval(() => {
  void refreshStaleTrust(sql).catch((e) => app.log.error(e));
  void pruneConnectionSignals(sql).catch((e) => app.log.error(e));
  void rescoreNotes(sql).catch((e) => app.log.error(e));
}, 60 * 60_000);
upkeep.unref();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
