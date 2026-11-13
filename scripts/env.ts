import { config } from "dotenv";

/**
 * Imported first by every tsx script here — Next loads .env.local for the app,
 * but a plain `tsx` process gets nothing for free, and lib/db/client.ts reads
 * DATABASE_URL at module-evaluation time, so this must run before anything
 * that imports it. `config()` never overwrites a var already set.
 */
config({ path: ".env.local" });
config();
