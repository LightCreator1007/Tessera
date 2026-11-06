"use client";
// Dev-only playground for the activity page (threads model) and the sidebar rail: DialKit tunes the card, the details shown, the scene and the motion; the screen itself is the real ActivityScreen.
import { useEffect, useMemo, useRef, useState } from "react";
import { DialRoot, useDialKitController, type DialConfig } from "dialkit";
import "dialkit/styles.css";
import { RAIL_TOGGLE } from "@/components/shell";
import { ActivityScreen, type Density, type ProgressStyle, type Scope, type Show } from "../ActivityScreen";
import type { Act } from "../model";
import { THREADS, makeActs, makeAttention, nextAct, type Scale } from "./fixtures";

const CONFIG = {
  Structure: {
    preview: [2, 1, 5, 1],
    progress: { type: "select", options: ["segments", "bar", "none"], default: "segments" },
    groupRepeats: true,
    needsYou: true,
    filters: true,
    density: { type: "select", options: ["comfortable", "compact"], default: "comfortable" },
  },
  Details: {
    why: true,
    where: true,
    amount: true,
    txHash: false,
    block: false,
    time: { type: "select", options: ["relative", "absolute", "both"], default: "relative" },
  },
  Scene: {
    data: { type: "select", options: ["typical", "heavy", "one", "empty"], default: "typical" },
    state: { type: "select", options: ["ready", "loading", "error"], default: "ready" },
    signedIn: true,
    scope: { type: "select", options: ["yours", "network"], default: "yours" },
    unread: [3, 0, 10, 1],
    node: { type: "select", options: ["online", "offline", "none"], default: "online" },
    claimable: true,
  },
  Motion: {
    stagger: true,
    push: { type: "action", label: "Push a new event" },
    replay: { type: "action", label: "Replay entrance" },
  },
  Sidebar: {
    duration: [240, 80, 600, 10],
    easing: { type: "select", options: ["drawer", "standard", "snappy", "linear"], default: "drawer" },
    labelFade: [120, 40, 400, 10],
    peek: true,
    peekDelay: [350, 100, 1000, 25],
    toggle: { type: "action", label: "Toggle sidebar ( [ )" },
  },
} satisfies DialConfig;

const URL_DIALS: [string, string][] = [
  ["preview", "Structure.preview"], ["progress", "Structure.progress"], ["density", "Structure.density"], ["filters", "Structure.filters"],
  ["data", "Scene.data"], ["state", "Scene.state"], ["scope", "Scene.scope"], ["signedIn", "Scene.signedIn"], ["time", "Details.time"],
];

const EASE: Record<string, string> = {
  drawer: "var(--ease-drawer)",
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  snappy: "cubic-bezier(0.2, 0.9, 0.1, 1)",
  linear: "linear",
};

export function PlaygroundActivity() {
  const [now] = useState(() => Date.now() / 1000);
  const [mounted, setMounted] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [live, setLive] = useState<Act[]>([]);
  const [arrived, setArrived] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const dk = useDialKitController("Activity", CONFIG, {
    onAction: (a) => {
      if (a.endsWith("push")) {
        setLive((l) => {
          const act = nextAct(Date.now() / 1000, l.length + 1);
          setArrived(act.id);
          return [act, ...l];
        });
      }
      if (a.endsWith("replay")) setEpoch((e) => e + 1);
      if (a.endsWith("toggle")) window.dispatchEvent(new Event(RAIL_TOGGLE));
    },
  });
  const d = dk.values;
  const setDial = useRef(dk.setValue);
  const [scope, setScope] = useState<Scope>("yours");
  const [signedIn, setSignedIn] = useState(true);
  // The main dials mirror the URL, so a variant or scene can be linked: ?variant=log&data=heavy&state=loading
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    for (const [key, path] of URL_DIALS) {
      const v = q.get(key);
      if (v !== null) setDial.current(path, v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v);
    }
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const q = new URLSearchParams(window.location.search);
    q.set("data", d.Scene.data);
    q.set("state", d.Scene.state);
    window.history.replaceState(null, "", `?${q.toString()}`);
  }, [mounted, d.Scene.data, d.Scene.state]);
  useEffect(() => setScope(d.Scene.scope as Scope), [d.Scene.scope]);
  useEffect(() => setSignedIn(d.Scene.signedIn), [d.Scene.signedIn]);
  useEffect(() => { setRead(new Set()); setLive([]); }, [d.Scene.data, d.Scene.unread]);

  const s = d.Sidebar;
  useEffect(() => {
    const st = document.documentElement.style;
    st.setProperty("--rail-dur", `${s.duration}ms`);
    st.setProperty("--rail-ease", EASE[s.easing]);
    st.setProperty("--rail-label-dur", `${s.labelFade}ms`);
    document.documentElement.dataset.railPeek = s.peek ? "on" : "off";
    document.documentElement.dataset.railPeekDelay = String(s.peekDelay);
  }, [s.duration, s.easing, s.labelFade, s.peek, s.peekDelay]);
  useEffect(() => () => {
    const st = document.documentElement.style;
    for (const v of ["--rail-dur", "--rail-ease", "--rail-label-dur"]) st.removeProperty(v);
    delete document.documentElement.dataset.railPeek;
    delete document.documentElement.dataset.railPeekDelay;
  }, []);

  const acts = useMemo(() => {
    const base = makeActs(d.Scene.data as Scale, now, d.Scene.unread);
    return [...live, ...base].map((a) => (read.has(a.id) ? { ...a, unread: false } : a));
  }, [d.Scene.data, d.Scene.unread, now, live, read]);
  const node = d.Scene.node;
  const attention = useMemo(() => makeAttention({ hasNode: node !== "none", nodeOffline: node === "offline", claimable: d.Scene.claimable }), [node, d.Scene.claimable]);
  const show: Show = { detail: d.Details.why, chips: d.Details.where, amount: d.Details.amount, tx: d.Details.txHash, block: d.Details.block, time: d.Details.time as Show["time"] };

  if (!mounted) return null;
  return (
    <>
      <ActivityScreen
        key={epoch}
        acts={node === "none" ? acts.filter((a) => !a.thread.startsWith("node:")) : acts}
        attention={attention}
        threads={THREADS}
        state={d.Scene.state as "ready" | "loading" | "error"}
        signedIn={signedIn}
        scope={scope}
        onScope={setScope}
        onConnect={() => setSignedIn(true)}
        onRetry={() => setEpoch((e) => e + 1)}
        onReadAll={() => setRead(new Set(acts.map((a) => a.id)))}
        show={show}
        density={d.Structure.density as Density}
        showAttention={d.Structure.needsYou}
        showFacets={d.Structure.filters}
        preview={d.Structure.preview}
        progress={d.Structure.progress as ProgressStyle}
        groupRepeats={d.Structure.groupRepeats}
        stagger={d.Motion.stagger}
        arrived={arrived}
        now={Date.now() / 1000}
      />
      <DialRoot position="bottom-right" theme="dark" />
    </>
  );
}
