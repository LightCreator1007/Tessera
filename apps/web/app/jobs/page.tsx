// Jobs list route. ?scope=yours|all picks the lens; without it, the page picks Yours when you own any job.
import { JobsPage } from "@/features/jobs/JobsPage";

export const metadata = { title: "Jobs" };
export default async function Page({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  return <JobsPage scope={scope === "yours" || scope === "all" ? scope : undefined} />;
}
