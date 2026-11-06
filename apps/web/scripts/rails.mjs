// Design-system rails, run before every build. Each failure names the replacement. Exit 1 on any hit.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const SKIP = new Set(["node_modules", ".next", "design", ".shots", "scripts"]);
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    if (SKIP.has(f)) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(f)) files.push(p);
  }
})(ROOT);

const RULES = [
  { id: "color-literal", test: /#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(|\boklch\(|\bhsla?\(/, only: /\.tsx$/, fix: "use a semantic token utility (text-ink, bg-surface, text-danger...) from app/globals.css" },
  { id: "arbitrary-value", test: /\b[a-z-]+-\[[^\]]+\]/, only: /\.tsx$/, fix: "add a token to @theme in app/globals.css and use its utility" },
  { id: "honest-null", test: /\?\?\s*0(?![.\d])/, fix: "keep null and render <Null /> (\"Not reported\"); a missing value is not zero" },
  { id: "format-units", test: /\bformatUnits\b/, allow: `lib${sep}money`, fix: "format token amounts with formatToken() or <Money /> from lib/money" },
  { id: "write-contract", test: /\bwriteContract\b/, allow: `lib${sep}tx`, fix: "send transactions through the tx state machine in lib/tx" },
  { id: "playground-route", test: /./, path: `app${sep}playground`, prodOnly: true, fix: "playground routes live under app/(playground) and are excluded from production" },
];

const hits = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const lines = readFileSync(f, "utf8").split("\n");
  for (const r of RULES) {
    if (r.path) { if (rel.startsWith(r.path)) hits.push(`${rel}: [${r.id}] ${r.fix}`); continue; }
    if (r.only && !r.only.test(f)) continue;
    if (r.allow && rel.startsWith(r.allow)) continue;
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l) || l.includes("rails-allow")) return;
      if (r.test.test(l)) hits.push(`${rel}:${i + 1}: [${r.id}] ${r.fix}`);
    });
  }
}
if (hits.length) {
  console.error(`rails: ${hits.length} violation(s)\n` + hits.join("\n"));
  process.exit(1);
}
console.log(`rails: ${files.length} files clean`);
