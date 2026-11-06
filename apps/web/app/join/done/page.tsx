// Sign up, step 3: pick where to start.
import type { Metadata } from "next";
import { Suspense } from "react";
import { JoinDone } from "@/features/join/Join";

export const metadata: Metadata = { title: "You're in" };

export default function Page() {
  return <Suspense><JoinDone /></Suspense>;
}
