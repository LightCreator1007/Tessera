// Profile: the connected wallet's roles, identity and posters. ?tab=jobs is the old jobs list and still redirects.
import { redirect } from "next/navigation";
import { Profile } from "@/features/me/Profile";

export const metadata = { title: "Profile" };
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  if (tab === "jobs") redirect("/jobs?scope=yours");
  if (tab) redirect("/balance");
  return <Profile />;
}
