// Sign up, step 1: connect a wallet.
import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinWallet } from "@/features/join/Join";

export const metadata: Metadata = { title: "Sign up" };

export default function Page() {
  return <Suspense><JoinWallet /></Suspense>;
}
