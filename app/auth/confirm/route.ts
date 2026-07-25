import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

/**
 * Verifies an emailed auth link (invite, magic link, recovery) using the
 * token_hash flow, which — unlike PKCE `code` exchange — works for links
 * generated server-side (admin invites). On success it sets the session cookie
 * and redirects to `next` (forced same-origin to avoid open redirects).
 */
/**
 * The origin this request actually arrived on, taken from the Host header
 * rather than `request.url` (which Next does not guarantee reflects the host
 * the browser used). `verifyOtp`'s Set-Cookie is scoped to that host, so any
 * redirect to a *different* host silently drops the session — this is what made
 * the localhost vs 127.0.0.1 split dead-end invitees at /login.
 */
function requestOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return url.origin;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const origin = requestOrigin(request);

  // Use ONLY the path+query of `next`, always re-based onto `origin`. This
  // prevents open redirects and keeps the session cookie and the destination on
  // the same host.
  let nextPath = "/dashboard";
  const nextParam = requestUrl.searchParams.get("next");
  if (nextParam) {
    try {
      const parsed = new URL(nextParam, origin);
      nextPath = parsed.pathname + parsed.search;
    } catch {
      nextPath = "/dashboard";
    }
  }

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, origin));
    }
  }

  // The link was already used, expired, or malformed. Carry the intended
  // destination so the landing page can explain what to do next.
  const dead = new URL("/link-expired", origin);
  dead.searchParams.set("next", nextPath);
  return NextResponse.redirect(dead);
}
