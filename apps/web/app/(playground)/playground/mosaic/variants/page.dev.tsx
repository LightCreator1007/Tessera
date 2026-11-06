// Dev-only: mosaic playground, five variants of every figure-art surface after the subject-fit fix.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { VariantsPage } from "@/features/mosaic/pages/VariantsPage";

export const metadata: Metadata = { title: "Mosaic · variants" };
export default function Page() {
  return (
    <MosaicShell>
      <VariantsPage />
    </MosaicShell>
  );
}
