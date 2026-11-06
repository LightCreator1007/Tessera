// Dev-only: mosaic playground, index.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { IndexPage } from "@/features/mosaic/pages/IndexPage";

export const metadata: Metadata = { title: "Mosaic · index" };
export default function Page() {
  return (
    <MosaicShell>
      <IndexPage />
    </MosaicShell>
  );
}
