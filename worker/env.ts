import { config } from "dotenv";

/**
 * Imported first, before anything else in worker/index.ts — several of this
 * worker's dependencies (lib/db/client.ts in particular) read env vars at
 * module-evaluation time, so this must run before those modules are even
 * imported. `config()` never overwrites a var the environment already set, so
 * this is a no-op (and harmless) wherever a real platform injects env vars
 * directly, e.g. in production.
 */
config({ path: ".env.local" });
config();
