import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthUser } from "@/lib/auth/session";
import { getSessionForViewer } from "@/lib/db/queries/sessions";
import { listMaterialsForSession } from "@/lib/db/queries/materials";
import { formatBytes } from "@/lib/storage/config";
import { SessionDateTime, SessionWhen } from "@/components/session-datetime";
import { EditSessionPanel } from "@/components/edit-session-panel";
import { UploadMaterialForm } from "@/components/upload-material-form";
import { deleteMaterial } from "./actions";
import { Button, buttonVariants } from "@/components/ui/button";
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
 * Materials are live (CP5): the tutor uploads, both roles download through the
 * authorizing route. Homework is CP6 and remains an empty placeholder.
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

  const sessionMaterials = await listMaterialsForSession(user.id, session.id);

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
        <h2 className="text-sm font-medium text-muted-foreground">
          Materials ({sessionMaterials.length})
        </h2>

        {sessionMaterials.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              {isOwner
                ? "No materials yet. Upload one below."
                : "Your tutor hasn't added any materials to this lesson."}
            </CardContent>
          </Card>
        ) : (
          sessionMaterials.map((m) => (
            <Card key={m.materialId}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.title ?? m.originalFilename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.originalFilename} · {formatBytes(m.sizeBytes)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Plain link: the route authorizes, then redirects to a
                      short-lived signed URL. No signed URL is ever rendered
                      into the page itself. */}
                  <a
                    href={`/api/materials/${m.materialId}/download`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Download
                  </a>
                  {isOwner && (
                    <form action={deleteMaterial.bind(null, m.materialId)}>
                      <Button variant="ghost" size="sm" type="submit">
                        Remove
                      </Button>
                    </form>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {isOwner && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add material</CardTitle>
              <CardDescription>
                Students in this class can download it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadMaterialForm sessionId={session.id} />
            </CardContent>
          </Card>
        )}
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
