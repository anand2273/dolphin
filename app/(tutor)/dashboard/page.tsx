import Link from "next/link";
import { requireTutor } from "@/lib/auth/guards";
import { listClassesForTutor } from "@/lib/db/queries/classes";
import { CreateClassForm } from "@/components/create-class-form";
import { Notice } from "@/components/notice";
import { resolveNotice } from "@/lib/notices";
import { Page, PageHeader } from "@/components/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  // Never rendered raw — resolveNotice maps a known key to our own copy.
  const notice = resolveNotice((await searchParams).notice);
  const { user } = await requireTutor();
  const classes = await listClassesForTutor(user.id);

  return (
    <Page>
      {notice && <Notice message={notice} />}

      <PageHeader title="Your classes" />

      <section className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Teaching</h2>
          {classes.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No classes yet. Create your first one on the right.
              </CardContent>
            </Card>
          ) : (
            classes.map((klass) => (
              <Link key={klass.id} href={`/classes/${klass.id}`} className="block">
                <Card className="transition-colors hover:border-ring">
                  <CardHeader>
                    <CardTitle className="text-base">{klass.name}</CardTitle>
                    {klass.subject && (
                      <CardDescription>{klass.subject}</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            ))
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">New class</CardTitle>
            <CardDescription>
              One class = one ongoing engagement for one subject.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateClassForm />
          </CardContent>
        </Card>
      </section>
    </Page>
  );
}
