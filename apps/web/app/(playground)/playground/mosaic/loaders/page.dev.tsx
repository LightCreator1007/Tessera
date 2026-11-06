// Dev-only: mosaic playground, loaders.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { LoadersPage } from "@/features/mosaic/pages/LoadersPage";

export const metadata: Metadata = { title: "Mosaic · loaders" };
export default function Page() {
  return (
    <MosaicShell>
      <LoadersPage />
    </MosaicShell>
  );
}
