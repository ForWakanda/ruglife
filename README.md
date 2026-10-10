# RUG LIFE

A live, spectated table game of takeovers for the Chog World Order — built for Chogathon 2026 (Monad, chain 143).

Your Chog's eyes decide your job. The whole collection is the deck. Every rug goes on the token's permanent record. Anyone in the stands can put a $CHOG bounty on your head.

**Everything in this repository was written after the Chogathon bell (2026-10-08 15:00Z).** Pre-existing work used: the Chog Genesis collection's own metadata and images (third-party), the rules designed on paper before the bell, and the open-source libraries in `package.json`.

## Layout

| Package | What it is |
|---|---|
| `packages/protocol` | the types everything imports: actions, events, views, card rows, the wire protocol |
| `packages/engine` | the rules — pure and deterministic; `createGame · legalActions · apply · viewFor · botAction` |
| `packages/cards` | the card set and the per-token role table built from the collection's metadata |
| `packages/server` | tables, sockets, sign-in, ownership checks, settlement (in progress) |
| `fixtures/` | recorded games (config + actions + digest) that must replay byte-identically |

## Run it

```sh
npm install
npm test                      # rules fixtures, invariants over bot games, recorded replays
npm run sim -- --seats 4 --mode standard --games 20     # bot tables; --verbose prints every action and event
npm run sim -- --seats 6 --mode tournament --games 1 --verbose
```

`npm run tokens` rebuilds `packages/cards/src/tokens.json` from a local mirror of the collection's metadata (default `~/chogathon-prep/collection/metadata`). The role table must reproduce the counts Face 551 · Safecracker 277 · Muscle 277 · Lookout 267 · Sob Story 267 · Hacker 208 · Degen 112 · Legend 10 and the published hash; the tests check both.

## The engine in one paragraph

Same config + same actions ⇒ same events and the same digest, on any machine. Every shuffle, die and casting pick comes from a seeded generator inside the state. The server publishes the seed's hash at the start and the seed itself at the end, so anyone can replay a finished table. Hidden information (hands, the decks, sealed rug choices) is removed in `viewFor` and nowhere else. The server is a trusted referee and the product says so.
