import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { LoginForm } from "@/components/login-form";
import { AuthShell } from "@/components/auth-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage() {
  const user = await getAuthUser();
  if (user) redirect(homeForRole((await getProfile(user.id))?.role));

  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">Sign in to Dolphn</CardTitle>
        <CardDescription>Welcome back.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </AuthShell>
  );
}
