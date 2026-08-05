import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, deleteTestUser, type TestUser } from "./helpers/seed";

/**
 * The reset flow's authorization rule, and specifically its negative half.
 *
 * A recovery link is a sign-in — `verifyOtp` returns an ordinary session — so
 * "has a session" is NOT sufficient authority to set a new password. If it were,
 * /reset-password would be a change-password form with no old-password prompt,
 * and any unattended signed-in browser would be an account takeover. The gate is
 * session AND a recovery marker minted for that same user; these tests exist to
 * stop anyone "simplifying" it back to one condition.
 */

// A stand-in cookie jar. next/headers' cookies() only works inside a request.
const jar = new Map<string, string>();
// headers() returns an empty set, so getAuthUser finds no forwarded identity
// and falls back to a real auth.getUser() — the path these tests drive via
// signedInAs(). See lib/auth/identity-headers.ts.
const requestHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => ({
    get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null,
  }),
}));

// redirect() throws in Next; mirror that so the action's success path is
// observable instead of hanging.
class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectError(to);
  },
}));

const auth = {
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

const { resetPassword } = await import("@/app/(auth)/actions");
const { markRecoverySession, hasRecoverySession, clearRecoverySession } =
  await import("@/lib/auth/recovery");

function form(password: string) {
  const fd = new FormData();
  fd.set("password", password);
  return fd;
}

/** Assert nothing was written — the point of every negative case below. */
function expectNoPasswordWrite() {
  expect(auth.updateUser).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
}

describe("recovery marker", () => {
  beforeEach(() => jar.clear());

  it("is absent until /auth/confirm mints one", async () => {
    expect(await hasRecoverySession("user-a")).toBe(false);
  });

  it("is honoured for the user it was minted for", async () => {
    await markRecoverySession("user-a");
    expect(await hasRecoverySession("user-a")).toBe(true);
  });

  it("is NOT honoured for a different user on the same browser", async () => {
    await markRecoverySession("user-a");
    expect(await hasRecoverySession("user-b")).toBe(false);
  });

  it("stops being honoured once spent", async () => {
    await markRecoverySession("user-a");
    await clearRecoverySession();
    expect(await hasRecoverySession("user-a")).toBe(false);
  });
});

describe("resetPassword", () => {
  let student: TestUser;
  let tutor: TestUser;

  beforeAll(async () => {
    student = await createTestUser("reset-student", "student");
    tutor = await createTestUser("reset-tutor", "tutor");
  });

  afterAll(async () => {
    await deleteTestUser(student);
    await deleteTestUser(tutor);
  });

  beforeEach(() => {
    jar.clear();
    auth.getUser.mockReset();
    auth.updateUser.mockReset().mockResolvedValue({ error: null });
    auth.signOut.mockReset().mockResolvedValue({ error: null });
  });

  const signedInAs = (user: TestUser) =>
    auth.getUser.mockResolvedValue({
      data: { user: { id: user.id, email: user.email } },
    });

  it("refuses when there is no session at all", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await markRecoverySession(student.id);

    const result = await resetPassword({}, form("brand-new-password"));

    expect(result.error).toMatch(/expired/i);
    expectNoPasswordWrite();
  });

  it("REFUSES a valid session with no recovery marker", async () => {
    // The takeover case: someone else's signed-in browser, no reset email.
    signedInAs(student);

    const result = await resetPassword({}, form("brand-new-password"));

    expect(result.error).toMatch(/expired/i);
    expectNoPasswordWrite();
  });

  it("REFUSES a marker minted for a different user", async () => {
    signedInAs(student);
    await markRecoverySession(tutor.id);

    const result = await resetPassword({}, form("brand-new-password"));

    expect(result.error).toMatch(/expired/i);
    expectNoPasswordWrite();
  });

  it("rejects a short password before touching auth", async () => {
    signedInAs(student);
    await markRecoverySession(student.id);

    const result = await resetPassword({}, form("short"));

    expect(result.error).toMatch(/8 characters/);
    expectNoPasswordWrite();
  });

  it("writes the password, revokes OTHER sessions, and lands on the role home", async () => {
    signedInAs(student);
    await markRecoverySession(student.id);

    await expect(resetPassword({}, form("brand-new-password"))).rejects.toThrow(
      /redirect:\/student/,
    );

    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "brand-new-password",
    });
    // "others", never a full sign-out: the person resetting stays signed in
    // here while anyone holding a stolen session is cut loose.
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("sends a tutor to the tutor home", async () => {
    signedInAs(tutor);
    await markRecoverySession(tutor.id);

    await expect(resetPassword({}, form("brand-new-password"))).rejects.toThrow(
      /redirect:\/dashboard/,
    );
  });

  it("spends the marker, so a replayed submit is refused", async () => {
    signedInAs(student);
    await markRecoverySession(student.id);
    await expect(resetPassword({}, form("brand-new-password"))).rejects.toThrow(
      /redirect:/,
    );

    auth.updateUser.mockClear();
    auth.signOut.mockClear();

    const replay = await resetPassword({}, form("another-new-password"));

    expect(replay.error).toMatch(/expired/i);
    expectNoPasswordWrite();
  });
});
