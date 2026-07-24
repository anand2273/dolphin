import { requireAuthUser, getProfile } from "@/lib/auth/session";
import { ensureProfile } from "@/lib/auth/ensure-profile";
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
  const user = await requireAuthUser();
  await ensureProfile(user);
  const profile = await getProfile(user.id);
  const classes = await listClassesForTutor(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your classes</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {profile?.fullName ?? user.email}
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
          {classes.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No classes yet. Create your first one on the right.
              </CardContent>
            </Card>
          ) : (
            classes.map((klass) => (
              <Card key={klass.id}>
                <CardHeader>
                  <CardTitle className="text-base">{klass.name}</CardTitle>
                  {klass.subject && (
                    <CardDescription>{klass.subject}</CardDescription>
                  )}
                </CardHeader>
              </Card>
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
