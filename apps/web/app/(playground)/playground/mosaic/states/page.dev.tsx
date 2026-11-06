// Dev-only: mosaic playground, states.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { StatesPage } from "@/features/mosaic/pages/StatesPage";

export const metadata: Metadata = { title: "Mosaic · states" };
export default function Page() {
  return (
    <MosaicShell>
      <StatesPage />
    </MosaicShell>
  );
}
