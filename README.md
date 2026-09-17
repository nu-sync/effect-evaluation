# effect-systemone

An Effect-native client for [TypeSafe AI](https://docs.typesafe.ai) System One models (Jev): typed
questions in, probability distributions out, typed failures throughout.

```ts
import { Effect } from "effect"
import { Question, SystemOne } from "effect-systemone"

const program = SystemOne.evaluate({
  state: { message: "I was charged twice. Please refund the duplicate." },
  questions: {
    department: Question.choice({
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Charges, invoices, payment problems",
        returns: "Exchanges, refunds, wrong or damaged items",
        shipping: "Delivery status, delays, lost packages"
      }
    }),
    refund: Question.noul({ instructions: "Is the customer requesting money back?" })
  }
}).pipe(Effect.provide(SystemOne.layerFetch()))

const result = await Effect.runPromise(program)

result.answers.department.choice        // "billing" | "returns" | "shipping"
result.answers.department.confidence    // 0.91
result.answers.department.probabilities // { billing: 0.91, returns: 0.08, shipping: 0.01 }
result.answers.refund.noul              // 0.97  — no confidence field; the number is the distribution
result.usage                            // { inputTokens, outputTokens, totalTokens }
```

## Why a separate service

Jev is not a language model. It takes a state and a map of typed questions and returns a probability
distribution per question, with no text. `LanguageModel` and `EmbeddingModel` in `effect/unstable/ai`
cannot represent that, and routing it through structured output would throw away `probabilities` and
`confidence` — the reason to use a System One model at all. So this package defines its own service
rather than bending an existing one. It is a normal Effect service: a `Layer` supplies it, a test
`Layer` replaces it.

## Install

```sh
bun add effect-systemone effect
```

`effect` is a peer dependency (v4 rc or later). Node 20+ or Bun.

## Questions

| Builder | Asks | Answer |
| --- | --- | --- |
| `Question.noul` | probability a statement is true | `noul: number` — **no confidence field** |
| `Question.choice` | one of N named options | `choice`, `probabilities`, `confidence` |
| `Question.score` | 2–10 ordered levels | `score` (weighted mean), `legend`, `probabilities`, `confidence` |

Option keys are inferred, so `answers.department.choice` is a literal union rather than `string`.

`confidence` is a statistic over the whole distribution — how concentrated it is — not the winning
option's probability. Only `choice` and `score` return it.

### Reading a distribution

`confidence` and "the winning option's probability" diverge in practice — a runner-up dominated by
one close second and a spread of many near-ties can carry the same `confidence` but very different
stakes — which is why `Answer` exports pure readings alongside the type guards (`isNoul`, `isChoice`,
`isScore`, `hasConfidence`) instead of leaving every caller to recompute them:

```ts
Answer.topProbability(result.answers.department) // probabilities[choice] — not confidence
Answer.ranked(result.answers.department)         // every option, most likely first
Answer.top(result.answers.department, 3)         // the 3 most likely, for a shortlist or beam
Answer.probabilityOf(result.answers.department, "shipping")
Answer.spread(result.answers.severity)           // dispersion around a Score's weighted mean
```

None of these decide anything — they read the distribution a request already returned.

## Layers

```ts
SystemOne.layerFetch()                  // reads config, uses platform fetch
SystemOne.layerConfig({ model })        // reads config, bring your own HttpClient
SystemOne.layer({ apiKey, baseUrl })    // explicit options
```

`layerConfig` reads `TYPESAFE_API_KEY` and falls back to `TYPESAFE_AI_API_KEY` — the official
JavaScript SDK uses the first name, the AI SDK provider uses the second.

## Failures

Every failure is a tagged error: `AuthError` (401), `RequestError` (422 or failed pre-flight
validation), `RateLimitError` (429, carries `retryAfterSeconds`), `OverloadedError` (529/5xx),
`TransportError`, `EncodeError`, and `ResponseError` for anything undecodable.

A response that would make the static answer type a lie — a missing answer, an answer of the wrong
type, a chosen option that was never offered — fails as `ResponseError` rather than being coerced.

Nothing retries on its own. `isTransient` classifies errors, and `SystemOne.retryTransient` applies
exponential backoff with jitter to exactly those. It is dual, so it reads the same piped or
data-first:

```ts
program.pipe(SystemOne.retryTransient({ times: 3 }))
SystemOne.retryTransient(program, { times: 3 })
```

A 429 carrying a `retry-after` header is honoured before the schedule's own backoff runs — the wait
is interruptible and capped by `maxRetryAfter` (default 60s) so a hostile or absurd header cannot
park a fiber indefinitely. Pass `respectRetryAfter: false` to ignore the header and rely on the
schedule alone.

Silent retries hide both latency and spend, so all of this is opt-in.

## Testing

```ts
import { Testing } from "effect-systemone"

const layer = Testing.layerFixture(
  Testing.response({ answers: { refund: { type: "noul", noul: 0.97 } } })
)
```

Fixtures go through the same decoder and the same reconciliation the live client uses, so a fixture
the real client would reject fails your test too. `Testing.layerHttp` stubs the transport instead,
for exercising 401/429/529 handling end to end. No test needs an API key.

### Golden fixtures

A suite built entirely from fixtures it writes itself can only prove the client agrees with its own
assumptions. If the API really returned `usage: { prompt_tokens }`, or nested answers under `data`,
every hand-built fixture here would still pass.

So `test/golden/` holds verbatim response bodies — the exact bytes two live requests returned,
committed alongside their status and headers — and `test/golden.test.ts` decodes them with the
production schema and pins the field names this client depends on: `usage.input_tokens` /
`output_tokens`, answers keyed by question name, and a structured Score `legend` coming back as the
objects it was sent as rather than as strings. That legend round trip is the one
`docs/primitives.md` singles out as the thing a careless client gets wrong.

The golden tests assert shapes and key sets, never particular probabilities, so re-recording them is
not a test regression — a recording is one draw from a distribution.

## Getting it running

```sh
just              # list recipes
just web          # serve + open the classification demo
just guardrails   # serve + open the guardrails demo
just cli-find     # semantic find, from the terminal
just cli-hierarchy # greedy vs beam search, from the terminal
just key          # is a live key configured?
just check        # typecheck, test, build
```

Without an API key **nothing reaches TypeSafe**. The demos still run, replaying responses actually
recorded from `jev-1.13.0` — not invented — and each labels itself `REPLAY` accordingly. A
recording is one draw from a distribution, not a measurement. To go live, paste your key into `.env`
(already present, gitignored; `.env.example` is the template):

```sh
TYPESAFE_API_KEY=sk-...
```

Bun loads it automatically. A blank value counts as no key, so an untouched `.env` stays on replay
rather than going live with an empty bearer token.

## Demos

Four, each replicating a TypeSafe cookbook. The first two run from the terminal or the browser and
share one Effect HTTP server (`HttpRouter.toWebHandler` handed to `Bun.serve`, no platform package);
the last two are terminal-only.

### Classification using confidence

[Cookbook](https://docs.typesafe.ai/cookbooks/classification_using_confidence) · `just web` ·
`just cli`

One Choice question offers every SIC major group at once. Above the confidence threshold, report the
narrow group; below it, report the parent division — a local lookup, no second call.

### Guardrails for LLMs

[Cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails) · `just guardrails` ·
`just cli-guardrails`

One request carries the whole battery: four hazard nouls (jailbreak, harmful, medical, crisis) plus
a severity Score. A policy turns those probabilities into pass / review / block / support, with
severity able to escalate a review into a block. Three preset policies and six live thresholds sit
under the page.

### Semantic find

[Cookbook](https://docs.typesafe.ai/cookbooks/semantic_find) · `just cli-find`

Ranks the lines of this repo's own `SPEC.md` against a query with a Choice over line ids, and asks a
companion Noul in the same request whether the document answers the query **at all**.

This is the demo that shows why the distribution is the product. Choice probabilities sum to 1, so
something always wins: asked about per-token pricing — which `SPEC.md` never discusses — a line still
takes 86% of the mass. The companion Noul reads 0.02, and it is the only thing in the response that
can say "nothing here".

It is also where the 255-option cap earns its keep. `SPEC.md` splits into 282 candidate lines, so
offering them as one Choice is rejected by `Question.validate` before any request is made, and the
demo implements the documented workaround: a coarse Choice over sections, then line ranking within
only the sections that survive.

### Hierarchical classification

[Cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) · `just cli-hierarchy`

Walks the same SIC taxonomy as the classification demo, but division → group instead of one flat
60-option Choice, and runs three strategies over identical inputs: flat, greedy, and beam search with
`K=3`, scored by the cookbook's length-normalized geometric mean. Keeping the whole distribution is
what makes beam search expressible at all — `Answer.top` is the entire mechanism.

On these ten filings, flat matched the human label 9 times and both hierarchical strategies 6, and
greedy and beam never diverged, so there is no recovery case to show. Ten filings is an illustration
and none of that is evidence about which strategy is better. What it does show is worth more: in all
four cases where the top pick missed, the expected label was still on the shortlist — outranked, not
absent, which is the thing a wider `K` or a human reviewer could act on.

### What the browser demos are actually showing

- **The request measures; the policy decides.** The server returns distributions and confidence, and
  never a label or an action. Every threshold is applied in the browser, so moving one re-decides
  every case with no request and no spend — watch "API calls" hold still while the routing counters
  move.
- **The work is visible while it happens.** `GET /api/stream` and `/api/guardrails/stream` are
  server-sent event streams: `queued`, then `requesting` / `answered` per case with the live
  in-flight count, then `done` with totals. The page renders that as an activity feed and a row of
  in-flight dots, so bounded concurrency is observable rather than merely configured. The events
  come from the stream itself rather than a forked fiber, so closing the tab interrupts the
  outstanding requests.
- **Typed failures arrive as data.** Sending text with no recording while offline produces a real
  `SystemOne/ResponseError`, tag intact, rendered as an error card.

No demo here measures anything. Ten filings, twelve messages, five queries and one taxonomy are
illustrations; the thresholds are examples; a guardrail battery that passes does not establish that a
message is safe. Each demo's recordings regenerate separately, because together they are some sixty
live requests:

```sh
just record   # lists each recorder and what it costs; spends nothing itself
```

## Scripts

```sh
bun test          # 124 tests, no network
bun run typecheck
bun run build     # transpile + declarations
bun run check     # all three
```
