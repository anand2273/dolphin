"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { classes } from "@/lib/db/schema";
import { requireAuthUser } from "@/lib/auth/session";
import { ensureProfile } from "@/lib/auth/ensure-profile";
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

  // 2. authorize — any authenticated user may create a class and becomes its
  // tutor. (Roles are contextual; this is the only class action open to all.)
  const user = await requireAuthUser();
  await ensureProfile(user);

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
