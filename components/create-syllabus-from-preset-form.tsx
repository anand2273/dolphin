"use client";
// Client Component: radio picker over the static preset fixtures, then submits
// just the chosen key — the deep-copy happens server-side.

import { useActionState, useEffect, useId, useState } from "react";
import { createSyllabusFromPreset } from "@/app/(tutor)/syllabi/actions";
import { SYLLABUS_PRESETS } from "@/lib/syllabus-presets";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useFormDialog } from "@/components/ui/form-dialog";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/types";

export function CreateSyllabusFromPresetForm() {
  const dialog = useFormDialog();
  const name = useId();
  const [selected, setSelected] = useState(SYLLABUS_PRESETS[0]?.key ?? "");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createSyllabusFromPreset,
    {},
  );

  useEffect(() => {
    if (state.ok) dialog?.close();
  }, [state, dialog]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        {SYLLABUS_PRESETS.map((preset) => {
          const conceptCount = preset.topics.reduce(
            (sum, t) => sum + (t.concepts?.length ?? 0),
            0,
          );
          const active = selected === preset.key;
          return (
            <label
              key={preset.key}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-sm border px-3 py-2.5",
                active ? "border-primary bg-primary-tint" : "border-input",
              )}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={preset.key}
                  checked={active}
                  onChange={() => setSelected(preset.key)}
                  className="accent-current"
                />
                <span className="text-sm font-medium">{preset.title}</span>
              </span>
              <span className="pl-5 text-[12.5px] text-muted-foreground">
                {[preset.subject, preset.level].filter(Boolean).join(" · ")}
                {" — "}
                {preset.topics.length} topics, {conceptCount} concepts
              </span>
            </label>
          );
        })}
      </div>
      <input type="hidden" name="presetKey" value={selected} />
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending || !selected}>
        {pending && <Spinner />}
        {pending ? "Creating…" : "Create syllabus"}
      </Button>
    </form>
  );
}
