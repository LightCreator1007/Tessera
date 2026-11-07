// Host an RL competition: verifiers run each entrant's policy on hidden seeds and the contract pays the best return.
import { RLHost } from "@/features/competitions/rl/RLHost";

export const metadata = { title: "Host an RL competition" };
export default function Page() {
  return <RLHost />;
}
