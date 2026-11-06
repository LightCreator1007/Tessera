"use client";
// Add a node, one step at a time (the CLI quickstart with the web steps inside it): install, connect, pair, prove personhood, stake, start. The position derives from wallet and chain state, so a reload resumes at the first unfinished step; finished steps stay reviewable from the progress bar. Demo chips walk the failure paths (expired code, wrong owner, used World ID, short balance).
import { calls } from "@/lib/chain";
import { JoinBuild } from "@/components/mosaic/isoScenes";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock, Cpu, HardDrive, Laptop, Wallet } from "lucide-react";
import { useConfig, useJobs, useOwnerIdentity } from "@/lib/api/hooks";
import { isDemo } from "@/lib/api/client";
import { setWallet, useWallet } from "@/lib/wallet";
import { useTx } from "@/lib/tx";
import { formatToken } from "@/lib/money";
import { Command, More, Sequence, StepPanel, TxButton, TxStatus, WizardProgress, useWizard } from "@/components/flow";
import { openConnect } from "@/components/connect";
import { NodeArt } from "@/components/pixel";
import { Button, DocsLink, Money, Segmented, SourceBadge, cx, short } from "@/components/primitives";
import { INSTALL, PAIR_PREFIX, PAIR_TTL_MIN, SETUP, pairCommand } from "@/features/docs/cli";
import { SIMULATED, SelfTestCard } from "./SelfTestCard";
import { ExcludedNotice } from "./Excluded";
import { HumanCheck } from "@/components/human/HumanCheck";
import { useHuman } from "@/lib/identity";

const TOD = 1_000_000;

export const MIN_STAKE = 15 * TOD;
const DEMO_OP = "0x0b3e70000000000000000000000000000000a1c5";
const STEPS = [
  { key: "connect", label: "Connect" },
  { key: "install", label: "Install" },
  { key: "pair", label: "Pair" },
  { key: "human", label: "Verify" },
  { key: "stake", label: "Stake" },
  { key: "run", label: "Start" },
];

type Parsed = { ok: true; operator: string; owner: string; deadline: number } | { ok: false; error: string };
type PairFields = { consentDeadline: number; operator: string; owner: string; signature: string };
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const NOT_A_CODE = "This isn't a pairing code. Copy the whole line that tod-node pair printed.";

/** Pairing code as `tod-node pair` prints it: the prefix, then unpadded base64url JSON of the consent fields. Only the shape is checked here; the contract checks the signature. */
function parsePairing(code: string, owner: string | null): Parsed {
  const c = code.trim();
  if (!c.startsWith(PAIR_PREFIX)) return { ok: false, error: NOT_A_CODE };
  let f: Partial<PairFields>;
  try {
    const b64 = c.slice(PAIR_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    f = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  } catch {
    return { ok: false, error: NOT_A_CODE };
  }
  if (typeof f.operator !== "string" || !ADDR.test(f.operator) || typeof f.owner !== "string" || !ADDR.test(f.owner) || typeof f.consentDeadline !== "number" || typeof f.signature !== "string") {
    return { ok: false, error: NOT_A_CODE };
  }
  if (f.consentDeadline * 1000 < Date.now()) return { ok: false, error: `This code expired (codes last ${PAIR_TTL_MIN} minutes). Run pair again.` };
  if (owner && f.owner.toLowerCase() !== owner.toLowerCase()) {
    return { ok: false, error: `This code was made for ${short(f.owner)}. Connect that wallet, or run pair again with --owner ${short(owner)}.` };
  }
  return { ok: true, operator: f.operator, owner: f.owner, deadline: f.consentDeadline };
}

/** Demo only: build a code in the CLI's format so the paste step can be walked. */
function demoCode(f: PairFields) {
  const json = JSON.stringify({ consentDeadline: f.consentDeadline, operator: f.operator, owner: f.owner, signature: f.signature });
  return PAIR_PREFIX + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function JoinFlow() {
  const w = useWallet();
  // An excluded owner stops at the connect step: staking and pairing would only fail at admission.
  const excluded = !!useOwnerIdentity(w.address ?? null).data?.data.excluded;
  const cfg = useConfig();
  const jobs = useJobs();
  const [started, setStarted] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [sim, setSim] = useState<keyof typeof SIMULATED | null>(null);
  const [os, setOs] = useState<"unix" | "windows">("unix");
  const [ranPair, setRanPair] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("15");
  const [amountSet, setAmountSet] = useState(false);
  const person = useHuman();
  const approve = useTx();
  const join = useTx({ revertAs: "AlreadyJoined" });
  const stake = useTx({ revertAs: "StakeTooLow" });
  const mint = useTx();

  useEffect(() => {
    const done = sessionStorage.getItem("join-installed") === "1" || w.node !== null;
    setInstalled(done);
    setStarted(done || sessionStorage.getItem("join-started") === "1");
    if (/Win/.test(navigator.userAgent)) setOs("windows");
  }, [w.node]);

  const node = w.node;
  const units = Math.round(Number(amount) * TOD);
  const amountOk = Number.isFinite(units) && units >= MIN_STAKE;
  const staked = !!node && node.stake >= MIN_STAKE;
  const open = (jobs.data?.data ?? []).filter((j) => j.status === "open" || j.status === "running");
  const qualifies = open.filter((j) => j.stakePerNode <= units).length;

  const current = !w.connected || w.wrongNetwork ? 0 : !installed ? 1 : !node ? 2 : !(node.humanVerified || person.verified) ? 3 : !node.joined || !staked ? 4 : !node.running ? 5 : 6;
  const wiz = useWizard(current);
  const markInstalled = () => { sessionStorage.setItem("join-installed", "1"); setInstalled(true); };
  const owner = w.address ?? "<your wallet>";
  const registry = cfg.data?.data.nodeRegistry ?? "<registry>";

  const tryCode = (c: string) => {
    setCode(c);
    const r = parsePairing(c, w.address);
    if (!r.ok) return setErr(r.error);
    setErr(null);
    setWallet({ node: { operator: r.operator, humanVerified: false, joined: false, stake: 0, running: false } });
  };
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  const demoCodes = w.address
    ? [
        { label: "valid code", code: demoCode({ consentDeadline: deadline, operator: DEMO_OP, owner: w.address, signature: "0x00" }) },
        { label: "expired", code: demoCode({ consentDeadline: deadline - 7200, operator: DEMO_OP, owner: w.address, signature: "0x00" }) },
        { label: "other wallet", code: demoCode({ consentDeadline: deadline, operator: DEMO_OP, owner: "0x1111111111111111111111111111111111111111", signature: "0x00" }) },
        { label: "garbage", code: "hello" },
      ]
    : [];

  if (!started && current === 0) {
    return (
      <Frame>
        <section className="animate-step-in flex flex-col gap-12">
          <NodeArt op={DEMO_OP} state="training" size="lg" className="aspect-video w-full rounded-xl" />
          <header className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-wider text-subtle">add a node</p>
            <h1 className="text-balance text-xl font-medium text-ink">Let your laptop pay for your training.</h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted">While you&apos;re not using it, it trains a slice of someone&apos;s model. Two verifiers replay a random piece of the work, and honest work gets paid. Those earnings pay for your own jobs first.</p>
          </header>
          <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <Need icon={Laptop} title="Any laptop">8 GB of memory or more</Need>
            <Need icon={HardDrive} title="Docker">The node runs inside it</Need>
            <Need icon={Wallet} title={`${formatToken(MIN_STAKE)} TOD stake`}>A bond you get back</Need>
            <Need icon={Clock} title="About 10 minutes">Six short steps</Need>
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" onClick={() => { sessionStorage.setItem("join-started", "1"); setStarted(true); }}>Start</Button>
            <More label="How does pay work?">
              <p>Each round splits its pay equally across the nodes whose work passed replay. Pay collects in your balance and you claim it any time.</p>
              <p>The first 5 verified hours are a proving period: that share goes to the community pool.</p>
              <p>Prefer the terminal? <DocsLink href="/docs/node">Read the quickstart</DocsLink></p>
            </More>
          </div>
        </section>
      </Frame>
    );
  }

  if (current === 6 && wiz.shown === 6 && node) {
    return (
      <Frame>
        <section className="animate-step-in flex flex-col gap-12">
          <NodeArt op={node.operator} state="idle" size="lg" className="aspect-video w-full rounded-xl" />
          <header className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-wider text-mosaic">all set</p>
            <h1 className="text-balance text-xl font-medium text-ink">Your laptop is a node.</h1>
            <p className="max-w-prose text-sm leading-relaxed text-muted">It joins rounds on its own when it&apos;s idle. You don&apos;t need to keep this page open.</p>
          </header>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/nodes/${node.operator}`} className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90">Watch it work</Link>
            <Link href="/jobs/new" className="inline-flex h-9 items-center rounded-md border border-rule px-4 text-sm text-ink hover:bg-hover">Spend earnings on a job</Link>
            <Link href="/nodes" className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted hover:bg-hover hover:text-ink">See the network</Link>
          </div>
          <More label="What happens next?">
            <p>The first 5 verified hours are a proving period. After that, every round your node passes pays into your balance.</p>
            <p>Your stake stays bonded while the node is in a round. Withdraw it any time the node is idle.</p>
          </More>
        </section>
      </Frame>
    );
  }

  const progress = STEPS.map((s, i) => ({ ...s, state: wiz.state(i) }));
  const reviewing = wiz.shown < current;
  const back = reviewing ? <Button variant="primary" onClick={() => wiz.go(null)}>Back to {STEPS[Math.min(current, 5)].label.toLowerCase()}</Button> : null;

  return (
    <Frame progress={<div className="flex flex-col gap-6"><div className="h-56 overflow-hidden border border-rule bg-surface"><JoinBuild done={current} /></div><WizardProgress steps={progress} shown={Math.min(wiz.shown, 5)} onPick={wiz.go} aside={<SourceBadge source={isDemo ? "demo" : "live"} />} /></div>}>
      <ExcludedNotice owner={w.address} on="join" />
      {wiz.shown === 1 && !excluded && (
        <StepPanel
          key="install"
          title="Install the node"
          lede="Paste this into a terminal. It installs the wrapper, creates the node's key, then runs a self-test that checks your laptop reproduces the reference math bit for bit."
          footer={reviewing ? back : undefined}
        >
          <div className="flex flex-col gap-4">
            <Segmented label="Operating system" items={[{ key: "unix", label: "macOS or Linux" }, { key: "windows", label: "Windows" }]} value={os} onChange={setOs} />
            <Command cmd={`${INSTALL[os]}\n${SETUP}`} />
            {!reviewing && <SelfTestCard onPassed={markInstalled} manual={markInstalled} simulated={sim && SIMULATED[sim]} poll={!isDemo} />}
            {!reviewing && isDemo && <DemoRow>{(["pass", "drift", "weak"] as const).map((k) => <DemoChip key={k} onClick={() => setSim(k)}>{{ pass: "self-test passes", drift: "math drifts", weak: "no job fits" }[k]}</DemoChip>)}</DemoRow>}
          </div>
          <More label="No Docker yet, or the self-test failed?">
            <p>Install Docker Desktop from docker.com and start it once. The node only trains while the laptop is idle, so it won&apos;t slow you down.</p>
            <p>If the self-test fails, run <code className="font-mono text-ink">tod-node selftest --json</code> to see the expected and actual hash, and check that Docker has at least 4 GB of memory.</p>
            <p>Every command is in the <DocsLink href="/docs/cli">CLI reference</DocsLink>.</p>
          </More>
        </StepPanel>
      )}

      {wiz.shown === 0 && (
        <StepPanel
          key="connect"
          title={w.connected && !w.wrongNetwork ? "Wallet connected" : "Connect the wallet that owns it"}
          lede="This wallet stakes, collects pay and can withdraw. The laptop keeps a separate key of its own, so it never holds your money."
          footer={reviewing ? back : <Button variant="primary" icon={Wallet} onClick={openConnect}>{w.wrongNetwork ? "Switch network" : "Connect wallet"}</Button>}
        >
          {w.connected && <p className="font-mono text-sm text-muted">{w.address}</p>}
          <More label="Why two keys?">
            <p>If the laptop is lost or compromised, the worst it can do is stop working. It can&apos;t touch your stake or your earnings.</p>
          </More>
        </StepPanel>
      )}

      {wiz.shown === 2 && !excluded && (
        <StepPanel key="pair" title="Pair the laptop with your wallet" lede={`The laptop signs a short consent naming your wallet as its owner. Codes last ${PAIR_TTL_MIN} minutes.`} footer={back}>
          {reviewing && node ? (
            <p className="text-sm text-muted">Paired as operator <span className="font-mono text-ink">{short(node.operator)}</span>.</p>
          ) : (
            <Sequence
              items={[
                {
                  key: "run", title: "Run this on the laptop", done: ranPair, note: "done",
                  body: (
                    <>
                      <Command cmd={pairCommand(owner, cfg.data?.data.chainId ?? 84532, registry)} />
                      <Button variant="primary" onClick={() => setRanPair(true)}>It printed a code</Button>
                    </>
                  ),
                },
                {
                  key: "paste", title: "Paste the code it printed", done: !!node,
                  body: (
                    <>
                      <label className="flex w-full flex-col gap-2">
                        <span className="sr-only">Pairing code</span>
                        <textarea
                          value={code}
                          onChange={(e) => { setCode(e.target.value); setErr(null); }}
                          rows={3}
                          placeholder="tod-pair:eyJjb25zZW50RGVhZGxpbmUi…"
                          aria-invalid={err !== null}
                          aria-describedby={err ? "pair-err" : undefined}
                          className={cx("w-full rounded-lg border bg-sunken px-4 py-3 font-mono text-sm text-ink outline-none focus:border-rule-strong", err ? "border-danger" : "border-rule")}
                        />
                        {err && <span id="pair-err" role="alert" className="text-sm text-danger">{err}</span>}
                      </label>
                      <Button variant="primary" disabled={!code.trim()} onClick={() => tryCode(code)}>Check code</Button>
                      {isDemo && <DemoRow>{demoCodes.map((d) => <DemoChip key={d.label} onClick={() => tryCode(d.code)}>{d.label}</DemoChip>)}</DemoRow>}
                    </>
                  ),
                },
              ]}
            />
          )}
        </StepPanel>
      )}

      {wiz.shown === 3 && !excluded && (
        <StepPanel
          key="human"
          title={reviewing ? "Verified as one person" : "Prove you're one person"}
          lede="One person, one node. It keeps anyone from running a fleet of fake laptops to outvote honest ones."
          footer={reviewing ? back : undefined}
        >
          <HumanCheck
            compact
            intro="Scan once with World App. If you verified when you signed up, this step is already done."
            onVerified={() => setWallet((x) => ({ node: x.node && { ...x.node, humanVerified: true }, eth: isDemo ? x.eth + 0.01 : x.eth }))}
          />
          <More label="What does World ID see?">
            <p>Nothing about you goes on chain except a one-time number that proves this person hasn&apos;t joined before. No name, no face, no address.</p>
            <p>Once you&apos;re verified, the coordinator sends your node a little test ETH for its own gas.</p>
          </More>
        </StepPanel>
      )}

      {wiz.shown === 4 && !excluded && (
        <StepPanel
          key="stake"
          title={!amountSet && !reviewing ? "Choose your stake" : "Bond the stake"}
          lede="The stake is your bond. Honest work never touches it, and you can withdraw it whenever the node is idle."
          footer={back}
        >
          {reviewing && node ? (
            <p className="text-sm text-muted">Staked <Money units={node.stake} />.</p>
          ) : !amountSet ? (
            <div className="flex flex-col gap-6">
              <label className="flex flex-col gap-3">
                <span className="sr-only">Stake in TOD</span>
                <span className="flex items-baseline gap-3">
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    aria-invalid={!amountOk}
                    aria-describedby="stake-hint"
                    className={cx("w-40 border-b-2 bg-transparent pb-1 font-mono text-2xl tabular text-ink outline-none", amountOk ? "border-field focus:border-ink" : "border-danger")}
                  />
                  <span className="text-lg text-subtle">TOD</span>
                </span>
                <span id="stake-hint" className={cx("text-sm", amountOk ? "text-muted" : "text-danger")}>
                  {amountOk ? `Qualifies for ${qualifies} of ${open.length} open jobs. Jobs set their own stake floor.` : `At least ${formatToken(MIN_STAKE)} TOD`}
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                {[15, 25, 50].map((v) => (
                  <button key={v} type="button" onClick={() => setAmount(String(v))} aria-pressed={Number(amount) === v} className={cx("h-9 rounded-md border px-3 font-mono text-sm", Number(amount) === v ? "border-ink text-ink" : "border-rule text-muted hover:border-rule-strong hover:text-ink")}>{v}</button>
                ))}
              </div>
              <div><Button variant="primary" disabled={!amountOk} onClick={() => setAmountSet(true)}>Continue</Button></div>
              <More label="What can cost me stake?">
                <p>A replay that doesn&apos;t match your committed work, or missing a reveal you committed to. Each costs part of the stake, and the cheater&apos;s share pays the honest nodes.</p>
                <p>Two missed rounds in a row bench the node until it&apos;s reviewed.</p>
              </More>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-muted">
                Staking <span className="font-mono text-ink">{formatToken(units)} TOD</span>.{" "}
                <button type="button" onClick={() => setAmountSet(false)} className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">Change</button>
              </p>
              <Sequence
                items={[
                  {
                    key: "fund", title: w.usdc >= units || staked ? "Enough TOD" : `Get ${formatToken(units - w.usdc)} more TOD`, done: w.usdc >= units || staked, note: <Money units={w.usdc} />,
                    body: (
                      <>
                        <p className="text-sm text-muted">You have {formatToken(w.usdc)} TOD. Test TOD is free on this network.</p>
                        <TxButton tx={mint} label="Get test TOD" onRun={() => mint.send(calls.faucet, () => setWallet((x) => ({ usdc: x.usdc + 100 * TOD })))} />
                        <TxStatus tx={mint} />
                      </>
                    ),
                  },
                  {
                    key: "approve", title: "Allow Tessera to move this TOD", done: w.allowanceTo.registry >= units || staked, note: "exact amount only",
                    body: (
                      <>
                        <p className="text-sm text-muted">Your wallet asks once. The allowance is for {formatToken(units)} TOD exactly, nothing more.</p>
                        <TxButton tx={approve} label="Approve" onRun={() => approve.send(() => calls.approve("registry", units), () => setWallet({ allowance: units }))} />
                        <TxStatus tx={approve} />
                      </>
                    ),
                  },
                  {
                    key: "join", title: "Join the registry", done: !!node?.joined,
                    body: (
                      <>
                        <TxButton tx={join} label="Join" onRun={() => join.run(() => setWallet((x) => ({ node: x.node && { ...x.node, joined: true } })))} />
                        <TxStatus tx={join} />
                      </>
                    ),
                  },
                  {
                    key: "deposit", title: "Deposit the stake", done: staked,
                    body: (
                      <>
                        <TxButton tx={stake} label={`Stake ${formatToken(units)} TOD`} onRun={() => stake.send(() => calls.depositStake(node!.operator, units), () => setWallet((x) => ({ usdc: x.usdc - units, allowance: 0, node: x.node && { ...x.node, stake: units } })))} />
                        <TxStatus tx={stake} />
                      </>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </StepPanel>
      )}

      {wiz.shown === 5 && !excluded && (
        <StepPanel key="run" title="Start the node" lede="Run this on the laptop. It goes online and waits for idle time." footer={back}>
          <Command cmd="tod-node run" />
          <div className="flex items-center gap-4 py-2" role="status">
            <span className="size-2.5 rounded-full bg-pending tile-flicker" aria-hidden />
            <p className="flex-1 text-sm text-muted">Waiting for the first heartbeat. It usually lands within a minute.</p>
          </div>
          {isDemo && <DemoRow><DemoChip onClick={() => setWallet((x) => ({ node: x.node && { ...x.node, running: true } }))}>simulate heartbeat</DemoChip></DemoRow>}
          <More label="Nothing after two minutes?">
            <ul className="flex list-disc flex-col gap-1.5 pl-5">
              <li>Docker Desktop is running.</li>
              <li><code className="font-mono text-ink">tod-node status</code> shows the coordinator as reachable.</li>
              <li>A firewall or VPN isn&apos;t blocking outbound HTTPS.</li>
            </ul>
          </More>
        </StepPanel>
      )}
    </Frame>
  );
}

function Frame({ progress, children }: { progress?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-14 px-6 pt-10 pb-24 md:pt-16">
      {progress}
      {children}
    </div>
  );
}

function Need({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-ink text-mosaic">
        <Icon className="size-4" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-ink">{title}</span>
        <span className="text-sm text-subtle">{children}</span>
      </span>
    </li>
  );
}

function DemoRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-rule pt-4">{children}</div>;
}

export function DemoChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-7 items-center rounded-md border border-dashed border-trust-demo px-2 font-mono text-xs text-demo hover:bg-hover">
      demo: {children}
    </button>
  );
}
