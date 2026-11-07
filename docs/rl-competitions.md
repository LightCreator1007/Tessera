# RL competitions

In an RL competition, entrants submit a policy instead of a predictions file. A contract can't run a policy, so verifiers run it, the same way they already replay training rounds. Each verifier runs every revealed policy on the host's hidden seeds in the sandbox and signs its mean return. The contract pays the best score once enough verifiers agree. It's `contracts/src/RLCompetitions.sol`, which has no admin, no pause and no upgrade, and it sits beside `Competitions.sol` without changing it.

## How one runs

1. **Host.** The host locks a prize and four other values. The first is the sha256 of the environment package, so everyone knows exactly what gets run. Then come the episodes per seed and the step limit. Last is a commitment to the evaluation seeds: `keccak256(abi.encode(keccak256(abi.encode(seeds)), salt))`. The environment is public so entrants can train on it. The seeds stay hidden until the deadline so nobody tunes a policy to them. Anyone can upload the environment file to the coordinator, which takes only the file whose sha256 the contract holds.
2. **Enter.** Each entrant commits `keccak256(abi.encode(id, wallet, sha256(policy), salt))` with an entry pass, and can replace it until the deadline. The policy file stays on the entrant's machine.
3. **Reveal the seeds.** Within one reveal window after the deadline, the host (or anyone with the seeds and salt) reveals them. If nobody does, every entrant can `claimShare` an equal part of the prize.
4. **Reveal policies.** Within the next window, each entrant reveals their policy hash and uploads the policy file. The coordinator takes it only once the reveal is on chain, and only if it hashes to the revealed value, so no policy is public early.
5. **Evaluate.** Each verifier reads the queue at `GET /v1/rl/evaluations`. It then re-reads every input from the chain: the seeds, episodes, step limit and both hashes. That way a wrong queue can't make it sign a wrong score. It downloads both files, checks their hashes, runs them and posts a signed `EvalResult(competition, entrant, policy, score)`. The score is the mean return over every seed and episode, times 1000 and rounded, so verifiers that agree sign the same integer.
6. **Post and settle.** Once `threshold` verifiers have signed the same score, anyone posts the signatures with `submitScore`. That's open until two windows after the seeds, so verifiers get a full window for the last policy revealed. Then anyone calls `settle`, which pays the best score, with ties going to the earlier commit. If nothing was scored, settle refunds the host.

## How a policy is run

`packages/workloads/tod_workloads/rl.py` is the evaluator. The environment and the policy each run in their own process, in their own sandbox container when Docker is on: no network, read-only, capped CPU and memory. The verifier's own code steps the environment with the policy's actions over pipes and adds up the reward itself. The policy only ever sends back an action, so it can't write its own score. Anything a package prints goes to stderr, so it can't fake a reply either. A package that crashes, hangs past 30 minutes or returns a reward that isn't a finite number fails the run, and the verifier tries again 5 minutes later.

- **Environment package:** an `env.py`, or a zip with it at the top, exposing an `Env` class with Gymnasium's API: `reset(seed=)` returns `(observation, info)` and `step(action)` returns `(observation, reward, terminated, truncated, info)`. It doesn't need the gymnasium package, and can't import it, because the sandbox only has what the node image has.
- **Policy package:** a `policy.py`, or a zip with it at the top, with `act(observation)` returning an action. Observations arrive as plain lists and numbers.
- **Seeding:** each seed seeds a fresh environment's first reset, and the episodes after it continue that RNG, as Gymnasium does.

`tod_workloads/rl_cartpole.py` is a reference CartPole environment in plain Python, with a simple balancing policy, used by the tests.

## Using it

The web app lists RL competitions under Competitions, hosts them at `/competitions/rl/new` and shows each one at `/competitions/rl/{id}`. The wallet signs every step: create, enter or replace, reveal seeds, reveal a policy, post a verified score, settle and claim a share. As with prediction competitions, the page makes you save a reveal file before you sign anything that needs one.

A network turns RL competitions on with `rlCompetitions` in its `networks/*.toml` (written by `scripts/deploy.py`) and `RL_COMPETITIONS` in the coordinator's environment. Verifiers start evaluating on their own when their network file names the contract. `POST /v1/identity/entry-pass` takes `"contract": "rl"` for a pass that this contract accepts.

## Limits and open questions

- Evaluation is free for now. Whether it's paid from the prize, a host budget or verifiers' existing rewards is still open.
- Verifiers that disagree leave an entry unscored. There's no tolerance, so an environment or policy that isn't deterministic for a seed won't get a score.
- The node image has to be rebuilt with this change before Docker-sandboxed verifiers can run RL packages. With `TOD_SANDBOX=off` they run as plain processes.
- RL competitions don't have the banner, settings or notebooks that prediction competitions have yet.
- Nothing here has run on Base Sepolia. The contract isn't deployed there.
