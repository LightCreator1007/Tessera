# What got in the way with Arkiv

Everything here happened while building ToD at ETHGlobal Mumbai, on the Rabdi testnet, between 6 and 8 November 2026. Each item says how to reproduce it.

## 1. The keyless RPC rate-limits a normal write path within minutes

Our coordinator runs two publishers (models and data shards). Each one polls `arkiv_query` to find an existing record before creating, then `eth_estimateGas`, `eth_getTransactionCount` and `eth_getTransactionReceipt`. With both running against the keyless RPC, writes started failing with `429 Too Many Requests` after a few minutes. Our retry logic counted every 429 as a failure, so a model gave up before it was ever indexed. A teammate's read-only `arkiv_query` was rate-limited the same way.

Repro: run two loops that each call `arkiv_query` every 2 to 5 s against `https://rpc.rabdi.db-chain.testnet.arkiv.network` with no `X-API-KEY`.

What would help: the 429 body or a `Retry-After` header saying how long to wait, and the limit written down in the docs next to the RPC URL. We now wait 60 s on a 429 without counting it (#129), but we guessed that number.

## 2. Getting tGLM and an access key needs a browser wallet

Both the faucet (`hub.arkiv.network/faucet`) and the access-key page need a connected browser wallet. Our writer key is a server key that never goes into a browser wallet, so we claimed tGLM into a personal wallet and sent it on. The hub pages also render client-side only, so we couldn't find the faucet's rules (amount, cooldown) without connecting a wallet.

What would help: a faucet that takes a pasted address, or one documented `curl`.

## 3. A hex literal in a query must say its type

`$key = 0x846a…` fails with `a hex literal must carry its type — write addr(0x…), key(0x…), bytes32(0x…) or u256(0x…)`. The error is clear, and it's the best one we hit. But the docs examples we found filter on attributes, not on `$key`, so our first lookup by key failed.

Repro: `arkiv_query` with `$key = 0x<any entity key>`.

## 4. Nonces must be read at `latest`

Asking for the nonce at `pending` is rejected, because Rabdi serves state at the chain head only. Most Ethereum tooling defaults to `pending`. Our client reads at `latest` and never re-signs, which is fine for one writer per key, but two processes sharing a key would collide.

What would help: say this in the write guide, with the recommended pattern for more than one writer.

## 5. Adding a field after the create means learning a second operation

We wanted to create a model's record straight away and add its Swarm reference later, when the upload worked. That's an update op, with its own encoding we'd have had to get right without examples. We chose to retry Swarm a few times and then create without the reference (#129). An SDK-level "patch these attributes" call, or one documented update example over raw JSON-RPC, would have saved the detour.

## 6. Lifetimes are in blocks

`expiresIn` counts 2 s blocks, capped at 7,884,000. We convert from days ourselves. A `days` helper in the SDK, and the cap in the error message when it's exceeded, would help. For a while our demo records were set to 1 day and would have expired before judging. Nothing warns you that a short lifetime is short.

## What worked well

Writing over plain JSON-RPC from Python (no SDK) was straightforward once `execute((uint8,bytes)[])` was encoded. Typed, indexed attributes with `ORDER BY job:u64 DESC` gave us exactly the listing the web app needs, and filtering on `$owner` makes spoofed records harmless.
