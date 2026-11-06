// Job page route. Tab lives in ?tab so every section is linkable.
import { JobPage } from "@/features/job/JobPage";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <JobPage id={Number(id)} tab={tab} />;
}
