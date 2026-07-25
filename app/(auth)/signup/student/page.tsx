import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { SignupForm } from "@/components/signup-form";
import { signUpStudent } from "@/app/(auth)/actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function StudentSignupPage() {
  const user = await getAuthUser();
  if (user) redirect(homeForRole((await getProfile(user.id))?.role));

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create a student account</CardTitle>
          <CardDescription>
            Sign up here. Your tutor invites you to a class separately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm
            action={signUpStudent}
            submitLabel="Create student account"
            altHref="/login"
            altLabel="Already have an account? Sign in"
          />
        </CardContent>
      </Card>
    </main>
  );
}
