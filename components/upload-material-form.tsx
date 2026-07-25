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

type Phase = "idle" | "preparing" | "uploading" | "saving";

export function UploadMaterialForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

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
    const put = await fetch(ticket.signedUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!put.ok) {
      setError("The upload failed. Please try again.");
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
    router.refresh();
  }

  const label =
    phase === "preparing"
      ? "Preparing…"
      : phase === "uploading"
        ? "Uploading…"
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy}>
        {label}
      </Button>
    </form>
  );
}
