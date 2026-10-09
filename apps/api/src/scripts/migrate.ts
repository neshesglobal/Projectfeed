import { config } from "../config";
import { createDb, migrate } from "../db";

const sql = createDb(config.databaseUrl);
const ran = await migrate(sql);
console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date");
await sql.end();
