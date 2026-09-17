/**
 * Unit tests for `SystemOne.reconcile` / `SystemOne.decode` — the invariant the
 * whole package rests on. A response that would make the static answer type a
 * lie must fail as a `ResponseError` rather than being coerced into one.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Answer from "../src/Answer.js"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** Runs an effect that is expected to fail, and returns its typed failure. */
const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

const state = "irrelevant for these tests — only the response shape is under test"

const department = Question.choice({
  instructions: "Which team should handle this?",
  criteria: {
    returns: "Exchanges, refunds, wrong or damaged items",
    shipping: "Delivery status, delays, lost packages",
    billing: "Charges, invoices, payment problems"
  }
})

const severity = Question.score({
  instructions: "How severe is the reported issue?",
  criteria: [
    "Cosmetic; no impact to functionality",
    "Broken or degraded feature, but workaround exists",
    "Blocking issue; no workaround exists"
  ]
})

/** Decodes a raw body against one question set, exactly as the live client would. */
const decode = <const Q extends Question.Questions>(questions: Q, body: unknown) =>
  SystemOne.decode(questions, body)

describe("choice: probabilities must cover every offered option", () => {
  test("rejects a response whose probabilities omits an offered option", async () => {
    // Before this check, `answers.department.probabilities.shipping` was typed
    // `number` (Choice.probabilities is a total map over the literal union of
    // option keys) but would have been `undefined` at runtime for this body —
    // a typed read that silently lied. reconcile turns that into a decode-time
    // failure instead.
    const failed = await failure(
      decode({ department }, Testing.response({
        answers: {
          department: {
            type: "choice",
            choice: "billing",
            confidence: 0.91,
            // "shipping" was offered but has no entry here.
            probabilities: { returns: 0.08, billing: 0.92 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("department")
    expect(failed.message).toContain("shipping")
    expect(failed.message).toContain("no entry for it")
  })

  test("rejects a response whose probabilities carries an option that was never offered", async () => {
    const failed = await failure(
      decode({ department }, Testing.response({
        answers: {
          department: {
            type: "choice",
            choice: "billing",
            confidence: 0.7,
            probabilities: { returns: 0.08, shipping: 0.01, billing: 0.7, legal: 0.21 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("department")
    expect(failed.message).toContain("legal")
    expect(failed.message).toContain("not offered")
  })

  test("accepts a well-formed full distribution and produces a usable typed answer", async () => {
    const result = await run(
      decode({ department }, Testing.response({
        answers: {
          department: {
            type: "choice",
            choice: "billing",
            confidence: 0.91,
            probabilities: { returns: 0.08, shipping: 0.01, billing: 0.91 }
          }
        }
      }))
    )
    const choice: "returns" | "shipping" | "billing" = result.answers.department.choice
    expect(choice).toBe("billing")
    expect(result.answers.department.probabilities.shipping).toBe(0.01)
    expect(Answer.topProbability(result.answers.department)).toBe(0.91)
  })
})

describe("score: legend and probabilities must cover every offered level", () => {
  test("rejects a legend with fewer levels than the question offered", async () => {
    const failed = await failure(
      decode({ severity }, Testing.response({
        answers: {
          severity: {
            type: "score",
            score: 0.7,
            confidence: 0.5,
            // Only two of the three offered levels are present.
            legend: { "0": "Cosmetic; no impact to functionality", "1": "Broken or degraded feature, but workaround exists" },
            probabilities: { "0": 0.3, "1": 0.7 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("severity")
    expect(failed.message).toContain("3 level(s)")
    expect(failed.message).toContain("legend")

    // The stakes: on the truncated (2-level) legend, `normalized` divides by
    // the wrong span. A score of 0.7 that should read as 0.35 of the true
    // 3-level scale instead reads as 0.7 of a 2-level scale — silently wrong,
    // not a crash, which is exactly why reconcile has to reject it up front.
    const truncated: Answer.Score = {
      type: "score",
      score: 0.7,
      confidence: 0.5,
      legend: { "0": "Cosmetic; no impact to functionality", "1": "Broken or degraded feature, but workaround exists" },
      probabilities: { "0": 0.3, "1": 0.7 }
    }
    const correct: Answer.Score = { ...truncated, legend: { ...truncated.legend, "2": "Blocking issue; no workaround exists" } }
    expect(Answer.normalized(truncated)).toBeCloseTo(0.7, 5)
    expect(Answer.normalized(correct)).toBeCloseTo(0.35, 5)
    expect(Answer.normalized(truncated)).not.toBeCloseTo(Answer.normalized(correct), 5)
  })

  test("rejects legend keys that are not \"0\"..\"n-1\"", async () => {
    const failed = await failure(
      decode({ severity }, Testing.response({
        answers: {
          severity: {
            type: "score",
            score: 1,
            confidence: 0.5,
            // Shifted by one: "1", "2", "3" instead of "0", "1", "2".
            legend: {
              "1": "Cosmetic; no impact to functionality",
              "2": "Broken or degraded feature, but workaround exists",
              "3": "Blocking issue; no workaround exists"
            },
            probabilities: { "1": 0.2, "2": 0.5, "3": 0.3 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("severity")
    expect(failed.message).toContain("level 0")
  })

  test("rejects a probabilities map missing a level", async () => {
    const failed = await failure(
      decode({ severity }, Testing.response({
        answers: {
          severity: {
            type: "score",
            score: 1,
            confidence: 0.5,
            legend: {
              "0": "Cosmetic; no impact to functionality",
              "1": "Broken or degraded feature, but workaround exists",
              "2": "Blocking issue; no workaround exists"
            },
            // Legend has all three levels; probabilities is missing level 2.
            probabilities: { "0": 0.4, "1": 0.6 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("severity")
    expect(failed.message).toContain("probabilities")
    expect(failed.message).toContain("level 2")
  })

  test("accepts a well-formed score answer with structured (object) legend entries unchanged", async () => {
    // docs/primitives.md: the legend echoes the criteria entries back, so a
    // level supplied as an object must survive decoding as that object. A
    // client that assumed the legend was a map of strings would reject any
    // response to a structured score question.
    const structured = Question.score({
      instructions: "How severe is the reported issue?",
      criteria: [
        "Cosmetic; no impact to functionality",
        { what: "Broken or degraded feature, but workaround exists", examples: ["export fails in one browser"] },
        { what: "Blocking issue; no workaround exists", examples: ["service is down"] }
      ]
    })
    const result = await run(
      decode({ structured }, Testing.response({
        answers: {
          structured: {
            type: "score",
            score: 1.3,
            confidence: 0.54,
            legend: {
              "0": "Cosmetic; no impact to functionality",
              "1": { what: "Broken or degraded feature, but workaround exists", examples: ["export fails in one browser"] },
              "2": { what: "Blocking issue; no workaround exists", examples: ["service is down"] }
            },
            probabilities: { "0": 0.0, "1": 0.7, "2": 0.3 }
          }
        }
      }))
    )
    expect(result.answers.structured.legend["1"]).toEqual({
      what: "Broken or degraded feature, but workaround exists",
      examples: ["export fails in one browser"]
    })
    expect(result.answers.structured.legend["0"]).toBe("Cosmetic; no impact to functionality")
  })
})

describe("checks are per-question", () => {
  test("a set mixing a good noul with a bad choice fails, naming the choice", async () => {
    const urgency = Question.noul({ instructions: "Does this message express urgency?" })
    const failed = await failure(
      decode({ urgency, department }, Testing.response({
        answers: {
          urgency: { type: "noul", noul: 0.62 },
          department: {
            type: "choice",
            choice: "billing",
            confidence: 0.91,
            // "returns" is missing.
            probabilities: { shipping: 0.09, billing: 0.91 }
          }
        }
      }))
    )
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("department")
    expect(failed.message).not.toContain("urgency")
  })
})

describe("decode surfaces an undecodable body", () => {
  test("a body that does not match the documented shape fails as ResponseError with a cause", async () => {
    const failed = await failure(decode({ department }, { model: "jev-latest", answers: {} }))
    expect(failed._tag).toBe("SystemOne/ResponseError")
    expect(failed.message).toContain("did not match the documented shape")
    expect(failed.cause).toBeDefined()
  })
})
