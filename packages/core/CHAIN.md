# Chain access and transaction recovery

`tod_core.ledger` binds the registry and market ABIs, decodes named contract errors and reads their events in chain order. `Network.load` reads a network TOML file; a key-bearing RPC URL is excluded from the configuration object's representation. Generate the ABIs before using the ledger.

`ChainState` reconstructs jobs, rounds and registered nodes from events and supports incremental reads. It uses latest blocks and does not unwind reorganizations; rebuild from scratch after a reorganization. Claimable balances and community-pool accounting still require contract reads.

`tod_core.txmgr` has one durable queue per chain and signing key. Journals contain signed transactions and must be kept private and durable. Only one process may use a signing key at a time. Receipts currently count after one confirmation. Replacement transactions retain the nonce and respect the configured fee cap; timeouts leave the transaction queued for recovery.

The deployment path uses capped, permissioned ToDToken; the faucet must hold MINTER_ROLE to issue TOD. The funding CLI uses `--tokens` with exact six-decimal amounts and preserves a send gate for public token-only allocations.

The deploy/fund scripts and deterministic `networks/anvil.toml` fixture support local integration tests. The public-label development keys are accepted automatically only on chain 31337. The nonlocal branch tests also use an isolated Anvil instance with a different chain ID; they never contact Base Sepolia.

Run the core encoding and ledger tests with Python 3.12+, the core package installed, Node and Foundry on PATH. The integration tests need permission to bind a local loopback port. Deployment scripts rebuild contracts and regenerate ABIs before wiring a fresh local deployment.
