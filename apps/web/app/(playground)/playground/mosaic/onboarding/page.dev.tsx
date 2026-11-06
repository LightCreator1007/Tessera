// Dev-only: mosaic playground, onboarding.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { OnboardingPage } from "@/features/mosaic/pages/OnboardingPage";

export const metadata: Metadata = { title: "Mosaic · onboarding" };
export default function Page() {
  return (
    <MosaicShell>
      <OnboardingPage />
    </MosaicShell>
  );
}
