// Stack route: World ID, Swarm and Arkiv shown on live data.
import { Suspense } from "react";
import { StackPage } from "@/features/stack/StackPage";

export const metadata = { title: "Stack" };
export default function Page() {
  return (
    <Suspense>
      <StackPage />
    </Suspense>
  );
}
