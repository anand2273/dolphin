"use client";
// Client Component, renders nothing: while extraction is in flight it polls
// router.refresh() so the (server-rendered) detail page picks up the worker's
// eventual done/failed write. There's no dedicated status endpoint to
// subscribe to — this just re-fetches the same query the page already runs.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Syllabus } from "@/lib/db/queries/syllabuses";

const POLL_MS = 4000;

export function SyllabusExtractionPoller({
  status,
}: {
  status: Syllabus["extractionStatus"];
}) {
  const router = useRouter();
  const inFlight = status === "pending" || status === "processing";

  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, router]);

  return null;
}
