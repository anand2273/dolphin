import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { SignupForm } from "@/components/signup-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SignupPage() {
  if (await getAuthUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your TutorOS account</CardTitle>
          <CardDescription>Set up your tutoring workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
