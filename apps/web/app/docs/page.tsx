// Docs index: the two quickstarts first, then reference.
import type { Metadata } from "next";
import { PosterCard } from "@/components/mosaic/PosterCard";
import { DocTitle } from "@/features/docs/DocsFrame";
import { DOCS } from "@/features/docs/pages";

export const metadata: Metadata = { title: "Docs" };

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="Docs" title="Train a model on idle laptops, or lend yours to pay for it.">
        Start with the first quickstart. The second one turns a laptop into a node, and its earnings pay for your next job.
      </DocTitle>
      <ul className="grid gap-4 sm:grid-cols-2">
        {DOCS.map((d, k) => (
          <li key={d.href} className="flex">
            <PosterCard href={d.href} n={String(k + 1).padStart(2, "0")} title={d.title} note={d.sub} thumb="h-32" />
          </li>
        ))}
      </ul>
    </>
  );
}
