import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { getSessionForViewer } from "@/lib/db/queries/sessions";
import { SessionDateTime, SessionWhen } from "@/components/session-datetime";
import { EditSessionPanel } from "@/components/edit-session-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The session detail page — the organising screen of the app. One route serves
 * both roles: `getSessionForViewer` resolves the viewer's standing in the owning
 * class exactly once, and the tutor-only controls hang off that result. Keeping
 * it as a single route means the read rule cannot drift between two copies.
 *
 * Materials and Assignments are the next checkpoints; their sections are here as
 * empty placeholders so the shape of the page is visible, with no behaviour.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const user = await requireAuthUser();

  const found = await getSessionForViewer(user.id, sessionId);
  // Missing, soft-deleted, and not-yours are all 404 — never leak existence.
  if (!found) notFound();

  const { session, klass, relationship } = found;
  const isOwner = relationship === "owner";

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <Link
          href={isOwner ? `/classes/${klass.id}` : "/student"}
          className="text-sm text-muted-foreground underline"
        >
          ← {klass.name}
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">
              {session.title ?? "Untitled lesson"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <SessionDateTime
                at={session.scheduledAt}
                tutorTimezone={session.timezone}
              />
            </p>
          </div>
          <SessionWhen at={session.scheduledAt} />
        </div>
      </div>

      {isOwner && (
        <EditSessionPanel
          sessionId={session.id}
          title={session.title}
          scheduledAt={session.scheduledAt.toISOString()}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Materials</h2>
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No materials yet.
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Homework</h2>
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            No homework issued in this lesson.
          </CardContent>
        </Card>
      </section>

      {!isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your tutor runs this lesson</CardTitle>
            <CardDescription>
              Materials and homework will appear here once your tutor adds them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}
