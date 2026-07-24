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

  // Only allow same-origin redirect targets.
  const dest = new URL(nextParam, requestUrl);
  const safeNext =
    dest.origin === requestUrl.origin ? dest : new URL("/dashboard", requestUrl);

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(safeNext);
    }
  }

  return NextResponse.redirect(new URL("/login?error=invalid_link", requestUrl));
}
