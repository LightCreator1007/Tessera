// Sign up: wallet, World ID once, then a first step.
import type { Metadata } from "next";
import { Suspense } from "react";
import { Welcome } from "@/features/welcome/Welcome";

export const metadata: Metadata = { title: "Sign up" };

export default function Page() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}
