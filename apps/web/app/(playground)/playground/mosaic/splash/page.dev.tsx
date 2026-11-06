// Dev-only: mosaic playground, splash.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { SplashPage } from "@/features/mosaic/pages/SplashPage";

export const metadata: Metadata = { title: "Mosaic · splash" };
export default function Page() {
  return (
    <MosaicShell>
      <SplashPage />
    </MosaicShell>
  );
}
