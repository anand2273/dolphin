import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { AuthShell } from "@/components/auth-card";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Serves both roles: tutors and students both hold passwords.
 *
 * Unlike /login this does NOT bounce an already-signed-in user to their home.
 * Emailing yourself a reset link is, for now, the only way to change a password
 * you still know — the in-app version belongs with profile editing (US-T13).
 */
export default async function ForgotPasswordPage() {
  return (
    <AuthShell>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>
          Enter the email you sign in with and we&apos;ll send you a link to set
          a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
      </CardContent>
    </AuthShell>
  );
}
