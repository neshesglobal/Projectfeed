import { buildApp } from "./app";
import { config } from "./config";
import { createDb, migrate } from "./db";

const sql = createDb(config.databaseUrl);
const ran = await migrate(sql);
if (ran.length) console.log(`Applied migrations: ${ran.join(", ")}`);

const app = await buildApp(config, sql, { logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}
