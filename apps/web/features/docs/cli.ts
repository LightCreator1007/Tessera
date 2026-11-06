// The node CLI as the web shows it: install lines for the Docker wrapper and every command, mirroring docker/tod-node and apps/node/src/tod_node/cli.py.

const WRAPPER = "https://raw.githubusercontent.com/LightCreator1007/ToD/main/docker";

export const INSTALL = {
  unix: `mkdir -p ~/.local/bin\ncurl -fsSL ${WRAPPER}/tod-node -o ~/.local/bin/tod-node\nchmod +x ~/.local/bin/tod-node`,
  windows: `New-Item -ItemType Directory -Force $HOME\\bin | Out-Null\nInvoke-WebRequest ${WRAPPER}/tod-node.ps1 -OutFile $HOME\\bin\\tod-node.ps1`,
};

export const SETUP = "tod-node init\ntod-node selftest";

export function pairCommand(owner: string, chainId: number, registry: string) {
  return `tod-node pair --owner ${owner} --chain-id ${chainId} --registry ${registry}`;
}

/** Pairing code printed by `pair`: the prefix, then unpadded base64url JSON of the consent fields (cli.py, PAIR_PREFIX). */
export const PAIR_PREFIX = "tod-pair:";
export const PAIR_TTL_MIN = 30;

export type CliCommand = { name: string; args?: string; does: string; ships: boolean };
export const COMMANDS: CliCommand[] = [
  { name: "init", args: "--network <anvil|base-sepolia> [--coordinator <url>]", does: "Creates this node's operator key in the data volume (mode 0600), saves the network and coordinator, and prints its address. Later runs keep the existing key.", ships: true },
  { name: "config show", does: "Prints the network and coordinator this node uses, and where each value came from: a flag, the environment, or config.toml.", ships: true },
  { name: "selftest", does: "Trains the mlp-exact self-test vector and checks the result hash byte for byte. Exits 3 on a mismatch, so a drifted machine never joins.", ships: true },
  { name: "pair", args: "--owner <0x..> --chain-id <id> --registry <0x..>", does: `Signs the owner's consent and prints a pairing code to paste into the web. The code expires after ${PAIR_TTL_MIN} minutes.`, ships: true },
  { name: "status", does: "Prints the data directory, whether the node is set up, its operator address, whether it is running, and its latest event. The local API's /v1/status returns the same object.", ships: true },
  { name: "doctor", args: "[--chain-id <id>]", does: "Checks the key, the data folder, the self-test and the coordinator, and says which one needs fixing.", ships: true },
  { name: "run", args: "[--poll <s>] [--mode honest|fake:lazy]", does: "Runs the node: watches the chain, trains, commits and reveals, and serves the local API on 127.0.0.1:7777. It asks the coordinator for gas when it starts low. fake:lazy cheats on purpose and only test chains allow it.", ships: true },
  { name: "logs", args: "[-f] [--since <seq>]", does: "Prints the node's event log. With --json, one event per line.", ships: true },
  { name: "stop", args: "[--wait]", does: "Asks the node to stop. It finishes any reveal it owes first, so stopping never costs stake. Stake stays in the registry until you withdraw it on the web.", ships: true },
  { name: "tui", args: "[--node <url>] [--demo]", does: "Opens the terminal UI on this node, pointed at the coordinator it uses. Needs tod-tui installed from apps/tui.", ships: false },
];

export const EXIT_CODES: [number, string][] = [
  [0, "ok"],
  [2, "bad input, for example an address that is not 0x"],
  [3, "not eligible: not initialized, or the self-test failed"],
  [4, "unreachable: the coordinator or the chain did not answer"],
  [6, "a node is already running on this machine"],
];

/** Errors print as one JSON object with --json: what went wrong, a stable code to branch on, and what to do next. */
export const ERROR_SHAPE = '{"error": "not initialized", "code": "not_initialized", "hint": "run `tod-node init`"}';

/** The terminal UI in apps/tui. Same node, same coordinator, three tabs: node, round and pool. */
export const TUI = {
  install: "cd apps/tui\nuv run tod-tui",
  run: "tod-node tui",
  local: "uv run tod-tui --node http://127.0.0.1:7778 --coordinator http://127.0.0.1:8000",
  demo: "uv run tod-tui --demo",
};
