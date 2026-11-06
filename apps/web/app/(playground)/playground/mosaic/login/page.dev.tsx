// Dev-only: mosaic playground, login.
import type { Metadata } from "next";
import { MosaicShell } from "@/features/mosaic/shell";
import { LoginPage } from "@/features/mosaic/pages/LoginPage";

export const metadata: Metadata = { title: "Mosaic · login" };
export default function Page() {
  return (
    <MosaicShell>
      <LoginPage />
    </MosaicShell>
  );
}
