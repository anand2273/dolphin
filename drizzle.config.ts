import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load local env; fall back to .env if present.
config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set (see .env.local).");
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  // We own the `public` schema. Supabase owns `auth`, `storage`, etc.; never
  // let drizzle-kit try to diff or drop those.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
