// The activation surface: a recorded round replayed with no wallet, ending in a check the reader runs in their own browser.
import { DemoReplay } from "@/features/demo/DemoReplay";

export const metadata = { title: "Watch a lazy node get caught" };
export default function Page() {
  return <DemoReplay />;
}
