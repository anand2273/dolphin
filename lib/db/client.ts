import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Start the local Supabase stack (pnpm sb:start) " +
      "and copy the DB URL into .env.local.",
  );
}

// Reuse a single client across hot-reloads in dev.
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__sql ?? postgres(connectionString, { prepare: false });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}

export const db = drizzle(sql, { schema });
export type Db = typeof db;

/**
 * Accepted by any helper that must be able to run either standalone or inside
 * `db.transaction(...)`. Taking this instead of `Db` is what keeps a helper's
 * writes on the transaction's connection, so they roll back with it.
 */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
