import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { SignupForm } from "@/components/signup-form";
import { signUp } from "@/app/(auth)/actions";
import { AuthShell } from "@/components/auth-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function SignupPage() {
  const user = await getAuthUser();
  if (user) redirect(homeForRole((await getProfile(user.id))?.role));

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">Create a tutor account</CardTitle>
        <CardDescription>Set up your tutoring workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm
          action={signUp}
          submitLabel="Create tutor account"
          altHref="/login"
          altLabel="Already have an account? Sign in"
        />
      </CardContent>
    </AuthShell>
  );
}
