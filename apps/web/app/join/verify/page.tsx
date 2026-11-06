// Sign up, step 2: prove you're one person with World ID.
import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinVerify } from "@/features/join/Join";

export const metadata: Metadata = { title: "Prove you're one person" };

export default function Page() {
  return <Suspense><JoinVerify /></Suspense>;
}
