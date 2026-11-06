# RL competitions

This is a proposal, not a shipped feature. Hosts can already publish an RL environment on a competition's Settings page, with its entrypoint, evaluation seeds, episodes and step limit, and entrants can download it. What doesn't exist yet is a way to score RL entries, because `Competitions.sol` scores by comparing prediction bytes with hidden labels, and an RL entry is a policy that has to be run to get a reward. A contract can't run it.

## How scoring would work

Verifiers run the evaluation, the same way they already replay training rounds:

1. **Host.** The host creates an RL competition with a prize, deadline and a commitment to the environment package and seeds: `keccak256(abi.encode(envSha256, keccak256(abi.encode(seeds))))`. The seeds stay private until the deadline, so nobody tunes a policy to them.
2. **Enter.** Each entrant uploads a policy package to the coordinator (sealed until the deadline, like notebooks) and commits `keccak256(abi.encode(id, wallet, policySha256, salt))` with an entry pass, as today.
3. **Reveal.** After the deadline the host reveals the seeds onchain, and each entrant reveals their policy hash and salt.
4. **Evaluate.** For each revealed policy, at least `THRESHOLD` verifiers run it in the locked-down Docker sandbox nodes already train in (no network, fixed CPU, the round container's limits) over every seed and episode, and sign `EvalResult(competition, entrant, policySha256, meanReturnScaled, envSha256)`. The return is scaled to an integer so every verifier signs the same bytes. Environments must be deterministic for a seed; a policy that isn't is the entrant's problem, since verifiers that disagree beyond a tolerance leave it unscored.
5. **Score and settle.** Anyone posts the threshold signatures to the contract, which records the score and pays the best one at settle. Ties and the no-reveal and no-entry rules stay as they are now.

## What each part needs

| Part | Owner | Work |
|---|---|---|
| Contract | Arunit | An `RLCompetitions` contract, or a scoring mode on `Competitions`, that accepts verifier-signed `EvalResult`s instead of `revealEntry`. Reuses `EntryPass`, settle and claim share. |
| Verifier and sandbox | Rounak | An `evaluate` job: fetch env and policy by hash, run Gymnasium for the seeds in the round container, sign the result. |
| Workloads | Dhairya | The policy package format (one `act(observation) -> action` entrypoint, pinned dependencies) and a reference CartPole environment for tests. |
| Coordinator | Ashutosh | Policy upload sealed until the deadline (the notebook route's pattern), an evaluation queue that hands jobs to verifiers, and collecting signatures. Environment upload is done. |
| Web | Ashutosh | An RL option in Host, policy upload in Enter, and per-seed returns on the entry page. Environment upload and display are done. |

## Open questions

- The return scale and the tolerance when verifiers disagree.
- Whether evaluation compute is paid from the prize, a separate host budget, or the verifiers' existing rewards.
- The largest policy package and longest evaluation a verifier should accept.
