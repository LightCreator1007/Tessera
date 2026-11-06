// Dev-only: mosaic playground, isometric diagrams placed in the app's real surfaces.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { InAppPage } from "@/features/mosaic/pages/InAppPage";

export const metadata: Metadata = { title: "Mosaic · in the app" };
export default function Page() {
  return (
    <MosaicShell>
      <InAppPage />
    </MosaicShell>
  );
}
