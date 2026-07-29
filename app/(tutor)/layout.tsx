import { requireTutor } from "@/lib/auth/guards";
import { TopBar } from "@/components/top-bar";

/** Shell for the tutor area. The pages re-run the same guard; cache() on the
 *  session helpers keeps that to one lookup per request. */
export default async function TutorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireTutor();
  return (
    <>
      <TopBar name={profile.fullName ?? user.email} homeHref="/dashboard" />
      {children}
    </>
  );
}
