// Docs layout: every docs page shares the in-app frame.
import type { ReactNode } from "react";
import { DocsFrame } from "@/features/docs/DocsFrame";

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsFrame>{children}</DocsFrame>;
}
