// Public landing page route, rendered outside the app rail.
import type { Metadata } from "next";
import { Landing } from "@/features/landing/Landing";

export const metadata: Metadata = {
  title: { absolute: "Tessera: train models on idle laptops" },
  description: "Post a training job and idle laptops do the work. Every round is replayed and checked before anyone gets paid.",
};

export default function Page() {
  return <Landing />;
}
