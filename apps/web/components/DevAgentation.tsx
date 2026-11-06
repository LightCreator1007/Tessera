// Agentation feedback toolbar on every page, dev server only. The production branch is a constant `null`, so the
// dynamic import is dropped from the build and the devDependency never ships.
"use client";

import dynamic from "next/dynamic";

const Toolbar =
  process.env.NODE_ENV === "development"
    ? dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false })
    : () => null;

export function DevAgentation() {
  return <Toolbar />;
}
