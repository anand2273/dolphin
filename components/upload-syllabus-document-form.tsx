"use client";
// Client Component: drives the three-step upload, same shape as
// upload-material-form.tsx (mint -> browser PUT -> confirm), against the
// syllabus-documents bucket instead of materials. Bytes go straight from here
// to storage, never through the Next server.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmSyllabusDocumentUpload,
  requestSyllabusDocumentUpload,
} from "@/app/(tutor)/syllabi/actions";
import {
  SYLLABUS_DOCUMENT_ACCEPT_ATTRIBUTE,
  MAX_FILE_BYTES,
  formatBytes,
} from "@/lib/storage/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useFormDialog } from "@/components/ui/form-dialog";

type Phase = "idle" | "preparing" | "uploading" | "saving";

/** Same reasoning as upload-material-form.tsx: XMLHttpRequest for upload
 * progress events, which `fetch` doesn't have. */
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

export function UploadSyllabusDocumentForm() {
  const router = useRouter();
  const dialog = useFormDialog();
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
    const subject = String(data.get("subject") ?? "").trim();
    const level = String(data.get("level") ?? "").trim();

    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (!title) {
      setError("Title is required.");
      return;
    }
    // Advisory only — the server checks again, and then checks what actually
    // landed.
    if (file.size > MAX_FILE_BYTES) {
      setError(`Files must be under ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }

    setPhase("preparing");
    const ticket = await requestSyllabusDocumentUpload({
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
      if (!put.aborted) setError("The upload failed. Please try again.");
      setPhase("idle");
      return;
    }

    setPhase("saving");
    const saved = await confirmSyllabusDocumentUpload({
      objectKey: ticket.objectKey,
      filename: file.name,
      title,
      subject: subject || undefined,
      level: level || undefined,
    });
    if (saved.error) {
      setError(saved.error);
      setPhase("idle");
      return;
    }

    formRef.current?.reset();
    setPhase("idle");
    setProgress(0);
    dialog?.close();
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
        <Label htmlFor="syllabus-file">File</Label>
        <Input
          id="syllabus-file"
          name="file"
          type="file"
          accept={SYLLABUS_DOCUMENT_ACCEPT_ATTRIBUTE}
          required
        />
        <p className="text-xs text-muted-foreground">
          PDF, Word, or plain text. Up to {formatBytes(MAX_FILE_BYTES)}. We&apos;ll
          extract topics and concepts automatically.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="upload-title">Title</Label>
        <Input
          id="upload-title"
          name="title"
          placeholder="e.g. CIE IGCSE Mathematics 0580"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="upload-subject">Subject</Label>
        <Input id="upload-subject" name="subject" placeholder="Optional" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="upload-level">Level</Label>
        <Input id="upload-level" name="level" placeholder="Optional" />
      </div>

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
