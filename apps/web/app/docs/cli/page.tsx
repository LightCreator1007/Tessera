// CLI reference: every tod-node command, whether it ships today, the JSON flag and the exit codes.
import type { Metadata } from "next";
import { Pill, TD, TH, THead } from "@/components/primitives";
import { Code, DocSection, DocTitle } from "@/features/docs/DocsFrame";
import { InstallCommand } from "@/features/docs/Live";
import { COMMANDS, EXIT_CODES } from "@/features/docs/cli";

export const metadata: Metadata = { title: "CLI reference" };

export default function Page() {
  return (
    <>
      <DocTitle eyebrow="Reference" title="tod-node">
        The node CLI. It runs in Docker through a small wrapper, so every machine runs the same image. Every command takes <Code>--json</Code> for scripts; <Code>--version</Code> prints the version.
      </DocTitle>
      <DocSection id="install" title="Install">
        <InstallCommand withSetup />
      </DocSection>
      <DocSection id="commands" title="Commands">
        <div className="overflow-x-auto rounded-xl border border-rule">
          <table className="w-full text-sm">
            <THead><TH>Command</TH><TH>What it does</TH><TH className="text-right">Status</TH></THead>
            <tbody>
              {COMMANDS.map((c) => (
                <tr key={c.name} className="border-t border-rule-row align-top">
                  <TD className="whitespace-nowrap py-3"><span className="font-mono text-xs text-ink">tod-node {c.name}</span>{c.args && <span className="block font-mono text-xs text-subtle">{c.args}</span>}</TD>
                  <TD className="py-3 text-muted">{c.does}</TD>
                  <TD className="py-3 text-right">{c.ships ? <Pill tone="ok">ships</Pill> : <Pill tone="pending">planned, R2</Pill>}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DocSection>
      <DocSection id="exit" title="Exit codes">
        <dl className="flex flex-col divide-y divide-rule rounded-xl border border-rule">
          {EXIT_CODES.map(([n, d]) => (
            <div key={n} className="flex items-baseline gap-4 px-4 py-3">
              <dt className="w-6 font-mono text-ink">{n}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      </DocSection>
      <DocSection id="data" title="Where things live">
        <p>The operator key and checkpoints sit in the Docker volume <Code>tod-data</Code>. While running, the node keeps a local API on <Code>127.0.0.1:7777</Code>, loopback only. Set <Code>TOD_NODE_IMAGE</Code> to pin an image.</p>
      </DocSection>
    </>
  );
}
