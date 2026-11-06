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

With `docker/compose.worldid.yml` the coordinator signs a pass only after a real World ID check. Get one on the coordinator's `/v1/identity/test` page ("Entering and hosting competitions"), then pass its JSON to `competition.py host` or `enter` with `--pass`. `competition.py address --name NAME` prints the wallet to verify.

## Reading them

`GET /v1/competitions` and `GET /v1/competitions/{id}` read the contract's views and events and add a status (`open`, `awaiting-labels`, `scoring`, `ready-to-settle`, `settled`, `labels-hidden`, `refundable`) and a leaderboard. The web app's Competitions pages show them, with scores counted onchain. Each competition's `standings` lists every entrant, scored or not, and ties rank the way the contract breaks them: the earlier last commit wins.

`GET /v1/competitions/{id}/entries/{address}` is one entrant's standing. Once the entry is scored it also has the predictions it was scored on, read from the `revealEntry` call, with per-class accuracy and a confusion matrix (up to 20 classes). `GET /v1/owners/{owner}/competitions` lists what an address hosted and entered, with ranks, prizes won and shares claimed.

## Notebooks

An entrant can attach a notebook (`.ipynb`, `.md` or `.py`, up to 2 MB) that explains their entry. They post it to `POST /v1/competitions/{id}/notebooks` with an EIP-191 signature from their wallet over the competition, the wallet, the file name, its sha256 and the time, so the coordinator can't swap the file and nobody else can attach one for them. It can be replaced until the deadline.

Until the deadline, `GET /v1/competitions/{id}/notebooks` says only how many there are, so nobody reads the leader's approach while entries are open. After it, the list and each notebook (`GET .../notebooks/{address}`) are public, with the signed message, so anyone can check who wrote it. Notebooks live on the coordinator, not onchain, and play no part in scoring.

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

Hosts can use their own labels instead of MNIST (`--labels FILE`, one byte per item, with `--task` to say what's predicted), and entrants their own predictions (`--predictions FILE`, one byte per item). If a host misses the labels window, each entrant runs `$C claim-share ID --name NAME` for an equal part of the prize. A live competition's page says who acts next and shows the command.

## The host's listing

Prize, deadline, reveal window and item count are fixed on chain. Everything else the host sets from the competition's Settings page in the web app, and every change is signed by the host's wallet (EIP-191 over the competition id, what changed and its sha256), so the coordinator can't edit a listing and nobody else can:

- `POST /v1/competitions/{id}/settings` takes the exact JSON the host signed: title, summary, extra rules, links, tags, class names and whether notebooks are optional, expected or off. Each save is a version, and `GET .../settings` returns every version.
- `POST /v1/competitions/{id}/banner` takes a PNG, JPEG or WebP up to 1 MB, checked by its bytes. `GET .../banner` serves it.
- `POST /v1/competitions/{id}/resources` attaches a download of up to 10 MB: a starter kit, data, or an RL environment with its entrypoint, evaluation seeds, episodes and step limit. `GET .../resources` lists them.

All of it is editable until the deadline, except what entrants agreed to by entering: the extra rules, class names, notebook setting and any environment freeze once the first entry lands. Each competition in `GET /v1/competitions` carries its `listing`, `banner` and `resources`.

## Hosting and entering from the web

The web wallet signs everything: create (after approving the exact prize), enter or replace an entry, reveal labels, reveal an entry, settle and claim a share. Before a host creates or an entrant enters, the page makes them save a reveal file with the labels or predictions and the salt, and keeps a copy in the browser, because a commitment nobody can open is lost. The CLI below still works.

## Limits

Scoring is classification accuracy on one byte per item, so up to 256 classes. AUC, regression and other metrics would need a different scoring rule. There's no entry fee or compute budget yet. RL environments can be published and downloaded, but scoring RL entries needs the evaluator in `docs/rl-competitions.md`. Labels and predictions are revealed onchain, so they're public after the deadline. Don't host a competition on data you can't publish.
