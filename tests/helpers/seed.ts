import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { classes, profiles } from "@/lib/db/schema";

/**
 * Admin Supabase client (service-role) — TEST ONLY. Used to create real
 * auth.users rows so profiles' FK is satisfied, exactly as production signup
 * would. Never import this outside tests.
 */
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export type TestUser = { id: string; email: string };

/** Create a real GoTrue user + matching profile row. Returns the user id. */
export async function createTestUser(
  label: string,
  role: "tutor" | "student" = "tutor",
): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@test.local`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: "password12345",
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message}`);
  }

  await db
    .insert(profiles)
    .values({ id: data.user.id, email, role })
    .onConflictDoNothing({ target: profiles.id });

  return { id: data.user.id, email };
}

/** Insert a class owned by the given tutor. Returns the class id. */
export async function createTestClass(
  tutorId: string,
  name = "Test Class",
): Promise<string> {
  const [row] = await db
    .insert(classes)
    .values({ tutorId, name })
    .returning({ id: classes.id });
  return row.id;
}

/** Tear down a test user: their classes, profile, and the auth.users row. */
export async function deleteTestUser(user: TestUser) {
  await db.delete(classes).where(eq(classes.tutorId, user.id));
  await db.delete(profiles).where(eq(profiles.id, user.id));
  await admin.auth.admin.deleteUser(user.id);
}
