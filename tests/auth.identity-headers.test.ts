import { describe, expect, it } from "vitest";
import { config as middlewareConfig } from "@/middleware";
import { IDENTITY_HEADERS } from "@/lib/auth/identity-headers";

/**
 * getAuthUser trusts the identity headers because middleware deletes any
 * inbound copy before forwarding. That holds only while middleware actually
 * runs on the routes that read them, so the matcher is a security boundary, not
 * a performance tweak.
 *
 * If someone narrows the matcher and a route below stops matching, this fails —
 * which is the point. A route outside the matcher would receive whatever
 * identity headers the *client* sent, unstripped.
 */
describe("middleware identity-header boundary", () => {
  const matchers = middlewareConfig.matcher;
  const patterns = (Array.isArray(matchers) ? matchers : [matchers]).map(
    (m) => new RegExp(`^${m}$`),
  );
  const covered = (path: string) => patterns.some((re) => re.test(path));

  // Every route whose render calls getAuthUser (directly or via a guard).
  const authenticatedRoutes = [
    "/",
    "/dashboard",
    "/student",
    "/syllabi",
    "/syllabi/8bab16af-5afb-4736-b860-e6a3f05cebfc",
    "/classes/8bab16af-5afb-4736-b860-e6a3f05cebfc",
    "/sessions/ecc9510f-1a07-4166-bf87-fced8b2feff4",
    "/invite/accept/sometoken",
    "/api/materials/8bab16af-5afb-4736-b860-e6a3f05cebfc/download",
    "/login",
    "/signup",
    "/signup/student",
    "/reset-password",
    "/auth/confirm",
  ];

  it.each(authenticatedRoutes)(
    "middleware runs on %s, so client identity headers are stripped",
    (path) => {
      expect(covered(path)).toBe(true);
    },
  );

  it("strips every header getAuthUser is willing to trust", async () => {
    // Guards against adding a header to identity-headers.ts and reading it in
    // session.ts without also deleting it in updateSession.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/auth/supabase-middleware.ts", "utf8"),
    );
    // The loop deletes the whole exported list; assert that is still how it is
    // done, rather than an inline subset that could drift.
    expect(source).toMatch(
      /for\s*\(const\s+header\s+of\s+IDENTITY_HEADERS\)\s*forwarded\.delete\(header\)/,
    );
    expect(IDENTITY_HEADERS.length).toBeGreaterThan(0);
  });

  it("does not run on static assets, which never read identity", () => {
    expect(covered("/_next/static/chunks/main-app.js")).toBe(false);
    expect(covered("/favicon.ico")).toBe(false);
    expect(covered("/logo.png")).toBe(false);
  });
});
