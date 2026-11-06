// The seven concepts the product teaches where they are used. Each popover holds one sentence and one fact, then hands off to its lesson.
export type TermKey = "round" | "shard" | "commit-reveal" | "replay" | "poison" | "slash" | "bond";

export const LESSONS = [
  { slug: "rounds", n: 1, title: "How a job trains across laptops", sub: "Rounds and shards" },
  { slug: "no-faking", n: 2, title: "Why nobody can fake work", sub: "Commit, then reveal" },
  { slug: "replay", n: 3, title: "How replay catches lazy nodes", sub: "Run a replay in this browser" },
  { slug: "poison", n: 4, title: "How poisoning is caught", sub: "The update that pulls away" },
  { slug: "pay", n: 5, title: "How pay is split", sub: "Drag the loss deltas" },
  { slug: "money", n: 6, title: "Your money", sub: "Held, withdrawable, slashable" },
] as const;
export type LessonSlug = (typeof LESSONS)[number]["slug"];

export const GLOSSARY: Record<TermKey, { term: string; line: string; fact: string; lesson: LessonSlug }> = {
  round: { term: "Round", line: "One pass of training: a few laptops each train a slice, the results are checked, then merged.", fact: "About 2 minutes on a laptop", lesson: "rounds" },
  shard: { term: "Shard", line: "The slice of this round's data one node trains on. Nobody gets to pick theirs.", fact: "Assigned by a seed drawn after commits", lesson: "rounds" },
  "commit-reveal": { term: "Commit, then reveal", line: "A node posts a fingerprint of its result first and shows the result after, so it can't copy anyone.", fact: "A reveal must hash to its commit", lesson: "no-faking" },
  replay: { term: "Replay", line: "Two verifiers re-run a random slice of a node's work. If the result doesn't match bit for bit, the round fails.", fact: "1 segment of 8, picked at random", lesson: "replay" },
  poison: { term: "Poison detection", line: "Replay proves work was done, not that it was honest. Updates that pull away from the rest are left out.", fact: "Ranked against every other update", lesson: "poison" },
  slash: { term: "Slash", line: "A node caught cheating loses stake it holds in the registry. Earnings already claimed are not touched.", fact: "Only held funds can be slashed", lesson: "money" },
  bond: { term: "Bond", line: "The stake a node keeps in the registry while it is in the pool. It is what a cheater would lose.", fact: "15 TOD today", lesson: "money" },
};
