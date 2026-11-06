// Dev-only: mosaic playground, isometric diagrams.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { IsoPage } from "@/features/mosaic/pages/IsoPage";

export const metadata: Metadata = { title: "Mosaic · isometric" };
export default function Page() {
  return (
    <MosaicShell>
      <IsoPage />
    </MosaicShell>
  );
}
