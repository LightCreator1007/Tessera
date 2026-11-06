"use client";
// Docs chrome inside the app shell: a header row with the crumb, a page list on the left, and a reading column. Docs live in the app so commands can carry live values.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { Crumbs, PageHeader, cx } from "@/components/primitives";
import { DOCS } from "./pages";

export function DocsFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const page = DOCS.find((d) => d.href === path);
  return (
    <div className="flex min-h-full flex-col">
      <PageHeader icon={page ? undefined : BookOpen} title={page ? <Crumbs items={[{ href: "/docs", label: "docs" }, { label: page.title }]} /> : "docs"} />
      <div className="flex flex-1 flex-col gap-8 px-4 py-8 md:flex-row md:px-6">
        <nav aria-label="Docs pages" className="shrink-0 md:w-56">
          <ol className="no-scrollbar flex gap-1 overflow-x-auto md:sticky md:top-6 md:flex-col">
            {DOCS.map((d) => (
              <li key={d.href} className="shrink-0">
                <Link
                  href={d.href}
                  aria-current={d.href === path ? "page" : undefined}
                  className={cx("flex h-8 items-center rounded-sm px-2 text-sm transition-colors duration-150", d.href === path ? "bg-band font-medium text-ink" : "text-muted hover:bg-band hover:text-ink")}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <article className="flex min-w-0 max-w-flow flex-1 flex-col gap-10 pb-16">{children}</article>
      </div>
    </div>
  );
}

export function DocTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 border-b border-rule pb-8">
      <p className="font-mono text-xs uppercase tracking-wider text-subtle">{eyebrow}</p>
      <h1 className="text-xl font-medium text-ink">{title}</h1>
      {children && <div className="max-w-lede text-sm text-muted">{children}</div>}
    </header>
  );
}

export function DocSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-4 text-sm text-muted">{children}</div>
    </section>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-band px-1 py-0.5 font-mono text-xs text-ink">{children}</code>;
}
