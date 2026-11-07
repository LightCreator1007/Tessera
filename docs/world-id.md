# World ID in ToD

## The moment that needs trust

ToD pays people for training work, and a node's seat in a round is worth real tokens. If one person could run a hundred nodes, they could fill every seat of a job, collect most of its pay, and outvote the honest nodes in the merge. Verifiers replay every node's work, so a fake result gets caught, but replay can't tell that ten nodes belong to the same person. That's what World ID is for: **one human, one node**, checked at the moment a laptop joins the pool, before it can be seated in any paid round.

The same nullifier also gives us a lasting handle on a person, not a wallet. When verifiers confirm that someone's node cheated, the coordinator excludes that owner. A fresh wallet can't bring them back, because their World ID nullifier is refused too (`services/coordinator/identity/exclusions.py`).

## Which credential, and why it's the minimum

We accept Selfie Check and Proof of Human (Orb). World ID only gates joining the pool. The matcher (`services/coordinator/scheduler/__init__.py`) seats any joined node whatever its owner's credential, skipping only owners excluded for cheating. Each node is its own seat, so one owner's several nodes can train in the same round.

We don't ask for a passport, because nationality and age don't matter here, and asking for more than the job needs would only shrink the pool.

## The flow

1. On the laptop, `tod-node pair --owner <wallet>` prints a pairing code: the node's consent, signed by its own key, naming the owner wallet.
2. The owner opens the join page and enters the code. IDKit asks World ID for one credential, with the signal `tod-owner:<wallet>`, and the coordinator signs the request through `/v1/identity/rp-signature`. That route is rate-limited and only signs our own action.
3. The browser sends the IDKit result to `POST /v1/identity/join`. The coordinator, on its server (`services/coordinator/identity/worldid.py`):
   - checks the environment and action are ours, and that there's exactly one accepted credential;
   - checks the signal hash is this owner's wallet, so a proof can't be replayed to join someone else;
   - verifies the proof with World's `POST /api/v4/verify/{rp_id}`, and accepts nothing on anything but `success: true`;
   - refuses an excluded owner or nullifier;
   - then signs an invite with the admitter key the NodeRegistry contract knows.
4. The owner submits `NodeRegistry.join(...)` with the invite and stakes. The contract binds the nullifier to that owner and reverts `NullifierUsed` if the same human tries again from another wallet.

The client never decides anything. Its result only counts after the coordinator has verified it with World, and the contract enforces uniqueness on its own.

## Paths that don't end in a seat

| Path | What happens |
|---|---|
| The user cancels in World App or the simulator | No result reaches the coordinator, so no invite is signed and the node can't join |
| The credential isn't available (Selfie Check in the simulator, in our tests) | IDKit reports `credential_unavailable`, and the page says so. The user picks Proof of Human instead |
| A proof made for another wallet | Refused: "World ID proof was made for a different wallet" |
| Same human, second wallet | Onchain `NullifierUsed`; the web app explains "This World ID already runs a node. One person, one node." |
| An owner excluded for cheating | Refused at join, by owner and by nullifier |

## Where it runs today

The coordinator side is complete and tested (`services/coordinator/identity/test_worldid.py` and `services/coordinator/identity/test_identity.py`). On World ID staging it was verified live on 6 November with the simulator's Proof of Human: the coordinator verified the proof with World and signed an invite. The coordinator's `/v1/identity/test` page runs the whole join with IDKit, or gets a competition entry pass (see docs/competitions.md). On 7 November an entry pass from the simulator's Proof of Human entered competition 3 on the local chain: the contract bound that World ID nullifier to the entrant's wallet, and the same pass from another wallet reverted `BadPass`. IDKit in the main web app's join flow is in progress (#119). For a local demo, `docker/compose.worldid.yml` switches the dev stack from dev mode to World ID staging.

The public coordinator (`docker/compose.prod.yml`) runs World ID Sandbox for the team's Sandbox phone app. `WORLD_ID_ENV: sandbox` controls the backend's expected proof environment and `/v1/identity/config`; the website reads that config and passes `sandbox` to IDKit automatically. Sandbox uses the same verification endpoint, `https://developer.world.org/api/v4/verify/{rp_id}`. No separate Vercel setting is needed. These are test identities, not production human verification. Staging is a separate environment for the browser simulator, which gave every simulated identity the same nullifier. Use `production` only when switching to the public World ID app and production identities.

## Integration debrief

- **Time to first success:** **Open:** fill in from the team's log.
- **Friction:**
  - Our test page defaulted to Selfie Check, and the simulator answered `credential_unavailable` for it. Nothing said why, and we lost time before trying Proof of Human, which worked.
  - Binding a proof to a wallet needs the signal hashed exactly as World does (`hash_to_field` of `tod-owner:<wallet>`). It's easy to get subtly wrong, and the only symptom is a verify failure.
  - Our first invite failed onchain with `BadSignature`, because the coordinator's admitter key didn't match the one the registry was deployed with. That one was ours, so the coordinator now refuses to start with the wrong admitter.
- **Missing:** a server-side verify example in Python (ours was written from the HTTP docs), and a clear table of which credentials the staging simulator can actually produce.
- **Highest-impact improvement:** have the simulator produce every credential the docs offer, or say up front which ones it can't, so teams don't build around a credential they can't test.

## Demo bypass

With `WALLET_BYPASS=on` the coordinator adds `POST /v1/identity/bypass`, and `/v1/identity/config` reports `walletBypass: true`. The verify page then shows "Skip World ID (demo)" next to the World ID button. It records the wallet as one person with the `dev` credential (the same record `/v1/identity/admit` writes), so joining and entering competitions read it like any other verified wallet. World ID itself is unchanged and still works for anyone who uses it.

It is weaker than World ID: it doesn't prove the caller owns the address, one person can use several wallets, and a wallet bypassed this way can't later link a World ID (409). Leave it `off` outside demos.
