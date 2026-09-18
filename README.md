# Accrue

Accrue puts tokenized stocks on Solana to work without selling them, and guards the position with code.

You deposit a stock token as collateral in a lending market, borrow USDC against it, and put that USDC into a yield token that targets more than the loan costs. You keep the stock and all of its upside. An on chain program owns the position in an account only you can empty, and repays part of the loan when the stock falls, before the market can liquidate you. Anyone can run that guard. Nobody can redirect it.

The program and the guard bot are written and tested. The web app is still a skeleton. The sections below describe what exists today, and the plan states what each later phase adds.

## Status

| Part                                     | State                                |
| ---------------------------------------- | ------------------------------------ |
| Monorepo, toolchain, hooks, CI           | Done                                 |
| Program, IDL, generated client           | Done, every instruction              |
| Database schema and first migration      | Generated, applied by the operator   |
| LiteSVM harness on mainnet snapshots     | Done, 33 accounts at a recorded slot |
| Position instructions, invariants, guard | Done, tested against both routers    |
| Keeper loop                              | Done, tested a whole round at a time |
| Web app, rescue page                     | Skeletons only                       |

Nothing here is deployed. There is no program id on mainnet yet, no audit, and no live site.

## What the program can do

The permission table is the point of the whole design, so it is stated before anything else.

| Instruction           | Who may call it   | What it does                                                                                                                                  |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_config`   | deployer, once    | Writes the first config.                                                                                                                      |
| `update_config`       | admin             | Changes limits and the enabled lists, within caps written in the code. Touches no position.                                                   |
| `set_paused`          | guardian or admin | Pauses new positions and grows. Nothing else.                                                                                                 |
| `set_sunset`          | admin             | Retires the program: opens stop forever and anyone may return any position to its owner.                                                      |
| `open_position`       | owner             | Deposits the stock, borrows USDC, swaps it into the yield token.                                                                              |
| `add_collateral`      | owner             | Moves more stock in.                                                                                                                          |
| `repay`               | owner             | Repays with USDC from the owner's wallet. Works while paused.                                                                                 |
| `withdraw_collateral` | owner             | Sends stock back, if the position stays at or below target.                                                                                   |
| `set_strategy`        | owner             | Changes the guard parameters, inside the bounds.                                                                                              |
| `switch_destination`  | owner             | Sells one yield token, buys another.                                                                                                          |
| `unwind`              | owner             | Sells, repays everything, returns everything. Works while paused.                                                                             |
| `rescue`              | owner             | No conditions of any kind. Returns every token and withdraws what the market allows.                                                          |
| `close_position`      | owner             | Closes empty accounts and returns the rent.                                                                                                   |
| `protect`             | anyone            | When the position is at or above its guard level, sells just enough yield token to repay down to target, and pays the caller a capped bounty. |
| `grow`                | anyone            | When the position is below its grow level, borrows back up to target and buys more yield token.                                               |
| `leave`               | anyone            | When the market flags the stock for retirement, returns everything to the owner, no fee.                                                      |

Every token that leaves a position goes to one of three places: the lending market, the owner's wallet, or the capped bounty. The code has no fourth path.

## The security model

- There is no pooled vault. Each position is its own account and the program is the only thing with power over it.
- No key anywhere can move a user's tokens. The web app holds no key of any kind. The keeper holds a fee payer key that the program grants no power to.
- The admin key can change limits and the enabled lists for new positions, and the guardian key can pause new positions and grows. Neither can touch an existing position, block an exit, or raise the fee of a position that is already open.
- The admin's power over the enabled lists includes the oracle feed a destination is priced from: `update_config` rewrites a destination entry whole, so the admin can change its Scope price account and feed index. That is the price the program computes the floor of a permissionless swap from, so an admin who set it wrongly could let a guard sell at a price the market does not agree with. It changes nothing about who may move a token, and the owner can always leave through `rescue`, which reads no oracle at all.
- The borrow side is fixed. The config names one borrow mint and one borrow reserve, each position copies both when it opens, and every later instruction checks the reserve it was handed against the position's own record rather than against the config, so a later config change never redirects an open position.
- The fee is copied into the position when it opens, so a later config change never reaches it.
- `rescue` has no conditions, needs no oracle, no swap route and no keeper, and ignores every pause. It is the promise that no state of this software can trap funds.
- Every instruction that calls another program ends with the same checks, through one shared function: balances before and after, the obligation untouched by any swap, the lamports and existence of all four accounts, a minimum output the program computed itself, and a deny list on the accounts handed to the swap router.
- The guard triggers on the lending market's own refreshed loan to value, so there is never a disagreement between what the guard acts on and what a liquidator sees.
- All value arithmetic is checked, in `u128`, with rounding always against the position.
- The rescue page is a single static file with no server and no dependency on any Accrue domain. Anyone can host it.

Report a security issue privately to the maintainer before disclosing it.

## Repository layout

```
programs/accrue          the program
apps/web                 Next.js App Router: pages, API routes, wallet, cron. No key.
apps/keeper              the guard bot, long running, one fee payer key read from a file path
apps/rescue              one static page that talks to the program directly, no server
packages/core            pure logic with tests, no network and no chain imports
packages/solana          kit clients, the generated program client, the adapters, the assembler
packages/db              Drizzle schema, migrations and repositories over Postgres
tests/programs           the honest and the hostile test swap programs, never deployed
tests/fixtures           mainnet account snapshots the program suite replays against
scripts                  client generation, fixture capture, CI checks
```

## Requirements

| Tool       | Version                                                              |
| ---------- | -------------------------------------------------------------------- |
| Node       | 24 or newer                                                          |
| pnpm       | 10.12.1                                                              |
| Rust       | stable, 1.98 or newer                                                |
| Solana CLI | 4.2.2 or newer, for platform tools that understand Rust edition 2024 |
| Anchor     | 1.2.0, through `avm`                                                 |

```
sh -c "$(curl -sSfL https://release.anza.xyz/v4.2.2/install)"
cargo install --git https://github.com/solana-foundation/anchor avm --locked --force
avm install 1.2.0 && avm use 1.2.0
```

## Running it

```
pnpm install
cp .env.example .env                        # the scripts you run from here
cp apps/web/.env.example apps/web/.env      # the web app
cp apps/keeper/.env.example apps/keeper/.env  # the guard
pnpm run program:build        # anchor build, writes the program and its IDL
pnpm run program:client       # regenerates the typed client from that IDL
pnpm run program:test         # anchor test against a local validator
pnpm run db:generate          # regenerates the migration if the schema changed
pnpm run db:migrate           # applies migrations over DATABASE_DIRECT_URL
pnpm --filter @accrue/web dev # http://localhost:3000/app/kit
```

There are three example files, one for each thing that reads them. `apps/web/.env.example` is what the web app deploys with and names no key and no folder at all. `apps/keeper/.env.example` names one key path, the fee payer, and nothing else it could sign with. The one at the root is for the scripts you run from a laptop, and is the only one that names the admin key or a folder on your machine. `SOLANA_CLUSTER` decides what chain everything means and `HELIUS_RPC_URL` is the single endpoint pointed at it. No key is ever a value in any of the three: keys are paths to files that live outside this repository.

## Checks

```
pnpm run typecheck
pnpm run lint
pnpm run test              # the fast suite
pnpm run test:litesvm      # the program suite, needs pnpm run program:build first
pnpm run program:test      # deploys to a local validator and tests against it
pnpm run rust:fmt
pnpm run rust:clippy
pnpm run check:no-web3js
pnpm run check:bundle-secrets
pnpm run check:no-test-code
pnpm run check:web-reads-no-paths
```

`program:test` starts the validator that ships with the Solana CLI rather than the one Anchor 1.x reaches for by default, so it runs on any machine that can build the program.

The commit hook runs the lint, the Rust format and lint, and the fast tests. The push hook runs the whole build including `anchor build`. Continuous integration runs all of it plus both dependency audits and the program suite.

Four of those checks exist to catch a specific mistake. `check:no-web3js` fails if any file of ours imports the old Solana client library instead of `@solana/kit`. `check:bundle-secrets` fails if the name of any server only variable reaches a browser bundle. `check:no-test-code` fails if the app imports anything from the end to end harness or if the harness reaches the built output. `check:web-reads-no-paths` fails if anything the web app deploys with names a key path or a folder.

## Test fixtures

`tests/fixtures` holds real mainnet accounts, captured at a recorded slot, that the program suite replays against: the lending market, its eleven reserves, the stock mints, the USDC and yield token mints, and the three programs the position calls. Each one records why it is captured.

```
HELIUS_RPC_URL=... pnpm run fixtures:refresh
```

Without an RPC URL the script falls back to the public endpoint, which is rate limited but enough for one capture. The accounts are public data; nothing private is ever committed here.

## Transactions

Accrue builds version 1 transactions first: 4,096 bytes, every address inline, at most 64 unique addresses, the compute limit and the priority fee in the message header. A wallet that does not advertise version 1 gets the version 0 path with address lookup tables instead. Every read of a transaction passes the maximum supported version, kept as one constant in `packages/solana`.

## The devnet sandbox

Kamino, Jupiter, xStocks and ONyc do not exist on devnet, so the sandbox runs our own copies of all
of them. Everything a user would touch is the real code; everything around it is a stand in.

| Part               | On devnet                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| The Accrue program | the real thing, built with the `devnet` cluster feature                                                       |
| The keeper         | the real thing                                                                                                |
| The lending market | Kamino's own lending and farms programs, built from their public source under ids we hold the keys to         |
| The oracle         | `tests/programs/price-feed`, a program of ours that writes prices into an account shaped exactly like Scope's |
| The swap router    | `tests/programs/honest-swap`, which fills at a rate an admin sets                                             |
| The tokens         | mock mints with the decimals, token programs and oracle feed indices of the real ones                         |

Nothing here is worth anything. The stock tokens are minted by a faucet on request.

### Addresses

| What                   | Address                                        |
| ---------------------- | ---------------------------------------------- |
| Accrue program         | `6KUwCyECUrvjppwAe92FxTqHLvw2LKGmfkV7j37r6gBb` |
| Lending market program | `7z1AjuAV2Pn5SE2mGsRskYmZw4RTCYXVKwwsf2ydBvmM` |
| Farms program          | `DqHZVmT1jvqYUDvz2LWyHcxpz9TT2BX88Jnmm1bTp2v8` |
| Swap router            | `8mFrzd3bJ4Czmi8ee5tJUDmCDLByBaUbP6vUUzpCsYWW` |
| Price program          | `5Dgwh9uaimvaibD6xNxsE2yMRGRvbnq6ssVtTouAhLbA` |
| Prices account         | `C88HB7ajhR6ZrAawBwt9FV2yFnvQWTYy6Atg6pFSPX9j` |
| Lending market         | `DXfxsBp3TZmGLr3GPqGjRwuWZRGLXcBp8bZ6ecX2x8FS` |
| Accrue config          | `Cq9xYk1PXtU9coPs1xejgVmhyHrWpSUXeWTg3tWnZgeU` |

| Token | Mint                                           | Reserve                                        |
| ----- | ---------------------------------------------- | ---------------------------------------------- |
| USDC  | `BUxHx9ydngE2JjZaCi6NYBPdpLtewo3NVsbq9DBpHjpy` | `NSYE1BeJDFfyk3rwyPKMUrX4vCvH4DhUXBL39ANHupS`  |
| NVDAx | `7JMviovZ1qEJBhXhVwG9zXqViBpc2cQZs9VN3ABXrpxH` | `23BiiMnHnuu1QQyWE2kKckus5sqDiAiTy9k7PUFK5vUc` |
| SPYx  | `5xtbHf6eq7GQH2JNc8BP3u1iWA3nY45rh7n6NCcYRYSV` | `xpnNAZSeFsBManao5zYuTBzan2B6HKgaBzV2BsLtHi4`  |
| ONyc  | `7aEvt3TXHMEDHfYTguxRbCfxW6XVbBE6rQVqu33h4YnN` | `DhVcaWL7BxtYq2dTpujo1ChX9HSN3qpx3aved1Ns6mcv` |

USDC and ONyc use the classic token program with mainnet's decimals. NVDAx and SPYx are Token 2022
mints with the scaled UI amount extension and a permanent delegate, as the real stock tokens are.
The same generated files hold these addresses for the program and for the client:
`programs/accrue/src/clusters/devnet.rs` and `packages/solana/src/clusters/devnet.ts`, both written
by `pnpm run devnet:clusters`.

### Test tokens

```
pnpm run devnet:faucet <wallet address>   # one grant of every token
pnpm run devnet:faucet:serve              # the same over HTTP, one grant per wallet a day
```

The faucet server holds the mint authority as a file path and answers only callers that send the
shared secret, so the web app calls it from its own server and never from a browser.

### Running the scripts

Every script reads `DEVNET_KEYPAIR_DIR` for the keypairs of the programs, mints and market it
created, and writes the addresses it makes into `addresses.json` beside them. Only public addresses
are ever committed. All of them are safe to run again: each one skips what already exists.

```
pnpm run devnet:build-kamino   # builds the lending and farms programs under our own ids
pnpm run devnet:prices         # creates the prices account and writes one full set
pnpm run devnet:prices:serve   # the price service: rewrites every price, and walks the market
pnpm run devnet:mints          # the four mock mints
pnpm run devnet:router         # the swap pools and their vaults
pnpm run devnet:market         # the lending market, its four reserves and a million USDC of liquidity
pnpm run devnet:clusters       # writes the two generated cluster files from what is deployed
pnpm run devnet:smoke          # the whole life of a position, on chain
pnpm run devnet:market-controls # we own the market, so the guard's triggers can be set by hand
```

`pnpm run devnet:smoke -- --one-transaction` opens in a single call with the route carried inline,
and prints what the transaction weighs. The two call shape the rest of the script uses is what the
program's own suite does, so a hostile route can be aimed at the swap on its own; it is not a limit
of the transaction format. One such open measured 1,321 bytes of the 4,096 allowed and 34 unique
addresses of the 64.

Because the sandbox market is ours, the two guard triggers a keeper cannot cause can be set by
hand:

```
pnpm run devnet:market-controls reserve-status NVDAx obsolete      # then active again
pnpm run devnet:market-controls individual-deleverage-period 3600  # once, before any marking
pnpm run devnet:market-controls mark-for-deleveraging <obligation> 20
pnpm run devnet:market-controls mark-for-deleveraging <obligation> 255   # 255 clears it
pnpm run devnet:market-controls borrow-rate USDC 500                # a loan that costs 5% a year
```

A sandbox reserve nobody borrows from lends at nothing, and a loan that costs nothing makes every
net yield on screen look like the whole yield. `borrow-rate` writes the reserve's curve so the
first point, which is what today's utilisation pays, is the rate given in basis points.

`pnpm run devnet:prices -- --move NVDAx=-32` moves one price by a percentage, which is how a
protect is triggered in a demo. The swap router follows the oracle on every write, so a guard's
fill and its floor never drift apart. `pnpm run devnet:smoke -- --leave-it-open` stops after the
position is open and holding the yield token, which is what a keeper run needs in front of it.

The price service writes every price on one interval and moves the market on another. It writes
faster than the config's `ACCRUE_CONFIG_MAX_PRICE_AGE_SLOTS` allows a price to be old, whatever
`DEVNET_PRICE_WRITE_SECONDS` says, because a guard spends every cycle refusing to act on a stale
price otherwise. At 150 slots that window is about a minute, so it writes every twenty seconds.

Every five minutes it takes one step per stock: a small random move pulled back toward the book
price, and about once an hour a fall of twenty to twenty five percent that climbs back over the
steps that follow, so a protect and later a grow happen on their own. No step leaves a price
outside the bounds the reserve carries, because the market refuses one that does. The yield token
is not walked: it rises at its published rate. Every step is logged with the token, the old price,
the new price and why. The knobs are in `.env.example`.

Behind the faucet's shared secret it also answers `POST /move` with a symbol and a percent, and
`POST /reset`, which is what the app's own devnet block on position detail calls.

```
pnpm run devnet:prices:serve &
SOLANA_CLUSTER=devnet tsx apps/keeper/src/index.ts
```

With that running, a price write and the protect it triggers landed two seconds and fourteen slots
apart.

Set `SOLANA_CLUSTER=devnet` for anything that reads an address, including the keeper. Nothing in
`apps/` or `packages/` names a cluster: the program ids and the swap router both come from the
cluster module.

### Building for devnet

Both Kamino programs and Accrue itself are built for the older on chain architecture, which sizes
call frames at run time:

```
cargo-build-sbf --arch v1 --features devnet --manifest-path programs/accrue/Cargo.toml -- --no-default-features
solana program deploy target/deploy/accrue.so --program-id <keypair> --max-len <size plus a fifth> --url devnet
```

The default architecture gives every call a fixed four kilobyte frame, and the lending market's own
`init_lending_market` and `init_reserve` need more than that to build a reserve. On the default
target they fault the moment they are called; `--arch v1` is what makes them run.

## Legal

The terms and the risk wording that will ship with the app have not been reviewed by a lawyer, and they are not legal, financial or tax advice. Before anyone other than the maintainer uses this with real money, a lawyer should read them, and the app needs a real contact address.

## Licence

Not chosen yet. The hackathon requires a public open source repository, so a licence has to be added before submission, and the choice belongs to the maintainer.
