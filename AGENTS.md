# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is **Bun** (not Node for dev); recipes are in the `justfile`.

```sh
just                 # list recipes
just check           # typecheck + test + build  (run before calling work done)
just test            # bun test — no network, no API key (184 tests)
just test-watch
just typecheck       # tsc --noEmit over src, test, and examples
just build           # bun build (transpile only) + tsc -p tsconfig.build.json for .d.ts
just key             # report whether a live API key is configured, and where

just web             # serve + open the classification demo (port 3000)
just guardrails      # serve + open the guardrails demo
just serve           # serve without opening a browser
just cli             # classification demo in the terminal
just cli-guardrails  # guardrails demo in the terminal
just cli-find        # semantic-find demo in the terminal
just cli-hierarchy   # hierarchy demo (flat vs greedy vs beam) in the terminal
just record          # lists the six recorders and what each costs — spends nothing itself
just record-find     # one recorder; each is separate because together they are ~60 live requests
```

One test file: `bun test test/client.test.ts`. One test by name: `bun test -t "retries a 429"`.

## Layout

```
src/        the published package, @nu-sync/effect-evaluation (no deps beyond peer `effect`)
test/       bun:test suites; test/web.test.ts drives the demo server via happy-dom
test/golden/  verbatim live response bodies — the only check on the wire shape src/ assumes
examples/   four cookbook replications + the Effect HTTP server that hosts the first two
docs/       local summaries of TypeSafe's primitives and cookbooks; docs.md is the index
SPEC.md     layer 1 (this client) as built; layer 2 (an evaluation framework) as a plan only
```

Read `docs/primitives.md` (via the `typesafe-docs` skill) before touching request construction or
response decoding — it holds the exact wire shapes this client decodes against. `SPEC.md`'s layer 1
section records *why* the client is shaped the way it is; layer 2 is unimplemented, not a contract.

## What the library is

`Jev` is not a language model: one request carries a `state` plus a map of named questions, and the
response is one probability distribution per question with no text. `LanguageModel` in
`effect/unstable/ai` cannot represent that, so `src/` defines its own Effect service, backed by
whichever of two providers a `Layer` was built from.

Module roles:

- `Question.ts` — builders (`noul` / `choice` / `score`) and `validate`, the pre-flight check.
- `Answer.ts` — answer types, `Schema` decoders, and `AnswersFor<Q>`.
- `Provider.ts` — everything provider-specific (see below). Only `SystemOne.ts` imports it.
- `SystemOne.ts` — the service, its layers, `evaluate`, `decode`/`reconcile`, `retryTransient`.
- `Errors.ts` — tagged failures, plus `isTransient`.
- `Testing.ts` — deterministic layers.

## Providers: TypeSafe and OpenRouter

`SystemOne` can run against TypeSafe's own endpoint or OpenRouter's Decisions endpoint — same
question/answer shape, different base URL, default model, and env vars. `Provider.ts` is the single
place that knows both exist; `SystemOne.ts` stays one code path that only differs in which `Layer` it
was built from.

- **Selection happens once, at `Layer.unwrap` time — not per request.** A caller may pass an explicit
  `provider`, in which case only that provider's env vars are read and it never falls back to the
  other's key. With no explicit provider, resolution tries `TYPESAFE_API_KEY`, then
  `TYPESAFE_AI_API_KEY`, then `OPENROUTER_API_KEY`, in that order, first non-blank wins.
- **This is not runtime failover.** A rejected key, 429, or provider outage mid-run does not switch
  providers — `retryTransient` retries the same provider it started with. There is no request-level
  routing between the two; think "which one Layer to build," not "which provider answers this call."
  If you're asked to add failover or per-request routing, that's new behavior, not a bug fix.
- **OpenRouter gets extra pre-flight checks** (`Provider.preflight`): top-level `state` can't be a
  bare number/boolean/null, and a `noul`'s `criteria`, if present, must include both `"true"` and
  `"false"`. TypeSafe has no such restriction. Neither provider adapter mutates the caller's request
  to make it fit — an incompatible request is rejected, never silently normalized.
- **Error mapping is shared but wider than TypeSafe alone**: OpenRouter's 400/402/403/404/413 all map
  to terminal `RequestError` (status and body preserved); 401 stays `AuthError`; 429 and 5xx stay
  transient. Full table in `SPEC.md` under "Provider error mapping."

## Invariants worth preserving

- **Decode, then reconcile.** `SystemOne.reconcile` checks a decoded response against the questions
  actually asked — missing answer, wrong type, or an option never offered all fail as `ResponseError`.
  Never coerce past this; it's what keeps the static answer type from becoming a lie. `Testing.layer`
  fixtures go through the same decode+reconcile path, so a fixture the live client would reject must
  fail the test too.
- **`noul` has no `confidence`.** Only `choice` and `score` carry it — a statistic over the whole
  distribution, not the winning option's probability.
- **Nothing retries implicitly**, across either provider. `retryTransient` is opt-in and retries only
  transport errors, 429, and 5xx/529; 401 and 422/OpenRouter's 4xx family are terminal.
- **The full distribution survives.** `probabilities`, `legend`, decoded `raw`, and verbatim `body`
  are all kept — an aggregate alone is never the deliverable. `Answer`'s readings (`ranked`, `top`,
  `probabilityOf`, `topProbability`, `spread`) read the distribution; they never decide anything.
- **Golden fixtures are the only check on the wire shape.** `test/golden/` holds real response bytes
  per provider; every other fixture is built by `Testing.response` from this client's own
  assumptions, so it can only prove the client agrees with itself. TypeSafe golden bytes are
  committed; OpenRouter's recorder (`test/golden/record-openrouter.ts`) exists but has never been run
  — don't treat OpenRouter's wire shape as pinned by a real response yet.

## Effect v4 conventions

`effect` is a **peer dependency pinned to a v4 release candidate** (`4.0.0-rc.115`) — its API differs
from Effect 3 and from most published examples. Follow the existing code: `Schema`/`Config` from the
`effect` barrel, HTTP from `effect/unstable/http`, services as `Context.Service` classes,
`Layer.unwrap` to choose a layer from an effect, `Effect.catch` (not `catchAll`) for recovery.

TypeScript is strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`)
— hence `import type`, `.js` extensions on relative imports, and conditionally omitting optional
properties (see `Question.noul`) rather than passing `undefined`.

## Examples, fixtures, and live keys

Without a key for the resolved provider, **nothing reaches a live API**. Each demo's `recorded.ts`
holds real responses keyed by case id and replays them when `isLive` is false (a blank API-key env
var counts as absent); a state with no recording fails as a real `ResponseError` rather than inventing
an answer, and every demo labels itself `REPLAY` on screen. `.env` is gitignored and Bun loads it
automatically.

Two properties of the demo server (`examples/web/server.ts`) are load-bearing:

- **The request measures; the policy decides.** Endpoints return distributions and confidence, never
  a label or action — thresholds are applied in the browser, so dragging a slider re-decides every
  case with no request and no spend. Keep decision logic out of the server.
- **Batch endpoints are SSE streams built from the stream itself**, not a forked fiber, so a closed
  tab interrupts in-flight requests.

## Framing

No demo measures anything: filings and messages are illustrations, thresholds are examples, and a
recording is one draw from a distribution, not a measurement. Keep that hedging intact in prose and
UI copy — don't present a passing guardrail battery as evidence a message is safe, or a provider
comparison as a benchmark.
