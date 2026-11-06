// The old sign-up address; it moved to /join, which keeps ?next=.
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const n = (await searchParams).next;
  const next = safeNext(typeof n === "string" ? n : null);
  redirect(next ? `/join?next=${encodeURIComponent(next)}` : "/join");
}
