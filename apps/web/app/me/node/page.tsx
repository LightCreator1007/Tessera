// Old "my node" route. The node lives in localStorage-backed wallet state, so the redirect has to happen in the browser.
import { MyNodeRedirect } from "@/features/node/OwnerNode";

export default function Page() {
  return <MyNodeRedirect />;
}
