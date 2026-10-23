# RUG LIFE

A live, spectated table game of takeovers for the Chog World Order — built for Chogathon 2026 (Monad, chain 143).

Your Chog's eyes decide your job. The whole collection is the deck. Every rug goes on the token's permanent record. Anyone in the stands can put a $CHOG bounty on your head.

**Everything in this repository was written after the Chogathon bell (2026-10-08 15:00Z).** Pre-existing work used: the Chog Genesis collection's own metadata and images (third-party), the rules designed on paper before the bell, and the open-source libraries in `package.json`.

## Testing it (judges)

Live at **https://ruglife.xyz**: nothing to install, no account, no transaction.

1. **Practice (no wallet, ~3 minutes).** Click **Practice first** in the lobby. It is a real game against two bots with a stacked deal and a coach that walks you through a fight, a Lock, a helper, a Rug, a jeet and a free choice. It runs in your browser and writes nothing.
2. **A live table (no wallet).** In the lobby type a table name, click **Open**, then **Sit with a loaner**, **Add a bot** once or twice, and **Deal**. Loaners are marked LOANER and keep no record. Anyone else can **Watch from the stands** from the stands.
3. **With a Chog (holders).** Click **Sign in with wallet** (an EIP-4361 signature: no gas, no approval, no transfer), pick one of your Chogs, open or join a table and sit with it. The server reads `ownerOf` live; your Chog's Eyes trait sets your role and its outfit is your kit. Its record is at `#/chog/<tokenId>`. A holder can let a friend play their Chog with a signed, expiring pilot key.

On a live table the clock is real (30 s for priority, 60 s for an airdrop), and silence takes the default shown on screen. First Chog to Level 10 wins: GLOBAL ALERT.

**What is built but switched off on the live site:** the $CHOG pots and bounties. `RugLifeEscrow` and the settlement path are written and tested (unit tests, plus a fork test against the real registry, proxy and $CHOG on Monad mainnet), but no escrow has been deployed, so the stands show no pot.

## Layout

| Package | What it is |
|---|---|
| `packages/protocol` | the types everything imports: actions, events, views, card rows, the wire protocol |
| `packages/engine` | the rules — pure and deterministic; `createGame · legalActions · apply · viewFor · botAction` |
| `packages/cards` | the card set and the per-token role table built from the collection's metadata |
| `packages/server` | tables, one WebSocket, EIP-4361 sign-in, pilot keys, `ownerOf` checks, bots and deadlines, the escrow link and settlement, the record |
| `contracts/` | Foundry: `RugLifeEscrow` (pots and bounties in $CHOG paid to a Chog's token-bound chest) and `SeasonStamp` (deployed off) |
| `fixtures/` | recorded games (config + actions + digest) that must replay byte-identically |

## Run it

```sh
npm install
npm test                      # rules fixtures, invariants over bot games, recorded replays
npm run sim -- --seats 4 --mode standard --games 20     # bot tables; --verbose prints every action and event
npm run sim -- --seats 6 --mode tournament --games 1 --verbose
```

### Server

```sh
npm run server                # :8795 by default; PORT, RUGLIFE_DOMAIN (the SIWE domain), RUGLIFE_URI
curl localhost:8795/health
```

Pots and bounties switch on when an escrow is configured: `RUGLIFE_ESCROW` (the deployed `RugLifeEscrow`), `RUGLIFE_SIGNER_KEY` (the result signer — a key that holds gas and nothing else), optional `RUGLIFE_SUBMITTER_KEY`, `MONAD_RPC`. Without them tables still play and nothing is settled. The server never holds or moves $CHOG; funders deposit from their own wallets into the ids the server publishes per table, and the server only signs results.

### Client

```sh
npm run build      # Vite build → packages/client/dist (the server serves it at /)
npm run client     # dev server on :5173 that talks to the game server on :8795
```

`packages/client` is React + Vite with `viem` for the wallet (no wagmi: an injected EIP-1193 wallet, sign-in by EIP-4361, pilot keys by EIP-712, $CHOG funding by permit + one transaction). It never computes rules: it renders `View` and offers `view.legal`. Screens: the lobby (tables, your Chogs read from the chain, loaners, bots, pilot keys), the table (seats, the fight panel, your hand, prompts for help / the sealed Rug / airdrops / trades, the stands with the pot and bounties, the news ticker), GLOBAL ALERT on a win, the Chog sheet (`#/chog/<tokenId>`), and Practice (`#/practice`): a real engine game in the browser against two bots with a stacked deal and a coach, labelled practice, writes nothing. Card pictures are the collection's own images from the project's IPFS gateway, by marketplace number.

### Contracts

```sh
cd contracts
forge build && forge test                                   # unit tests on mocks
forge test --match-contract ForkTest --fork-url https://rpc.monad.xyz   # the real registry, proxy and $CHOG on a Monad fork
```

`git clone --recurse-submodules` (forge-std is a submodule). The server tests read `contracts/out`, so build the contracts first; two of them spawn a local `anvil`.

`npm run tokens` rebuilds `packages/cards/src/tokens.json` from a local mirror of the collection's metadata (default `~/chogathon-prep/collection/metadata`). The role table must reproduce the counts Face 551 · Safecracker 277 · Muscle 277 · Lookout 267 · Sob Story 267 · Hacker 208 · Degen 112 · Legend 10 and the published hash; the tests check both.

## The engine in one paragraph

Same config + same actions ⇒ same events and the same digest, on any machine. Every shuffle, die and casting pick comes from a seeded generator inside the state. The server publishes the seed's hash at the start and the seed itself at the end, so anyone can replay a finished table. Hidden information (hands, the decks, sealed rug choices) is removed in `viewFor` and nowhere else. The server is a trusted referee and the product says so.
