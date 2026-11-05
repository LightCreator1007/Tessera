---
name: codegraph
description: "Use when exploring or changing code in this repository: how something works, who calls a function, what a change would break, or which tests a change affects. Explains the project's CodeGraph index (MCP tool `codegraph_explore`, CLI `codegraph explore`) and the one-time per-clone setup."
---

# CodeGraph in ToD

CodeGraph ([colbymchenry/codegraph](https://github.com/colbymchenry/codegraph), MIT) keeps a local tree-sitter graph of this repo's Solidity, Python and TypeScript: symbols, calls, imports and inheritance. Its MCP server is configured for the whole project in `.mcp.json`, pinned to `@colbymchenry/codegraph@1.6.2` and run through `npx`, so nobody installs anything globally. Telemetry is off (`CODEGRAPH_TELEMETRY=0`, `DO_NOT_TRACK=1`).

## One-time setup per clone

1. Approve the `codegraph` server when Claude Code asks about `.mcp.json` (check `/mcp`).
2. Build the index once. Ask your human before running it, because it downloads the pinned npm package:

   ```bash
   CODEGRAPH_TELEMETRY=0 npx -y @colbymchenry/codegraph@1.6.2 init
   ```

   This creates `.codegraph/` (gitignored, never commit it). After that the MCP server keeps it in sync on every file change.

Do not run `codegraph install`. It writes global agent config and edits `CLAUDE.md`, which the team manages by hand.

## Use

- Main agent: call `codegraph_explore` with a question that names a file or symbol, for example "how does commit reach reveal in the contract" or "callers of finalizeRound". It returns verbatim source, call paths and the blast radius in one call. Check its staleness banner after edits.
- Subagents and scripts, which don't see the MCP tool, use the same index through the CLI: `npx -y @colbymchenry/codegraph@1.6.2 explore "<question>"`. Also `callers <symbol>`, `impact <symbol>`, and `git diff --name-only | ... affected --stdin` for the tests a change touches.
- If `.codegraph/` is missing, fall back to Read and Grep and tell your human the index isn't built.

Before changing an interface between scopes (ABI, encodings, evidence, `Workload`), run `impact` on the symbol and list the affected owners in the `INTERFACE` post.

## OpenZeppelin MCP

`.mcp.json` also registers the `openzeppelin` server (`@openzeppelin/contracts-mcp@0.8.1`, via `npx`). Approve it in `/mcp`. Use it to generate OpenZeppelin Contracts (ERC20, ERC721, access control, upgradeable variants) instead of hand-writing them, then review the output before committing.
