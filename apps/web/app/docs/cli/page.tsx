// CLI reference: every tod-node command, whether it ships today, the JSON flag and the exit codes.
import type { Metadata } from "next";
import { Pill, TD, TH, THead } from "@/components/primitives";
import { Code, DocSection, DocTitle } from "@/features/docs/DocsFrame";
import { InstallCommand } from "@/features/docs/Live";
import { COMMANDS, ERROR_SHAPE, EXIT_CODES, TUI } from "@/features/docs/cli";
import { Command } from "@/components/flow";

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
                  <TD className="py-3 text-right">{c.ships ? <Pill tone="ok">ships</Pill> : <Pill tone="pending">in review</Pill>}</TD>
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
      <DocSection id="errors" title="Errors">
        <p>With <Code>--json</Code>, a failure prints one object: what went wrong, a stable <Code>code</Code> for scripts and agents to branch on, and a <Code>hint</Code> with the next step.</p>
        <pre className="overflow-x-auto rounded-lg border border-rule bg-sunken p-4 font-mono text-xs text-ink">{ERROR_SHAPE}</pre>
      </DocSection>
      <DocSection id="tui" title="Terminal UI">
        <p>A three-tab screen for the same node: is it OK, what happened in this round, and who else is in the pool. Its Next step line always says which command to run, and <Code>c</Code> copies it. Pressing <Code>s</Code> twice stops the node after the reveals it owes.</p>
        <div className="flex flex-col gap-3">
          <Command cmd={TUI.run} label="from the node's machine" />
          <Command cmd={TUI.install} label="or straight from the repo" />
          <Command cmd={TUI.local} label="against the local stack's second node" />
          <Command cmd={TUI.demo} label="a scripted round, no network" />
        </div>
        <p>The same node is in the browser at <Code>localhost:3100/node</Code> when the web app runs on that machine.</p>
      </DocSection>
      <DocSection id="data" title="Where things live">
        <p>The operator key, <Code>config.toml</Code>, the event log and the local API token sit in the data directory: <Code>~/.tod</Code> natively, or the Docker volume <Code>tod-data</Code>. Set <Code>TOD_DATA</Code> to move it. While running, the node serves a local API on <Code>127.0.0.1:7777</Code>, loopback only; <Code>TOD_API_BIND</Code> changes the address or turns it <Code>off</Code>. Set <Code>TOD_NODE_IMAGE</Code> to pin an image.</p>
      </DocSection>
    </>
  );
}
