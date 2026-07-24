import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. SERVER-ONLY — it can create users and bypasses
 * RLS. Never import this into a client component. (It reads a non-public env
 * var, so it also can't accidentally initialize in the browser.)
 *
 * Used only for admin auth operations (inviting users). All domain data still
 * goes through Drizzle + the authz helper.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin client requires URL + service role key.");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
