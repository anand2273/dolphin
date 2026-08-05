import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  IDENTITY_HEADERS,
  IDENTITY_HEADER_USER_EMAIL,
  IDENTITY_HEADER_USER_ID,
} from "./identity-headers";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase auth session on every request and rewrites the
 * response cookies. Must run in middleware so Server Components see a fresh
 * token. Do not add logic between createServerClient and getUser().
 *
 * It also forwards the verified user on request headers (see
 * ./identity-headers), so the render pass does not repeat the same GoTrue
 * lookup. `cache()` in session.ts cannot dedupe that second call, because
 * middleware and the render are separate runtimes.
 *
 * Cookies are collected and written to a single response built at the end
 * rather than to a response rebuilt inside setAll — the forwarded headers have
 * to be the final ones, and rebuilding mid-flight would drop them.
 */
export async function updateSession(request: NextRequest) {
  const pendingCookies: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          // Mutating request.cookies keeps a later getAll() in this same pass
          // consistent, and updates the cookie header we forward below.
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          pendingCookies.push(...cookiesToSet);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Snapshot AFTER the refresh above so the forwarded cookie header carries the
  // new token, not the expired one.
  const forwarded = new Headers(request.headers);
  // Strip any client-supplied copy unconditionally — this is the whole basis on
  // which the render pass is allowed to trust these headers.
  for (const header of IDENTITY_HEADERS) forwarded.delete(header);
  if (user?.email) {
    forwarded.set(IDENTITY_HEADER_USER_ID, user.id);
    forwarded.set(IDENTITY_HEADER_USER_EMAIL, user.email);
  }

  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }

  return response;
}
