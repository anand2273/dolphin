import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

/**
 * Verifies an emailed auth link (invite, magic link, recovery) using the
 * token_hash flow, which — unlike PKCE `code` exchange — works for links
 * generated server-side (admin invites). On success it sets the session cookie
 * and redirects to `next` (forced same-origin to avoid open redirects).
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const nextParam = requestUrl.searchParams.get("next") ?? "/dashboard";

  // Use ONLY the path+query of `next`, always redirected onto the current
  // origin. This prevents open redirects AND survives the localhost vs
  // 127.0.0.1 host split (Supabase may render the link on a different host than
  // the redirect target — comparing full origins would wrongly drop `next`).
  let nextPath = "/dashboard";
  try {
    const parsed = new URL(nextParam, requestUrl);
    nextPath = parsed.pathname + parsed.search;
  } catch {
    nextPath = "/dashboard";
  }

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, requestUrl));
    }
  }

  return NextResponse.redirect(new URL("/login?error=invalid_link", requestUrl));
}
