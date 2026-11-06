// Role picker for first-time visitors.
import type { Metadata } from "next";
import { RolePicker } from "@/features/start/RolePicker";

export const metadata: Metadata = { title: "Start" };

export default function Page() {
  return <RolePicker />;
}
