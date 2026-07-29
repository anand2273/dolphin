import { cn } from "@/lib/utils";

/**
 * The file-type block on a material row. Label comes from the stored filename's
 * extension (metadata only — filenames never touch storage paths), falling back
 * to the recorded MIME subtype.
 */
export function ExtChip({
  filename,
  mimeType,
  className,
}: {
  filename: string;
  mimeType: string;
  className?: string;
}) {
  const dot = filename.lastIndexOf(".");
  const fromName = dot > 0 ? filename.slice(dot + 1) : "";
  const fromMime = mimeType.split("/")[1] ?? "";
  const raw = (fromName || fromMime).slice(0, 4).toUpperCase() || "FILE";

  const isPdf = mimeType === "application/pdf" || raw === "PDF";
  const isImage = mimeType.startsWith("image/");

  return (
    <span
      aria-hidden
      className={cn(
        "w-[38px] flex-none rounded-sm py-2 text-center text-[10px] font-bold tracking-[0.05em]",
        isPdf
          ? "bg-destructive-tint text-destructive"
          : isImage
            ? "bg-primary-tint text-primary"
            : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {raw}
    </span>
  );
}
