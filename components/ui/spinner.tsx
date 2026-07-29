import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const sizes = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-8 w-8",
} as const;

/**
 * The one spinner. Purely decorative: every call site already carries the
 * meaning in adjacent text ("Saving…", "Loading your classes"), so announcing it
 * again would just make a screen reader say the same thing twice.
 */
export function Spinner({
  size = "sm",
  className,
}: {
  size?: keyof typeof sizes;
  className?: string;
}) {
  return (
    <Loader2 aria-hidden className={cn("animate-spin", sizes[size], className)} />
  );
}
