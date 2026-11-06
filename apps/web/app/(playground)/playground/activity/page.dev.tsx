// Dev-only route (the .dev.tsx extension is a page only under next dev, see next.config.ts): the activity playground.
import type { Metadata } from "next";
import { PlaygroundActivity } from "@/features/activity/playground/PlaygroundActivity";

export const metadata: Metadata = { title: "Activity playground" };

export default function Page() {
  return <PlaygroundActivity />;
}
