// Dev-only: mosaic playground, covers.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { CoversPage } from "@/features/mosaic/pages/CoversPage";

export const metadata: Metadata = { title: "Mosaic · covers" };
export default function Page() {
  return (
    <MosaicShell>
      <CoversPage />
    </MosaicShell>
  );
}
