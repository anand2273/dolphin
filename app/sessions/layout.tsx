import { requireAuthUser, getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";
import { TopBar } from "@/components/top-bar";

/** Shell for the shared session route, which serves both roles — the home
 *  link resolves per viewer instead of assuming a role. */
export default async function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAuthUser();
  const profile = await getProfile(user.id);
  return (
    <>
      <TopBar
        name={profile?.fullName ?? user.email}
        homeHref={homeForRole(profile?.role)}
      />
      {children}
    </>
  );
}
