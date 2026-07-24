"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { classes } from "@/lib/db/schema";
import { requireAuthUser, getProfile } from "@/lib/auth/session";
import { assertTutor } from "@/lib/auth/roles";
import { recordEvent } from "@/lib/db/events";
import { createClassSchema } from "@/lib/validation/class";
import type { FormState } from "@/lib/types";

/** parse -> authorize -> mutate -> revalidate (CLAUDE.md action contract). */
export async function createClass(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  // 1. parse
  const parsed = createClassSchema.safeParse({
    name: formData.get("name"),
    subject: formData.get("subject"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // 2. authorize — TUTORS ONLY. Students can never create classes.
  const user = await requireAuthUser();
  const profile = await getProfile(user.id);
  try {
    assertTutor(profile?.role);
  } catch {
    return { error: "Only tutors can create classes." };
  }

  // 3. mutate (row + its event, atomically)
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(classes)
      .values({
        tutorId: user.id,
        name: parsed.data.name,
        subject: parsed.data.subject ?? null,
      })
      .returning({ id: classes.id });

    await recordEvent(
      {
        actorId: user.id,
        verb: "class.created",
        subjectType: "class",
        subjectId: created.id,
      },
      tx,
    );
  });

  // 4. revalidate
  revalidatePath("/dashboard");
  return { ok: true };
}
