// Docs, learn: six short lessons the glossary popovers link into, each ending in a hands-on check.
import type { Metadata } from "next";
import { DocTitle } from "@/features/docs/DocsFrame";
import { LessonIndex, Lessons } from "@/features/learn/Lessons";

export const metadata: Metadata = { title: "Learn" };

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="Learn" title="Six ideas that make laptop training trustworthy.">Each lesson takes under two minutes and ends with something to try. Everything runs in this browser; nothing is signed or sent.</DocTitle>
      <LessonIndex />
      <Lessons />
    </>
  );
}
