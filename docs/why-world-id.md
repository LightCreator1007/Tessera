# Why World ID matters for Tessera

Tessera pays people to train models on their own laptops. Anyone can join, nobody has to trust anyone else, and honest work is paid onchain. That openness is the point, and it is also the attack surface. This page explains what World ID protects in that system and why we think it's the right tool. The integration itself, step by step with every failure path, is in [world-id.md](world-id.md).

## Replay catches bad work, but not bad people

Our verifiers rerun every node's training and compare the bytes, so a node that fakes or skips its work is caught and loses its stake. Replay is very good at judging work. It can't tell who is behind a wallet.

Without an identity layer, a wallet is free. Someone caught cheating could throw away the slashed wallet, make a new one, stake again and come back the same afternoon. Each attempt costs them only the stake, and they can keep trying until a round slips through. A competition with a prize would have the same problem: one person could enter a hundred times from a hundred wallets.

World ID closes that gap by tying an owner to a unique human instead of a key.

## What World ID guarantees here

**One human, one owner wallet.** When a person verifies, World gives us a nullifier: a number that is the same every time that person proves themselves for our action, but says nothing about who they are. The NodeRegistry contract binds that nullifier to the owner's wallet the first time it joins, and reverts with `NullifierUsed` if the same person tries again from another wallet. This is enforced onchain, so it doesn't depend on our servers behaving.

**Punishment follows the person.** When verifiers confirm that someone's node cheated, the coordinator excludes that owner, and it excludes their nullifier too (`services/coordinator/identity/exclusions.py`). A fresh wallet doesn't help, because the same human produces the same nullifier. Cheating now costs your place in the network, not just one stake.

**One competition entry per human.** Entry passes for competitions are signed only for verified people, and the Competitions contract binds each pass to the entrant's nullifier. The same pass used from another wallet reverts with `BadPass`, so a prize goes to the best entry, not to whoever made the most wallets.

**A proof can't be stolen.** The proof's signal is the owner's wallet address, so a proof made for one wallet can't be replayed to join as another. The coordinator verifies it with World on the server, and the client never decides anything on its own.

## Why this is the minimum, and why it's enough

All we need to know is that an owner is a unique human, so we ask World ID for exactly that: Proof of Human, plus Selfie Check where it's available. We don't need a name, a nationality or an age, because none of those change whether someone can be trusted to train a model. Asking for more would only shrink the pool of people who can join, which works against a network built on many small contributors.

World ID also never puts anything personal onchain. The contract stores the nullifier and nothing else, and the nullifier is specific to our action, so it can't be used to follow a person across other apps.

## How it fits with the rest of the trust model

Each layer handles what it's best at:

- **Replay** decides whether a node's work is honest.
- **Stake** makes cheating cost money right away.
- **World ID** makes sure the person who cheated can't simply start over, and that rewards and prizes are spread across real people.
- **The contracts** enforce all of it without asking the coordinator for permission.

Together these let the network stay open to any hobbyist with a laptop, without turning into a contest of who can spin up the most wallets.

## What World ID doesn't do

It's worth being clear about the limits, so nobody relies on something it doesn't provide.

- One verified owner can run several nodes, and the matcher may seat more than one of them in the same round (#177). World ID limits wallets per person, not machines per person. Replay is what keeps each of those machines honest.
- The public stack currently runs World ID Sandbox for testing, so its identities are test identities, not production human verification.
- `WALLET_BYPASS=on` adds a "Skip World ID (demo)" button for demos. A wallet that skips verification has none of the guarantees above, so it should stay off outside demos.
