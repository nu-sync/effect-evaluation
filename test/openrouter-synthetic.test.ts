/**
 * A synthetic (hand-built) OpenRouter Decisions response — NOT a golden
 * fixture. Nothing here was ever sent to or received from OpenRouter.
 *
 * `test/golden/` is reserved for verbatim bytes copied from a real response,
 * exactly as CLAUDE.md's "Invariants worth preserving" and SPEC.md's
 * "Testing" section describe — it is the only check this repository has on
 * the actual wire shape. Everything in this file, like every other
 * non-golden fixture in the suite (`Testing.response`, the recorded demo
 * responses), is built from this client's own assumptions about that shape,
 * so it can only prove the client agrees with itself. Real OpenRouter golden
 * bytes are recorded by `test/golden/record-openrouter.ts`, which is blocked
 * on an `OPENROUTER_API_KEY` this repository does not have yet.
 *
 * What this file is for: OpenRouter's response envelope shares the same
 * `model`/`answers`/`usage` shape TypeSafe's does (so `Answer.ResponseSchema`
 * / `SystemOne.decode` / `SystemOne.reconcile` do not fork per provider —
 * see CLAUDE.md's provider-neutral decode-then-reconcile invariant), but it
 * documents extra top-level provenance (`id`, `provider`) and cost
 * (`usage.cost`) fields this client does not model. This exercises a mixed
 * Noul/Choice/Score answer set decoding through that shared path, and pins
 * that the unmodelled fields survive on `Evaluation.body` while being
 * (correctly) absent from the schema-checked `Evaluation.raw`.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const questions = {
  department: Question.choice({
    instructions: "Which team should handle this?",
    criteria: { billing: "Charges and invoices", technical: "Bugs and outages" }
  }),
  refund: Question.noul({ instructions: "Is the customer asking for a refund?" }),
  severity: Question.score({
    instructions: "How severe is the reported issue?",
    criteria: ["Cosmetic; no impact", "Degraded; workaround exists", "Blocking; no workaround"]
  })
}

// Shaped like SPEC.md's "Providers, transport and configuration" section
// describes OpenRouter's response: the same provider-neutral envelope this
// package already decodes, plus a request `id`, a serving `provider`, and
// `usage.cost` — none of which `Answer.ResponseSchema` models.
const syntheticOpenRouterBody = {
  id: "gen-synthetic-0001",
  provider: "typesafe",
  model: "typesafe/jev-1.13",
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.83,
      probabilities: { billing: 0.83, technical: 0.17 }
    },
    refund: { type: "noul", noul: 0.71 },
    severity: {
      type: "score",
      score: 0.4,
      confidence: 0.6,
      legend: { "0": "Cosmetic; no impact", "1": "Degraded; workaround exists", "2": "Blocking; no workaround" },
      probabilities: { "0": 0.65, "1": 0.25, "2": 0.1 }
    }
  },
  usage: {
    input_tokens: 412,
    output_tokens: 51,
    cost: 0.000842
  }
} as const

describe("a synthetic OpenRouter response (see this file's header — not test/golden)", () => {
  test("a mixed Noul/Choice/Score answer set decodes and reconciles through the same path as TypeSafe's", async () => {
    const result = await run(
      SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
        Effect.provide(Testing.layerFixture(syntheticOpenRouterBody))
      )
    )

    expect(result.answers.department.choice).toBe("billing")
    expect(result.answers.department.probabilities.billing).toBe(0.83)
    expect(result.answers.refund.noul).toBe(0.71)
    expect("confidence" in result.answers.refund).toBe(false)
    expect(result.answers.severity.score).toBe(0.4)
    expect(result.answers.severity.legend["1"]).toBe("Degraded; workaround exists")
    expect(result.usage).toEqual({ inputTokens: 412, outputTokens: 51, totalTokens: 463 })
  })

  test("OpenRouter's provenance and cost fields survive on Evaluation.body", async () => {
    const result = await run(
      SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
        Effect.provide(Testing.layerFixture(syntheticOpenRouterBody))
      )
    )

    const body = result.body as typeof syntheticOpenRouterBody
    expect(body.id).toBe("gen-synthetic-0001")
    expect(body.provider).toBe("typesafe")
    expect(body.usage.cost).toBe(0.000842)
  })

  test("the same fields are absent from Evaluation.raw — Schema.Struct only keeps what it models", async () => {
    // This is the exact distinction SPEC.md's "The decoded response is not
    // the whole response" and CLAUDE.md's "The full distribution survives"
    // invariant describe: `raw` is the checked view, `body` is what actually
    // arrived. A future client that promoted `id`/`provider`/`cost` onto
    // `Evaluation` would need to update this test — that is the point of
    // pinning it here rather than leaving the claim undemonstrated.
    const result = await run(
      SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
        Effect.provide(Testing.layerFixture(syntheticOpenRouterBody))
      )
    )

    expect("id" in result.raw).toBe(false)
    expect("provider" in result.raw).toBe(false)
    expect("cost" in result.raw.usage).toBe(false)
  })
})
