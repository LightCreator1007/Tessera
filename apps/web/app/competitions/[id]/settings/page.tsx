// The host's settings for a competition: banner, details, rules and files such as RL environments.
import { HostSettings } from "@/features/competitions/HostSettings";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HostSettings id={id} />;
}
