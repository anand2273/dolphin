import Link from "next/link";
import { requireTutor } from "@/lib/auth/guards";
import { listClassesForTutor } from "@/lib/db/queries/classes";
import { signOut } from "@/app/(auth)/actions";
import { CreateClassForm } from "@/components/create-class-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage() {
  const { user, profile } = await requireTutor();
  const classes = await listClassesForTutor(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your classes</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {profile.fullName ?? user.email}
          </p>
        </div>
        <form action={signOut}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </header>

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
    </main>
  );
}
