# Vendored: ethskills

| | |
|---|---|
| Source | https://github.com/austintgriffith/ethskills (also served at https://ethskills.com) |
| Commit | `47779e720e99c0d5014c0612a08500bdd565108f` (2026-10-26) |
| Licence | MIT, as stated in the upstream README ("## License: MIT") and `.claude-plugin/plugin.json`. Upstream ships no LICENSE file. Copyright Austin Griffith and contributors. |
| Vendored | 2026-11-03 by Arunit's agent |
| Files | `SKILL.md` (root router) → `ethskills/`; `<skill>/SKILL.md` → `<skill>/` for all 22 skills listed in the router |
| Local changes | Only `ethskills/SKILL.md`: one "Local copies in this repository" section before `END ETHSKILLS`. Every other file is byte-identical to upstream at the commit above (checked against https://ethskills.com on the same day). |

Not vendored: the `audit` domain checklists. `/audit` loads them at run time from `austintgriffith/evm-audit-skills` at the pinned commit `ffe4b670e78e1945bcf275f79d4b7b0481bcff35` (MIT), so the content cannot change under us.

## Update

Re-read the upstream diff before updating. These files steer every teammate's agent, so treat an update like a dependency bump.

```bash
SHA=<new commit>
for s in why ship crops protocol gas wallets l2s standards tools building-blocks orchestration addresses concepts security audit noir testing indexing frontend-ux frontend-playbook qa feedback; do
  curl -sSfL -o .claude/skills/$s/SKILL.md "https://raw.githubusercontent.com/austintgriffith/ethskills/$SHA/$s/SKILL.md"
done
# The root router: re-apply the "Local copies" section after copying
curl -sSfL -o /tmp/ethskills-root.md "https://raw.githubusercontent.com/austintgriffith/ethskills/$SHA/SKILL.md"
```
