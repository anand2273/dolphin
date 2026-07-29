"use client";
// Client Component: owns the open state of the add-material disclosure. A
// dialog would be wrong here — the upload's progress bar and its Cancel must
// stay on the page while bytes move, so the form expands inside the panel.

import { useState } from "react";
import { AddRow } from "@/components/ui/panel";
import { UploadMaterialForm } from "@/components/upload-material-form";

export function AddMaterialRow({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return <AddRow onClick={() => setOpen(true)}>+ Add material</AddRow>;
  }

  // Once open it stays open: unmounting mid-upload would abort the transfer,
  // and after one upload the tutor often adds another.
  return (
    <div className="border-dashed border-border-strong px-4 py-4">
      <UploadMaterialForm sessionId={sessionId} />
    </div>
  );
}
