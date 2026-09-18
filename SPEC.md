# Effect Evaluation

## Status

Two layers, at two different stages.

**Layer 1 — `@nu-sync/effect-evaluation`, the System One client: built and working for both TypeSafe's
direct API and OpenRouter's Decisions endpoint.** Source in `src/`, tests in `test/`, four cookbook
replications in `examples/`. 183 tests pass with no network access; typecheck, build, and package
inspection pass. Its API is not yet stable, but it is real code rather than a proposal, and the rest
of this document is written against what it revealed. OpenRouter's transport, provider selection, and
error mapping are implemented and tested; the one part of Phase 0.1 not yet met is acceptance
criterion 12 below — real OpenRouter golden fixtures, which require a live `OPENROUTER_API_KEY` and
spend real credits, so `test/golden/` still holds only TypeSafe bytes.

**Layer 2 — the evaluation framework: still a plan.** Datasets, targets, scorers, reports. Nothing
in that section is implemented, and no signature there should be trusted until it is.

The previous draft of this document described both layers speculatively and got several external
facts wrong. Those corrections are recorded below rather than quietly deleted, because two of them
changed the design.

## What the research changed

**The AI SDK does not define the dataset/target/scorer vocabulary.** The earlier draft claimed to
adopt "AI SDK-style evaluation datasets, targets, scorers, and aggregate results." The AI SDK has
none of those. What it has is `experimental_evaluate`: a map of named `choice` / `score` / `boolean`
questions asked against one shared state — which is the same shape this spec had assigned to "the
TypeSafe adapter." The dataset/target/scorer vocabulary comes from Braintrust, Evalite, and
vitest-evals. Both citations pointed at the wrong thing.

**Effect has no evaluation service to plug into.** `effect/unstable/ai` ships `LanguageModel`,
`EmbeddingModel`, `Model`, `Tool`, `Toolkit`, `Telemetry` — and nothing for evaluation, scoring, or
datasets. Jev returns probability distributions and no text, so it does not fit `LanguageModel`.
That settled the first question: there is no existing abstraction to adapt, so layer 1 defines its
own service. It is still an ordinary Effect service, which is all "provider-agnostic" ever meant.

**An aggregate score with no error bar is not a result.** The earlier draft's non-goal — "no
automatic statistical claims" — was right in spirit but left the compare-revisions use case
unsupported. A mean with no `n` and no standard error cannot answer whether a revision helped.

**A judge with no calibration is not evidence.** The earlier draft had an acceptance criterion
saying documentation must not imply confidence proves success, and no mechanism by which anyone
could tell. Imperfect judge sensitivity and specificity bias the score itself, not just its
variance.

**`Input -> Output` cannot represent an agent**, which the earlier draft named as its primary use
case. A trajectory — tool calls, steps, intermediate messages — has to be in the case result from
the beginning or the core contract gets re-cut later.

## Layer 1 — `@nu-sync/effect-evaluation`

### What it is

An Effect service for TypeSafe AI System One models, reached either through TypeSafe's direct API or
OpenRouter's Decisions API. One request carries a `state` and a map of named questions; the response
carries one typed answer per question plus token usage. Provider selection belongs to the Layer, not
to the question and answer model, so the program using `SystemOne.evaluate` is identical for both.

```ts
const result = yield* SystemOne.evaluate({
  state: { message: ticket },
  questions: {
    department: Question.choice({
      instructions: "Which team should handle this?",
      criteria: { billing: "Charges and invoices", technical: "Bugs and outages" }
    }),
    refund: Question.noul({ instructions: "Is the customer requesting money back?" })
  }
})

result.answers.department.choice        // "billing" | "technical"
result.answers.department.probabilities // full distribution
result.answers.department.confidence    // concentration of that distribution
result.answers.refund.noul              // probability; no confidence field exists
```

### Modules

```
@nu-sync/effect-evaluation            barrel
@nu-sync/effect-evaluation/Question   question builders and types
@nu-sync/effect-evaluation/Answer     answer types, wire schemas
@nu-sync/effect-evaluation/SystemOne  service, layers, evaluate, retryTransient
@nu-sync/effect-evaluation/Errors     tagged failures
@nu-sync/effect-evaluation/Testing    deterministic layers
```

### Decisions made while building it

**Direct HTTP, not a wrapper.** Each provider exposes one relevant endpoint over bearer-authenticated
HTTP. Wrapping `@typesafe-ai/sdk` or `@openrouter/sdk` would make their transport and retry policies
part of this package's behaviour, which collides with the rule that nothing retries silently.
Wrapping `experimental_evaluate` would import an API that may change in patch releases. The client
will therefore keep its Effect HTTP transport and put the endpoint, credentials, defaults, request
validation and status mapping behind a small provider adapter. The provider adapters converge on the
existing `Question`, `Answer`, decode and reconcile path; they do not duplicate it.

### Providers, transport and configuration

The two providers serve the same model family and share the core Decisions request and response
shape, but they are different APIs. A base-URL substitution is insufficient because their endpoint
paths, model identifiers, configuration keys and documented failures differ.

| Provider | Endpoint | Default model | API key configuration |
| --- | --- | --- | --- |
| TypeSafe | `POST https://api.typesafe.ai/v1/systemone` | `jev-latest` | `TYPESAFE_API_KEY`, then `TYPESAFE_AI_API_KEY` |
| OpenRouter | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` |

Provider selection is deterministic:

1. A caller may explicitly select `typesafe` or `openrouter` in Layer configuration. An explicit
   choice reads only that provider's credentials and fails configuration if they are absent; it does
   not silently switch providers.
2. With no provider selected, configuration tries TypeSafe first: a non-blank
   `TYPESAFE_API_KEY`, then a non-blank `TYPESAFE_AI_API_KEY`.
3. If neither TypeSafe key is available, configuration tries a non-blank `OPENROUTER_API_KEY`.
4. If none is available, Layer construction fails with a configuration error that names all accepted
   variables.

This is startup configuration, not runtime failover. A rejected key, rate limit or provider outage
must be returned as a typed failure; the client must never replay a paid request against the other
provider automatically. If both providers are configured and no explicit choice is made, TypeSafe
wins by the ordering above. The explicit `layer({ apiKey, ... })` form cannot infer which service
issued an opaque key, so omitting its provider remains a backwards-compatible TypeSafe selection;
callers using an OpenRouter key must name `openrouter`.

Both transports send the provider-neutral `{ state, model, questions }` body and use bearer auth.
OpenRouter's response adds fields such as request `id`, serving `provider`, and `usage.cost`; these
remain available in `Evaluation.body` even when the common decoded view does not yet expose them.
The implementation may later promote common provenance fields into `Evaluation`, but must not discard
the verbatim body while doing so.

The published schemas have small input differences that the provider adapter must reconcile without
narrowing the shared public question types:

- TypeSafe accepts the package's existing JSON state model. OpenRouter documents top-level `state`
  as a string, object or array, excluding a top-level number, boolean or `null`.
- The shared client permits either side of Noul `criteria` to be omitted. OpenRouter documents both
  `true` and `false` as required when the `criteria` object is present.
- The existing client deliberately enforces the stricter useful bounds of at least two Choice
  options and 2–10 Score levels. Those checks remain common even where OpenRouter's generated schema
  is looser.

Provider-specific pre-flight checks should reject an incompatible request before transport, with a
`RequestError` that explains the difference. They must not mutate, fill in or reinterpret the user's
state or criteria to make one provider accept it.

### Provider error mapping

The public failure taxonomy remains provider-neutral, but every documented provider status must be
mapped deliberately and retain its actual HTTP status and response body. “Terminal” means the same
request should not be retried automatically; it does not imply that a user cannot fix credentials,
credits or configuration and try again.

| Status | Provider meaning | Client treatment |
| --- | --- | --- |
| `400` | OpenRouter malformed or invalid request | terminal `RequestError` |
| `401` | either provider rejected or did not receive authentication | terminal `AuthError` |
| `402` | OpenRouter has insufficient credits or quota | terminal `RequestError`, preserving the status and body |
| `403` | OpenRouter authenticated the key but denied the operation | terminal `RequestError`, preserving the status and body |
| `404` | OpenRouter resource, route or requested model was not found | terminal `RequestError`, preserving the status and body |
| `413` | OpenRouter request payload is too large | terminal `RequestError`, preserving the status and body |
| `422` | TypeSafe rejected a well-formed request | terminal `RequestError` |
| `429` | either provider rate limited the request | transient `RateLimitError`, retaining `Retry-After` when present |
| `500`, `502`, `503`, `524`, `529`, and other `5xx` | provider, upstream or edge failure/overload | transient `OverloadedError` with the actual status and body |
| any other status | undocumented response | terminal `ResponseError`; do not guess |

Local pre-flight failures remain `RequestError`s with no invented HTTP response. `RequestError` must
therefore stop hard-coding `422` as if every rejection came from TypeSafe. Transport failures remain
`TransportError`, JSON encoding failures remain `EncodeError`, and a successful HTTP response that
cannot be decoded or reconciled remains `ResponseError`.

**Typed answers are checked, not asserted.** The wire response decodes through `Schema`, and is then
reconciled against the questions that were asked. A missing answer, an answer whose type does not
match its question, or a chosen option that was never offered each fail as `ResponseError`. Any of
them would make the static type a lie, and a cast would hide exactly the case worth seeing.

**The distribution must be total, not just the winner.** Reconcile also rejects a choice answer
whose `probabilities` omits an offered option or names one that was never offered, and a score
answer whose `legend`/`probabilities` skip a level. Without this, `Choice.probabilities` is typed as
a total map over the literal option union — `noUncheckedIndexedAccess` cannot see through that
mapped type — so a partial response would make a typed `number` read `undefined` at runtime instead
of failing where the mistake actually is. The same gap on a `Score` legend is worse than a crash: a
legend missing one level lets `Answer.normalized` divide by the wrong span and return a plausible,
silently wrong number.

**A rate limit's own hint is honoured, capped, and interruptible.** `retryTransient` sleeps for a
429's `retry-after` seconds (if present and positive) before its wrapped schedule's backoff runs on
top, rather than instead of it — the server's estimate and this client's jitter are different
signals. The sleep is capped by `maxRetryAfter` (default 60s, opt-out via `respectRetryAfter: false`)
so a hostile or absurd header cannot park a fiber indefinitely, and it is built on `Effect.delay`,
so interrupting the fiber does not wait out the cap first.

**The decoded response is not the whole response.** `Evaluation.raw` is the schema-decoded view, and
`Schema.Struct` drops what it does not model — so a field the API adds tomorrow would be gone before a
caller saw it. For a package whose premise is that an aggregate is never enough evidence, that is the
wrong default, and it is a one-way door for layer 2's content-addressed execute artifacts. So
`Evaluation` also carries `body: unknown`, the verbatim JSON as it arrived. `raw` is the checked view;
`body` is what actually came back, including anything this client does not model yet.

**Pre-flight validation.** An empty question set, a choice with fewer than two options, or a score
outside 2–10 levels fails locally, before the request. A test asserts the network is never touched.
The service stays the authority; this only catches what the docs already declare invalid.

**`noul` has no confidence, and the types say so.** Choice and score answers carry `confidence`;
noul answers carry only the probability. Modelling that asymmetry honestly is the difference between
a client and a wrapper, and it constrains layer 2's score algebra (below).

**Retries are opt-in.** `isTransient` classifies errors; `retryTransient` applies exponential
backoff with jitter to transport errors, 429, and all 5xx responses, and to nothing else. Every
documented 4xx response other than 429 is terminal by construction. Evaluation is a pure read, so
retrying the selected provider is safe — but a client that silently retries hides both latency and
spend, so it does not. A retry never switches providers.

**Configuration follows provider selection.** TypeSafe continues to accept both established env var
names. OpenRouter uses `OPENROUTER_API_KEY`. The automatic TypeSafe-first ordering applies only when
the provider is omitted; an explicit provider never falls through to another provider's key.

**Tracing from the start, not phase 4.** Every request is wrapped in a `SystemOne.evaluate` span
carrying the model and question count.

### Testing

Test layers return raw JSON and run it through the production decoder and reconciliation, so a
fixture the real client would reject fails the test too. `Testing.layerHttp` stubs the transport
instead, which is how 401 / 429-with-`retry-after` / 529 / undocumented-status handling is tested end
to end. The suite covers typed answer inference, usage normalization, all four rejection paths,
pre-flight validation, request shape (URL, bearer token, body), status mapping, and that
`retryTransient` retries a 429 three times and an `AuthError` zero times. No test needs a key.

**Golden fixtures are what keep the rest of the suite honest.** Every other fixture in this repo is
built by `Testing.response`, which constructs the envelope from this client's own assumptions about
the wire shape — so a suite of them can only prove the client agrees with itself. `test/golden/`
currently holds verbatim TypeSafe response bodies from real requests, with their status and headers, and
`test/golden.test.ts` pins the field names the client depends on against those bytes:
`usage.input_tokens` / `output_tokens`, answers keyed by question name, a noul answer genuinely
carrying no `confidence`, and a structured Score `legend` round-tripping as objects rather than
strings. Recording them found no discrepancy — the wire shape is what `src/` assumed — which is a
result worth having rather than a formality, because until then nothing in the suite had seen a real
response body. The golden tests assert shapes and key sets only, never particular probabilities, so
re-recording is not a regression.

OpenRouter support is not complete until equivalent golden evidence exists for that transport: at
least one mixed Noul/Choice/Score response, a structured Score legend, and the OpenRouter-only
top-level provenance and cost fields. Transport tests must independently pin each provider's URL,
default model, credential source, explicit selection, automatic selection order, missing-key failure,
and every status mapping listed above. No automated test may require a live or paid API call.

### The examples

Both replicate TypeSafe's classification-by-confidence cookbook: one Choice question offering every
SIC major group, reporting the narrow group when confidence clears 0.9 and the parent division — a
local lookup, no second call — when it does not. Both run on fixtures by default and against the
live API when `TYPESAFE_API_KEY` is set, with no change to the program; only the layer differs. The
shared policy lives in `examples/classification/classification.ts`, so the CLI and the server cannot
drift.

`examples/classification/cli.ts` prints both policies over the same answers, and states plainly that
seven synthetic cases measure nothing.

`examples/web/` serves the same thing with a slider and a live view. An Effect router becomes a
`fetch` handler via `HttpRouter.toWebHandler` and is handed to `Bun.serve`; `GET /api/stream` is a
server-sent event stream built from `Stream` rather than a forked fiber, so the run narrates itself
— `queued`, then `requesting` / `answered` per case with the in-flight count, then `done` — and a
disconnected browser interrupts the outstanding work. The page renders that as an activity feed and
a row of in-flight dots, which makes bounded concurrency observable instead of merely configured.

The server deliberately returns readings and never labels — applying the threshold is the browser's
job — so dragging the slider re-derives every label with no request and no spend, and the two
accuracy tallies visibly trade against each other. A typed failure reaches the page with its `_tag`
intact.

Offline answers are replayed from responses recorded from the live model by
`examples/classification/record.ts`, which refuses to run without a key. The earlier draft of this
example shipped hand-written confidences, and the live run showed them to be wrong by 0.2–0.5 — a
small, concrete instance of the calibration argument below: assumptions about a model's confidence
are not evidence about it.

This is also the first thing the spec had no answer for: what a developer *looks at*. The threshold
slider is the small version of the argument in layer 2 that a report needs a local developer loop,
not just a number.

Two later examples exist because the first two did not exercise the thing this package is for. Both
reduce every answer to one scalar and threshold it — `confidence` in one, four nouls and a score in
the other — so neither ever reads `probabilities`, and the claim that the full distribution is the
product went undemonstrated. `examples/semantic-find/` ranks the lines of this document with a Choice
and asks a companion Noul whether the document answers the query at all: asked about pricing, which
this document never discusses, a line still takes 86% of the mass because Choice probabilities sum to
1, and the Noul's 0.02 is the only reading that can say "nothing here". It also has to implement the
documented windowing workaround, because 282 candidate lines exceed the API's 255-option cap.
`examples/hierarchy/` walks the SIC taxonomy division-first with greedy and beam search, where
`Answer.top` is the whole mechanism — keeping the distribution is what makes a beam expressible.
Neither example measures anything: on ten filings the flat strategy matched the human label more
often than either hierarchical one, and greedy and beam never diverged, both of which the demo
reports plainly rather than hiding.

### Known rough edges

- `bun build` in bundle mode drops `export * as ns from` re-exports, emitting an export list for
  bindings it never defines. The build is therefore transpile-only (`--no-bundle`), which is the
  better choice for a peer-dependency library anyway. Relative imports carry `.js` specifiers so
  Node's ESM resolver works.
- `@nu-sync/effect-evaluation` is unregistered on npm and free to claim; the tarball, the six subpath exports,
  and `node16`/`nodenext` type resolution were checked against real build output.
- No streaming and no batching, because neither Decisions API offers them for this use case.
- OpenRouter's Decisions endpoint is explicitly alpha, so its adapter and golden fixtures are the
  compatibility boundary if that route or envelope changes.
- Neither API documents temperature, seed, or an idempotency key for Decisions. Repeated trials are
  repeated requests, and this client cannot make them reproducible.

## Layer 2 — the evaluation framework

Nothing below is built. It is the design layer 1 is meant to support.

### Conceptual model

```text
Dataset<Input, Expected, Metadata>
        |
        v
Target<Input, Output>  ---->  CaseResult (output + trajectory + usage + timing)
        |                            |
        +--------> Scorer -----------+
                                     |
                                     v
                              EvaluationReport
```

### Datasets

An in-memory collection or an effectful `Stream` of cases, each with a stable id, an input, an
optional expected value, and metadata. Beyond the previous draft:

- **The dataset is fingerprinted.** A report records the hash of the case ids and inputs it ran
  against. Two runs over different datasets must not be comparable by accident.
- **Sampling and filtering are first class** — first N, by tag, stratified. Everyone needs this on
  day one and rediscovers it as a wrapper otherwise.
- **Labeled subsets are a distinct concept**, because judge calibration needs them.

### Targets

An input to an output, as an Effect — a function, a workflow, an agent, a provider call.

**`CaseResult` carries a trajectory.** Steps, tool calls, intermediate messages, per-step timing.
The single input-to-output arrow cannot describe an agent, and trajectory scorers (tool-selection
accuracy, step count, loop detection) are much of why agent evals exist. This is in phase 1 because
retrofitting it later re-cuts the core contract.

### Scorers

Case evidence to a typed score, as an Effect. Deterministic, semantic, or model-judged.

**Score algebra: a typed union carrying distributions, not numbers.** This is settled, and layer 1
settled it. A System One answer is a distribution plus a concentration statistic; `noul` has no
confidence and `choice` does; the confidence-gated policy in the example is unrepresentable in a
numeric-only algebra. Analyzing probabilities directly also removes sampling variance rather than
averaging it down. Numeric-only would be a one-way door.

**Reference-free and reference-based scorers are distinguishable at the type level.** A scorer that
needs `expected` should not typecheck against a dataset that lacks it. This is the kind of thing
Effect's types are for.

### Judges

A judge is a scorer backed by a model, and it is the part most likely to be wrong while looking
right.

- **A judge has an identity** — model, version, prompt hash — recorded in the report. A judge change
  invalidates comparisons exactly as a target change does.
- **A judge can be calibrated against a labeled subset**, and the report shows agreement: accuracy,
  and Cohen's κ against the labels.
- **Known biases have controls**: position swapping for pairwise judgments, and a flag when the
  judge model equals the target model.
- **Judge error is a reportable quantity.** Imperfect sensitivity and specificity bias the score
  itself; a calibration set is what makes correcting for that possible at all.

Layer 1's own consistency behaviour is the reason multi-provider judging matters here, and the
argument for adding the AI SDK-backed adapter: the same question set through Jev and a language
model, compared.

### Reports and statistics

- **Every summary carries `n` and a standard error.** A bare mean is never emitted.
- **Comparisons are paired by case id**, and refuse to run when the dataset or judge fingerprints
  differ. Paired analysis is the difference between detecting a regression and not: published work
  puts it at roughly 6% standard error unpaired versus 1–2% paired with averaging.
- **`replicates` feeds variance estimation.** The previous draft had the knob and nothing consuming
  it.
- **Power is reportable**: given observed variance, the minimum detectable effect at this dataset
  size.
- The non-goal stands, restated precisely: no statistical claim is invented, and no unqualified
  number is emitted either.

### Execution

- Default failure mode is `record`; `failFast` is available for CI.
- Concurrency is bounded and observable; cancellation interrupts and closes resources.
- Retries are opt-in and only for demonstrably idempotent calls — as in layer 1.
- **Spend and volume ceilings.** `maxSpend` and `maxCases` interrupt the run. Bounded concurrency is
  not a budget: 5,000 cases times 3 replicates at 4-way concurrency is still an unbounded bill and a
  guaranteed 429 storm. A rate limiter belongs at the same boundary.
- A scorer failure is distinct from a target failure, and the taxonomy is finer than that:
  transport, rate limit, refusal or content filter, schema decode failure, judge abstention. A
  refusal, a crash, and a low-confidence answer are three different outcomes.
- Repeated trials are explicit, never implicit.
- A successful target execution is not a passing score.

### Artifacts and reuse

Execute once, score many times. For that to be trustworthy the execute artifact is content-addressed
over dataset fingerprint, case id, target version, model id, and sampling parameters. Rescoring a
stale artifact against a changed dataset must fail loudly rather than produce a plausible number.

First sink: JSONL. Diff-friendly, streamable, works as a CI artifact. SQLite when comparison queries
justify it.

### Observability

Spans per case and per scorer, following OpenTelemetry's GenAI semantic conventions for model-call
attributes. `gen_ai.evaluation.result` is the emerging carrier for evaluator scores, though the
evaluation half of that convention is still moving in the GenAI SIG — so the report shape should map
onto it cleanly without depending on it yet.

### The developer loop

The previous draft never said how a user *runs* an eval, which is the most-touched surface there is.
Decide before phase 1 ships. Bun 1.4's test runner offers isolated parallel execution, `{ repeats: n }`,
and CI sharding, which argues for a `bun test` integration as at least one supported entry point.
"No hosted dashboard" remains a non-goal; "no local reporting" would be an adoption problem.

## Design principles

**Effect is the execution model.** Targets, scorers, provider calls, and sinks are Effects.
Requirements come through Layers, configuration through Effect config, failures stay typed.

**Evaluation is evidence first.** An aggregate is never sufficient. Every report retains input,
output, trajectory, expected value, scorer outputs, timing, usage, provider and model identity,
judge identity, and typed errors. Layer 1 already keeps the decoded response on every result for
this reason.

**Execute and score are separable**, which is what makes scorer iteration, offline review, and cost
control possible.

**Questions are data.** Provider-neutral question and answer types, with adapters behind them.

**Nothing hides.** No silent retries, no global clients, no `any` escape hatches, no unqualified
means.

## Non-goals

- A hosted dashboard or experiment database.
- A prompt-management product.
- A provider-specific agent framework.
- Inventing statistical claims (as distinct from reporting uncertainty, which is required).

## Phases

**Phase 0 — direct TypeSafe System One client. Done.** Typed questions and answers, tagged failures,
layers, opt-in retries, deterministic test layers, CLI and web cookbook examples, Bun build and
tests.

**Phase 0.1 — dual-provider System One transport. Implemented, except golden evidence.** Explicit and
automatic provider selection, the OpenRouter Decisions transport, provider-specific defaults and
validation, and complete status mapping are built and tested, preserving one shared typed service.
Separate golden response evidence for OpenRouter is not: `test/golden/record-openrouter.ts` is
written and ready but has never been run, since it requires a live `OPENROUTER_API_KEY` and spends
real credits — that is the repo owner's call, not something built silently into a release.

**Phase 1 — core evaluation contract.** Dataset with fingerprinting and sampling; target with
trajectory-carrying `CaseResult`; scorer with the distributional score algebra; report with `n` and
standard error; bounded execution with spend and volume ceilings; spans; a decided developer entry
point.

**Phase 2 — judges.** Model-judged scorers over layer 1 and over Effect's `LanguageModel`; judge
identity; calibration against labeled subsets with agreement reporting; position-swap controls; the
AI SDK adapter for cross-provider comparison.

**Phase 3 — persistence and comparison.** JSONL sink, content-addressed execute artifacts,
rescoring, paired comparison reports, CI thresholds.

**Phase 4 — optional integrations.** More providers, exporters, hosted backends — without changing
the core contracts.

## Acceptance criteria

Phase 0 is met: (1) a typed question set produces a typed answer map through a Layer-provided
client; (2) responses that would falsify the answer type are rejected; (3) failures are tagged and
transient failures are distinguishable from terminal ones; (4) tests cover decoding, validation,
transport status handling, and retry policy with no API key; (5) the cookbook example runs offline
and live from the same program; (6) `bun test`, typecheck, build, and package inspection pass.

Phase 0.1 is met when: (7) the same `SystemOne.evaluate` program can run through either TypeSafe or
OpenRouter by changing only its Layer; (8) explicit provider selection never falls back, while an
omitted provider selects a configured TypeSafe key before OpenRouter and fails clearly when neither
exists; (9) request validation accounts for the documented differences without mutating input;
(10) all documented statuses in the provider error table map to the promised typed, transient or
terminal failure; (11) retries remain opt-in and never switch providers; and (12) committed golden
responses independently prove the response shape of both providers without network access.
(7)-(11) are met. (12) is not: `test/golden/` still holds only TypeSafe bytes, and the OpenRouter
recorder awaits a live key.

Phase 1 is met when, additionally:

13. A dataset, an Effect target, and a deterministic scorer produce a report in a short example.
14. A report retains raw case evidence including trajectory, and typed failures.
15. Execution can be rescored without rerunning the target, and refuses to rescore across a changed
   dataset fingerprint.
16. Concurrency, interruption, failure mode, and spend ceilings are tested deterministically.
17. Every emitted summary carries `n` and a standard error, and two runs produce a paired comparison.
18. A judge scorer can be calibrated against a labeled subset, and the report shows its agreement.
19. Documentation nowhere implies that model confidence proves task success.

## Open decisions

Closed by building layer 1: score algebra (typed union with distributions); ESM-only; `effect` as a
peer dependency; Effect v4 rc with TypeScript 5.9+; JSONL as the first sink; tracing in phase 1.

**Reopened and decided the other way: one package, not two.** This document previously recorded
"TypeSafe in core (no — its own package, with the AI SDK adapter as a sibling)", and layer 1 was
built and published under that assumption. It now ships as `@nu-sync/effect-evaluation`, so layer 2 grows
inside the same package rather than beside it. The honest cost of that is worth stating: someone
installing `@nu-sync/effect-evaluation` today gets a TypeSafe System One client and no evaluation framework,
and the name will only describe its contents once phase 1 lands. The benefit is one name, one
version, and no cross-package contract to keep in step while the core types are still moving.

Still open:

- The developer entry point: `bun test` integration, a CLI, a library call, or more than one.
- Whether judge calibration ships in phase 2 or phase 1 — it is cheap to build and expensive to
  retrofit into a report format.
- Whether trajectories get a bespoke type or reuse Effect's span tree.

## References

Checked against primary sources, September 2026.

- Effect v4 is at release candidate; `effect@4.0.0-rc.115` is what layer 1 is built and tested
  against. Unified versioning, `Context.Tag` → `Context.Service`, rewritten Schema, TypeScript 5.9+.
  [v4 beta](https://effect.website/blog/releases/effect/40-beta),
  [migration](https://github.com/Effect-TS/effect-smol/blob/main/MIGRATION.md)
- `effect/unstable/ai` contains `LanguageModel`, `EmbeddingModel`, `Model`, `Tool`, `Toolkit`,
  `Telemetry`; no evaluation service. Verified by inspecting the installed package.
  [Effect AI docs](https://effect.website/docs/ai/getting-started/)
- System One HTTP API: `POST https://api.typesafe.ai/v1/systemone`, bearer auth, `noul` / `choice` /
  `score`, errors 401 / 422 / 429 / 529 with exponential backoff advised for the last two.
  [API reference](https://docs.typesafe.ai/api),
  [noul](https://docs.typesafe.ai/primitives/noul),
  [choice](https://docs.typesafe.ai/primitives/choice),
  [score](https://docs.typesafe.ai/primitives/score),
  [confidence](https://docs.typesafe.ai/confidence)
- OpenRouter exposes Jev through the alpha Decisions endpoint at
  `POST https://openrouter.ai/api/alpha/decisions`, using the model id `typesafe/jev-1.13` and an
  OpenRouter bearer key. Its response shares the Decisions answer and token-usage envelope while
  adding provider/request provenance and optional cost. Documented failures are 400 / 401 / 402 /
  403 / 404 / 413 / 429 / 500 / 502 / 503 / 524 / 529, plus a default error response for other
  4xx/5xx statuses.
  [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request),
  [Jev 1.13](https://openrouter.ai/typesafe/jev-1.13/)
- Official SDKs exist for JavaScript and Python; the AI SDK provider is `@ai-sdk/typesafe-ai`, used
  through `experimental_evaluate`, which is explicitly experimental.
  [JS SDK](https://docs.typesafe.ai/sdk/javascript),
  [AI SDK provider](https://ai-sdk.dev/providers/ai-sdk-providers/typesafe-ai),
  [AI SDK evaluation](https://ai-sdk.dev/docs/ai-sdk-core/evaluation)
- Statistical reporting: [Adding Error Bars to Evals](https://arxiv.org/abs/2411.00640),
  [How to Correctly Report LLM-as-a-Judge Evaluations](https://arxiv.org/abs/2511.21140)
- Prior art for the dataset/target/scorer vocabulary: [Braintrust](https://www.braintrust.dev/docs/evaluation),
  [Evalite](https://www.evalite.dev/), [vitest-evals](https://github.com/getsentry/vitest-evals)
- Tooling: [Bun 1.4](https://bun.com/blog/bun-v1.4),
  [OTel GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
