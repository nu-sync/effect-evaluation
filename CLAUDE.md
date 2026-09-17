# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is **Bun** (not Node for dev); recipes are in the `justfile`.

```sh
just                 # list recipes
just check           # typecheck + test + build  (run before calling work done)
just test            # bun test — no network, no API key (47 tests; README/SPEC still say 20)
just test-watch
just typecheck       # tsc --noEmit over src, test, and examples
just build           # bun build (transpile only) + tsc -p tsconfig.build.json for .d.ts
just key             # report whether a live API key is configured, and where

just web             # serve + open the classification demo (port 3000)
just guardrails      # serve + open the guardrails demo
just serve           # serve without opening a browser
just cli             # classification demo in the terminal
just cli-guardrails  # guardrails demo in the terminal
just record          # re-record both demos' fixtures — needs a key, spends tokens
```

One test file: `bun test test/client.test.ts`. One test by name: `bun test -t "retries a 429"`.

## Layout

```
src/        the published package, effect-systemone (no deps beyond peer `effect`)
test/       bun:test suites; test/web.test.ts drives the demo server via happy-dom
examples/   two cookbook replications + the Effect HTTP server that hosts both
docs/       local summaries of TypeSafe's primitives and 13 cookbooks; docs.md is the index
SPEC.md     layer 1 (this client) as built; layer 2 (an evaluation framework) as a plan only
```

`SPEC.md`'s layer 2 is unimplemented — nothing there is a contract. Its layer 1 section records *why*
the client is shaped the way it is, and is the right place to look before changing a design decision.

The `typesafe-docs` skill (`.agents/skills/`) routes to `docs.md`. Read `docs/primitives.md` before
touching request construction or response decoding — it holds the exact wire shapes this client
decodes against.

## What the library is

`Jev` is not a language model: one request carries a `state` plus a map of named questions, and the
response is one probability distribution per question with no text. `LanguageModel` in
`effect/unstable/ai` cannot represent that, so `src/` defines its own Effect service.

Module roles, and the dependency direction between them:

- `Question.ts` — question builders (`noul` / `choice` / `score`). Questions are plain data; they are
  serialized into the request body as-is. `choice` infers its option keys as a literal union, which
  is what makes `answers.x.choice` narrow. Also holds `validate`, the pre-flight check.
- `Answer.ts` — answer types, `Schema` decoders for the wire body, and `AnswersFor<Q>`, the type-level
  map from a question set to its answer set.
- `SystemOne.ts` — the service, its layers, `evaluate`, `decode`/`reconcile`, and `retryTransient`.
- `Errors.ts` — tagged failures, plus `isTransient`.
- `Testing.ts` — deterministic layers.

### Invariants worth preserving

- **Decode, then reconcile.** A response is decoded by `Schema` and then checked against the questions
  that were asked (`SystemOne.reconcile`): a missing answer, an answer whose type doesn't match its
  question, or a chosen option that was never offered each fail as `ResponseError`. Never coerce or
  cast past this — the whole point is that the static answer type can't become a lie.
- **Test layers go through that same path.** `Testing.layer` handlers return *raw JSON*, which runs
  through the production decoder and reconciliation. A fixture the live client would reject must fail
  the test too, so don't add a shortcut that hands back pre-built `Answer` values.
- **`noul` has no `confidence`.** Only `choice` and `score` carry it, and the types say so. `confidence`
  is a statistic over the whole distribution (how concentrated it is), not the winning probability.
- **Nothing retries implicitly.** `retryTransient` is opt-in and retries only transport errors, 429,
  and 5xx/529. 401 and 422 are terminal.
- **The full distribution survives.** `probabilities`, `legend`, and the decoded `raw` response are all
  kept; an aggregate alone is never the deliverable.

## Effect v4 conventions

`effect` is a **peer dependency pinned to a v4 release candidate** (`4.0.0-rc.115`) — its API differs
from Effect 3 and from most published examples. Follow the existing code rather than memory:
`Schema` and `Config` come from the `effect` barrel, HTTP from `effect/unstable/http`, services are
`Context.Service` classes, `Layer.unwrap` chooses a layer from an effect, and `Effect.catch` (not
`catchAll`) is the recovery combinator in use here.

TypeScript is strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and
`verbatimModuleSyntax` — hence `import type`, `.js` extensions on every relative import, and the
non-null assertions after `Object.keys` lookups. Conditionally omit optional properties (see
`Question.noul`) rather than passing `undefined`.

## Examples, fixtures, and live keys

Without an API key **nothing reaches TypeSafe**. `examples/classification.ts` exposes `isLive`
(a blank `TYPESAFE_API_KEY=` counts as *absent*, so an untouched `.env` stays on replay rather than
sending an empty bearer token), and `clientLayer` picks `SystemOne.layerFetch()` or a replay layer
from it. Recordings in `examples/recorded.ts` and `examples/guardrails/recorded.ts` are real
responses from `jev-1.13.0`, keyed by case id; a state with no recording fails as a genuine
`ResponseError` instead of inventing an answer. Both demos label themselves `REPLAY` on screen.
`.env` is gitignored and Bun loads it automatically.

Both demos share one `SystemOne` service (`examples/web/client.ts`) because two layers cannot provide
the same service — the replay layer asks each demo's `respond` in turn, relying on disjoint ids.

Two properties of the demo server (`examples/web/server.ts`) are load-bearing and easy to break:

- **The request measures; the policy decides.** Endpoints return distributions and confidence, never a
  label or an action. Thresholds and policies are applied in the browser, which is why dragging a
  slider re-decides every case with no request and no spend. Keep decision logic
  (`classification.decide`, `guardrails/route.ts`) pure and out of the server.
- **Batch endpoints are SSE streams built from the stream itself**, not a forked fiber, so a closed tab
  interrupts the in-flight requests. `narrate` emits `queued` → `requesting`/`answered` (with the live
  in-flight count) → `done`.

`makeHandler` is exported so `test/web.test.ts` can drive routes, streams, and the bundled browser
code without opening a port; it accepts a pinned client layer so the suite behaves identically with or
without a key on the machine.

## Framing

Neither demo measures anything: ten filings and twelve messages are illustrations, the thresholds are
examples, and a recording is one draw from a distribution rather than a measurement. Keep that
hedging intact in prose and UI copy — and don't present a passing guardrail battery as evidence a
message is safe, or cookbook benchmark numbers as guarantees.
