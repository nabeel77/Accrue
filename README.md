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
cp .env.example .env          # then fill it in
pnpm run program:build        # anchor build, writes the program and its IDL
pnpm run program:client       # regenerates the typed client from that IDL
pnpm run program:test         # anchor test against a local validator
pnpm run db:generate          # regenerates the migration if the schema changed
pnpm run db:migrate           # applies migrations over DATABASE_DIRECT_URL
pnpm --filter @accrue/web dev # http://localhost:3000/app/kit
```

Every variable the code reads is listed in `.env.example`. No key is ever a value in that file: the admin key and the keeper key are paths to files that live outside this repository, and only the admin scripts read the first and only the keeper reads the second.

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
```

`program:test` starts the validator that ships with the Solana CLI rather than the one Anchor 1.x reaches for by default, so it runs on any machine that can build the program.

The commit hook runs the lint, the Rust format and lint, and the fast tests. The push hook runs the whole build including `anchor build`. Continuous integration runs all of it plus both dependency audits and the program suite.

Two of those checks exist to catch a specific mistake. `check:no-web3js` fails if any file of ours imports the old Solana client library instead of `@solana/kit`. `check:bundle-secrets` fails if the name of any server only variable from `.env.example` reaches a browser bundle.

## Test fixtures

`tests/fixtures` holds real mainnet accounts, captured at a recorded slot, that the program suite replays against: the lending market, its eleven reserves, the stock mints, the USDC and yield token mints, and the three programs the position calls. Each one records why it is captured.

```
HELIUS_RPC_URL=... pnpm run fixtures:refresh
```

Without an RPC URL the script falls back to the public endpoint, which is rate limited but enough for one capture. The accounts are public data; nothing private is ever committed here.

## Transactions

Accrue builds version 1 transactions first: 4,096 bytes, every address inline, at most 64 unique addresses, the compute limit and the priority fee in the message header. A wallet that does not advertise version 1 gets the version 0 path with address lookup tables instead. Every read of a transaction passes the maximum supported version, kept as one constant in `packages/solana`.

## Legal

The terms and the risk wording that will ship with the app have not been reviewed by a lawyer, and they are not legal, financial or tax advice. Before anyone other than the maintainer uses this with real money, a lawyer should read them, and the app needs a real contact address.

## Licence

Not chosen yet. The hackathon requires a public open source repository, so a licence has to be added before submission, and the choice belongs to the maintainer.
