"use client";
// Client Component: drives the three-step upload. The bytes go straight from
// here to storage, so they never pass through the Next server — that is what
// keeps a 25MB worksheet working on Vercel, whose request bodies cap far lower.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmMaterialUpload,
  requestMaterialUpload,
} from "@/app/sessions/[sessionId]/actions";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
  formatBytes,
} from "@/lib/storage/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type Phase = "idle" | "preparing" | "uploading" | "saving";

/**
 * The PUT is an XMLHttpRequest rather than a `fetch` for one reason: `fetch` has
 * no upload progress events. A 25MB scan over a phone connection is a minute of
 * apparent silence otherwise, which reads as a hang — and the request is exactly
 * the one the tutor most wants to be able to abandon.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  register: (xhr: XMLHttpRequest) => void,
): Promise<{ ok: boolean; aborted: boolean }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, aborted: false });
    xhr.onerror = () => resolve({ ok: false, aborted: false });
    xhr.onabort = () => resolve({ ok: false, aborted: true });
    xhr.send(file);
  });
}

export function UploadMaterialForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const percent = Math.round(progress * 100);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    const title = String(data.get("title") ?? "").trim();

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    // Advisory only — the server checks again, and then checks what actually
    // landed. This just saves a pointless round trip.
    if (file.size > MAX_FILE_BYTES) {
      setError(`Files must be under ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }

    setPhase("preparing");
    const ticket = await requestMaterialUpload({
      sessionId,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!ticket.ok) {
      setError(ticket.error);
      setPhase("idle");
      return;
    }

    setPhase("uploading");
    setProgress(0);
    const put = await putWithProgress(
      ticket.signedUrl,
      file,
      setProgress,
      (xhr) => (xhrRef.current = xhr),
    );
    xhrRef.current = null;
    if (!put.ok) {
      // A cancelled upload leaves an orphan object and no rows — the same state
      // as any abandoned upload, since step 1 writes nothing to the database.
      if (!put.aborted) setError("The upload failed. Please try again.");
      setPhase("idle");
      return;
    }

    setPhase("saving");
    const saved = await confirmMaterialUpload({
      sessionId,
      objectKey: ticket.objectKey,
      filename: file.name,
      title: title || undefined,
    });
    if (saved.error) {
      setError(saved.error);
      setPhase("idle");
      return;
    }

    formRef.current?.reset();
    setPhase("idle");
    setProgress(0);
    router.refresh();
  }

  const label =
    phase === "preparing"
      ? "Preparing…"
      : phase === "uploading"
        ? `Uploading… ${percent}%`
        : phase === "saving"
          ? "Saving…"
          : "Upload";

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="file">File</Label>
        <Input id="file" name="file" type="file" accept={ACCEPT_ATTRIBUTE} required />
        <p className="text-xs text-muted-foreground">
          PDF, images, Office documents. Up to {formatBytes(MAX_FILE_BYTES)}.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="materialTitle">Title</Label>
        <Input id="materialTitle" name="title" placeholder="Defaults to the filename" />
      </div>

      {/* Determinate only while bytes are actually moving; the surrounding
          server round trips are sub-second and stay indeterminate. */}
      {phase === "uploading" && (
        <div className="space-y-2">
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${percent}%` }}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => xhrRef.current?.abort()}
          >
            Cancel upload
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        {label}
      </Button>
    </form>
  );
}
