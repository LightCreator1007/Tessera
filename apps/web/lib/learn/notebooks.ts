// Demo-mode notebooks for the example competitions: one written-up entry, sealed until each example's deadline.
import type { Notebook, NotebookIndex } from "@/lib/api/types";
import { COMPETITIONS } from "./competition";

const LEAF_TOP = "0x3f1c9a07b2e4d1c08e5f6a7b9c0d1e2f3a4b5c6d";

const cell = (cell_type: "markdown" | "code", source: string, outputs: unknown[] = []) =>
  cell_type === "code" ? { cell_type, source: source.split(/(?<=\n)/), outputs, execution_count: 1 } : { cell_type, source: source.split(/(?<=\n)/) };

const LEAF_NOTEBOOK = JSON.stringify({
  nbformat: 4,
  cells: [
    cell("markdown", "# Leaf disease: a small CNN that got 91%\n\nI trained on the public **PlantVillage** split only, so nothing here saw the hidden labels.\n\n## What worked\n\n- Mixed-precision training on 4 pooled laptops, 6 rounds\n- Random crops and colour jitter, nothing fancier\n- Averaging the last three checkpoints gave about +1.2%\n"),
    cell("code", "import torch\nfrom torchvision import transforms as T\n\naug = T.Compose([T.RandomResizedCrop(128), T.ColorJitter(0.2, 0.2), T.ToTensor()])\nprint(len(train), len(val))\n", [{ output_type: "stream", name: "stdout", text: ["43,456 10,861\n"] }]),
    cell("code", "model = SmallCNN(classes=10)\nacc = evaluate(model, val)\nacc\n", [{ output_type: "execute_result", data: { "text/plain": ["0.9127"] } }]),
    cell("markdown", "## What didn't\n\nA bigger backbone overfit within two rounds. `label smoothing` made no difference at this size.\n"),
  ],
});

/** How many notebooks an example has, sealed until its deadline like a live one. */
export function index(id: string): NotebookIndex | null {
  const c = COMPETITIONS.find((x) => x.id === id);
  if (!c) return { sealed: false, count: 0, opensAt: 0, notebooks: [] };
  const opensAt = Math.floor(Date.parse(c.deadline) / 1000);
  const has = id === "leaf-10";
  if (c.status === "open") return { sealed: true, count: Math.min(2, c.entries.length), opensAt, notebooks: [] };
  return {
    sealed: false, count: has ? 1 : 0, opensAt,
    notebooks: has ? [{ ...meta(), entrant: LEAF_TOP }] : [],
  };
}

function meta() {
  return {
    entrant: LEAF_TOP, title: "A small CNN that got 91%", name: "leaf-cnn.ipynb", kind: "ipynb" as const, size: LEAF_NOTEBOOK.length,
    sha256: "", signature: "", signedAt: 1_793_390_400, revisions: 2, updatedAt: 1_793_390_400,
  };
}

export function one(id: string, who: string): Notebook | null {
  if (id !== "leaf-10" || who.toLowerCase() !== LEAF_TOP) return null;
  return { ...meta(), competition: id, content: LEAF_NOTEBOOK, message: "" };
}
