import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]",
  {
    variants: {
      variant: {
        quiet: "bg-muted font-medium text-muted-foreground",
        accent: "bg-primary-tint font-semibold text-primary",
        /** Reserved for homework-due; nothing renders it until CP6. */
        due: "bg-amber-tint font-semibold text-amber",
        danger: "bg-destructive-tint font-semibold text-destructive",
      },
    },
    defaultVariants: { variant: "quiet" },
  },
);

export function Pill({
  variant,
  className,
  children,
}: VariantProps<typeof pillVariants> & {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(pillVariants({ variant }), className)}>{children}</span>
  );
}
