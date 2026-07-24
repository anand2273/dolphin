import { redirect } from "next/navigation";
import { getAuthUser, getProfile } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/roles";

export default async function Home() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const profile = await getProfile(user.id);
  redirect(homeForRole(profile?.role));
}
