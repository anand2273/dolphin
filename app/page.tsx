import { redirect } from "next/navigation";

export default function Home() {
  // The app is dashboard-first; auth gating happens there.
  redirect("/dashboard");
}
