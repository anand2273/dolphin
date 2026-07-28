import { headers } from "next/headers";

/**
 * The origin this request actually arrived on, taken from the Host header
 * rather than any configured site URL.
 *
 * Every `redirectTo` we hand Supabase is built from this. An emailed auth link
 * must stay on ONE origin end to end, because the session cookie `verifyOtp`
 * sets is host-scoped: `localhost:3000` and `127.0.0.1:3000` are different
 * accounts as far as the browser is concerned, so a link minted on one and
 * landed on the other drops the session silently.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}
