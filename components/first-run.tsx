import { FormDialog } from "@/components/ui/form-dialog";
import { CreateClassForm } from "@/components/create-class-form";
import { cn } from "@/lib/utils";

const steps = [
  {
    title: "Create a class",
    detail: 'One class per student (or group) per subject — e.g. "IGCSE Maths".',
  },
  {
    title: "Invite your student",
    detail: "They get an email link to join — no account needed beforehand.",
  },
  {
    title: "Add a lesson and attach materials",
    detail: "Worksheets and photos live on the lesson they belong to.",
  },
  {
    title: "Set homework",
    detail: "Students submit back to the same lesson; you review it in the next one.",
  },
];

/** The guided empty state a brand-new tutor lands on instead of a bare list. */
export function FirstRun() {
  return (
    <div className="mx-auto mt-7 flex w-full max-w-[520px] flex-col items-start gap-5 rounded-lg border bg-card p-8 shadow-card">
      <h2 className="text-balance font-display text-[21px] font-semibold tracking-tight">
        Set up your first class
      </h2>
      <p className="text-sm text-muted-foreground">
        Everything in Dolphn hangs off a class: its lessons, the files you
        share, and the homework you set. Here&apos;s the path.
      </p>

      <div className="flex w-full flex-col">
        {steps.map((step, i) => (
          <div key={step.title} className="flex items-start gap-3.5 py-2.5">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 grid size-[26px] flex-none place-items-center rounded-full text-xs font-semibold",
                i === 0
                  ? "bg-primary-tint text-primary"
                  : "bg-muted text-faint",
              )}
            >
              {i + 1}
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{step.title}</span>
              <span className="block text-[12.5px] text-muted-foreground">
                {step.detail}
              </span>
            </span>
          </div>
        ))}
      </div>

      <FormDialog
        trigger="+ Create your first class"
        title="New class"
        description="One class = one ongoing engagement for one subject."
      >
        <CreateClassForm />
      </FormDialog>
    </div>
  );
}
