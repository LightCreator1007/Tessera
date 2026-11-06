# Competitions

Anyone can host a prediction competition, and anyone verified as one person can enter it. The contract that holds the prize also scores the entries, so nobody has to trust the host or us with the result. It's `contracts/src/Competitions.sol`, and it has no admin, no pause and no upgrade.

## How one runs

1. **Host.** The host locks a prize in TOD and a commitment to the answer labels: `keccak256(abi.encode(keccak256(labels), salt))`. Only the hash is public until the deadline. The host picks the number of items (up to 10,000), the deadline and a reveal window (1 minute to 7 days).
2. **Enter.** Each entrant commits `keccak256(abi.encode(id, wallet, keccak256(predictions), salt))`. The commit names the competition and the wallet, so nobody can copy someone else's. An entry can be replaced until the deadline.
3. **Reveal the labels.** After the deadline, the host (or anyone holding the labels and salt) reveals them within the window. A reveal that doesn't hash to the commitment is rejected, so the host can't change the answers after seeing the entries.
4. **Reveal and score entries.** Within the next window, each entry is revealed and the contract counts how many predictions match the labels. Ties go to the earlier commit.
5. **Settle.** Once the window closes, anyone can call `settle`, which pays the best score.

## Who moves it, and what if nobody does

| Step | Who calls it | Why they would | If nobody does |
|---|---|---|---|
| create | Host | Wants the competition | Nothing happens |
| enter | Entrant | Wants to win | No entries; the host gets the prize back at settle |
| revealLabels | Host, or anyone with the labels | Otherwise the prize goes to the entrants | Every entrant can `claimShare` an equal part |
| revealEntry | The entrant, or anyone with their file | Only a scored entry can win | That entry isn't scored |
| settle | Anyone, usually the winner | Pays the winner | Stays claimable; nothing is lost |

## One entry per person

Entering, and hosting, needs an `EntryPass`: the admitter's EIP-712 signature that this wallet belongs to the person behind a World ID nullifier. The coordinator signs one at `POST /v1/identity/entry-pass`, after the same World ID check as joining the pool, and keeps one person to one wallet. The contract allows one wallet per nullifier per competition, and refuses an entrant with the host's wallet or nullifier, so a host can't enter their own competition with a second wallet.

## Reading them

`GET /v1/competitions` and `GET /v1/competitions/{id}` read the contract's views and events and add a status (`open`, `awaiting-labels`, `scoring`, `ready-to-settle`, `settled`, `labels-hidden`, `refundable`) and a leaderboard. The web app's Competitions pages show them, with scores counted onchain.

## Try it on the local stack

The web wallet doesn't sign transactions yet, so host and enter from the command line. The labels are the true digits of MNIST's canonical test images, which no ToD job trains or validates on, so a model trained on ToD can enter.

```sh
C="docker compose -f docker/compose.dev.yml exec coordinator python docker/dev/competition.py"
$C host --title "Read the digits" --items 1000 --prize 20 --open 420 --window 120
$C enter 1 --name entrant/alice --job 1          # predictions from job 1's trained model
$C enter 1 --name entrant/bob --accuracy 0.6     # random predictions, right about 60% of the time
$C reveal 1                                      # waits for the deadline, then reveals labels and entries
$C settle 1                                      # waits for the window, then pays the winner
$C status 1
```

## Limits

Scoring is classification accuracy on one byte per item, so up to 256 classes. AUC, regression and other metrics would need a different scoring rule. There's no entry fee or compute budget yet, though the web wizard has fields for both. Labels and predictions are revealed onchain, so they're public after the deadline. Don't host a competition on data you can't publish.
