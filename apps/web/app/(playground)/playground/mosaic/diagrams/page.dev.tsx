// Dev-only: mosaic playground, diagrams.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { DiagramsPage } from "@/features/mosaic/pages/DiagramsPage";

export const metadata: Metadata = { title: "Mosaic · diagrams" };
export default function Page() {
  return (
    <MosaicShell>
      <DiagramsPage />
    </MosaicShell>
  );
}
