import { requireStudent } from "@/lib/auth/guards";
import { TopBar } from "@/components/top-bar";

/** Shell for the student area. */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireStudent();
  return (
    <>
      <TopBar name={profile?.fullName ?? user.email} homeHref="/student" />
      {children}
    </>
  );
}
