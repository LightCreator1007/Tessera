// Sign in: connect the wallet you signed up with. A verified wallet goes straight back to ?next=.
import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinWallet } from "@/features/join/Join";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <Suspense><JoinWallet signin /></Suspense>;
}
