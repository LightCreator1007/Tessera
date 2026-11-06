// Public record of any address: nodes, verified work, jobs, competitions and posters. Your own address adds what needs you.
import { AddressPage } from "@/features/me/Profile";

export const metadata = { title: "Profile" };
export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <AddressPage address={address} />;
}
