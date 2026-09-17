import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import * as Answer from "../src/Answer.js"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

/** Runs an effect that is expected to fail, and returns its typed failure. */
const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

const apiKey = Redacted.make("test-key")

const ticket = "I was charged twice for the same order. Please refund the duplicate."

const questions = {
  department: Question.choice({
    instructions: "Which team should handle this?",
    criteria: {
      returns: "Exchanges, refunds, wrong or damaged items",
      shipping: "Delivery status, delays, lost packages",
      billing: "Charges, invoices, payment problems"
    }
  }),
  urgency: Question.noul({ instructions: "Does this message express urgency?" }),
  severity: Question.score({
    instructions: "How severe is the reported issue?",
    criteria: [
      "Cosmetic; no impact to functionality",
      "Broken or degraded feature, but workaround exists",
      "Blocking issue; no workaround exists"
    ]
  })
}

const goodBody = Testing.response({
  answers: {
    department: {
      type: "choice",
      choice: "billing",
      confidence: 0.91,
      probabilities: { returns: 0.08, shipping: 0.01, billing: 0.91 }
    },
    urgency: { type: "noul", noul: 0.62 },
    severity: {
      type: "score",
      score: 1.3,
      confidence: 0.54,
      legend: {
        "0": "Cosmetic; no impact to functionality",
        "1": "Broken or degraded feature, but workaround exists",
        "2": "Blocking issue; no workaround exists"
      },
      probabilities: { "0": 0.0, "1": 0.7, "2": 0.3 }
    }
  },
  usage: { inputTokens: 360, outputTokens: 39 }
})

describe("typed answers", () => {
  test("returns one typed answer per question", async () => {
    const result = await run(
      SystemOne.evaluate({ state: ticket, questions }).pipe(
        Effect.provide(Testing.layerFixture(goodBody))
      )
    )

    // Compile-time: `choice` is the union of the option keys, not `string`.
    const department: "returns" | "shipping" | "billing" = result.answers.department.choice
    expect(department).toBe("billing")

    expect(result.answers.department.probabilities.billing).toBe(0.91)
    expect(result.answers.department.confidence).toBe(0.91)
    expect(result.answers.urgency.noul).toBe(0.62)
    expect(result.answers.severity.score).toBe(1.3)
    expect(result.answers.severity.legend["1"]).toBe("Broken or degraded feature, but workaround exists")
  })

  test("a noul answer carries no confidence field", async () => {
    const result = await run(
      SystemOne.evaluate({ state: ticket, questions }).pipe(
        Effect.provide(Testing.layerFixture(goodBody))
      )
    )
    expect("confidence" in result.answers.urgency).toBe(false)
  })

  test("normalizes usage and keeps the raw response as evidence", async () => {
    const result = await run(
      SystemOne.evaluate({ state: ticket, questions }).pipe(
        Effect.provide(Testing.layerFixture(goodBody))
      )
    )
    expect(result.usage).toEqual({ inputTokens: 360, outputTokens: 39, totalTokens: 399 })
    expect(result.raw.usage.input_tokens).toBe(360)
    expect(result.model).toBe("jev-latest")
  })
})

describe("responses that would make the typed answer a lie", () => {
  const evaluate = (body: unknown) =>
    failure(
      SystemOne.evaluate({ state: ticket, questions: { department: questions.department } }).pipe(
        Effect.provide(Testing.layerFixture(body))
      )
    )

  test("rejects a missing answer", async () => {
    const failure = await evaluate(Testing.response({ answers: {} }))
    expect(failure._tag).toBe("SystemOne/ResponseError")
    expect(failure.message).toContain("no answer for question")
  })

  test("rejects an answer of the wrong type", async () => {
    const failure = await evaluate(
      Testing.response({ answers: { department: { type: "noul", noul: 0.4 } } })
    )
    expect(failure._tag).toBe("SystemOne/ResponseError")
    expect(failure.message).toContain("is a choice but the answer is a noul")
  })

  test("rejects an option that was never offered", async () => {
    const failure = await evaluate(
      Testing.response({
          answers: {
          department: {
            type: "choice",
            choice: "legal",
            confidence: 0.99,
            probabilities: { legal: 0.99 }
          }
        }
      })
    )
    expect(failure._tag).toBe("SystemOne/ResponseError")
    expect(failure.message).toContain("was not offered")
  })

  test("rejects a body that does not match the documented shape", async () => {
    const failure = await evaluate({ model: "jev-latest", answers: {} })
    expect(failure._tag).toBe("SystemOne/ResponseError")
    expect(failure.message).toContain("did not match the documented shape")
  })
})

describe("pre-flight validation", () => {
  const countingLayer = () => {
    let calls = 0
    const layer = Testing.layerHttp(() => {
      calls += 1
      return { status: 200, body: JSON.stringify(goodBody) }
    })
    return { layer, calls: () => calls }
  }

  test("an empty question set never reaches the network", async () => {
    const http = countingLayer()
    const failed = await failure(
      SystemOne.evaluate({ state: ticket, questions: {} }).pipe(
        Effect.provide(SystemOne.layer({ apiKey })),
        Effect.provide(http.layer)
      )
    )
    expect(failed._tag).toBe("SystemOne/RequestError")
    expect(http.calls()).toBe(0)
  })

  test("a score question with too few levels never reaches the network", async () => {
    const http = countingLayer()
    const failed = await failure(
      SystemOne.evaluate({
        state: ticket,
        questions: { severity: { type: "score", instructions: "How bad?", criteria: ["only one"] } }
      }).pipe(
        Effect.provide(SystemOne.layer({ apiKey })),
        Effect.provide(http.layer)
      )
    )
    expect(failed._tag).toBe("SystemOne/RequestError")
    expect(failed.message).toContain("1 level(s)")
    expect(http.calls()).toBe(0)
  })
})

describe("structured entries", () => {
  // Instructions and every criterion are "entry types": a string, an object, an
  // array, or null. That is what lets a rubric be data instead of prose.
  const structured = {
    severity: Question.score({
      instructions: {
        field: { name: "severity", unit: "ordinal" },
        question: "How severe is the reported issue?"
      },
      criteria: [
        "Cosmetic; no impact to functionality",
        {
          what: "Broken or degraded feature, but workaround exists",
          examples: ["export fails in one browser but works in another"]
        },
        { what: "Blocking issue; no workaround exists", examples: ["service is down"] }
      ]
    }),
    escalated: Question.noul({
      instructions: "Has this been escalated before?",
      criteria: {
        true: { what: "Mentions a prior ticket or that they have asked before", examples: ["as I said last week"] },
        false: "No sign of any previous contact"
      }
    }),
    team: Question.choice({
      instructions: "Which team should handle this?",
      criteria: {
        billing: { what: "Money", not_for: ["outages"], examples: ["double charge"] },
        technical: ["Bugs", "Outages"],
        other: null
      }
    })
  }

  test("a legend echoes structured levels back unchanged", async () => {
    const result = await run(
      SystemOne.evaluate({ state: ticket, questions: structured }).pipe(
        Effect.provide(Testing.layerFixture(
          Testing.response({
            answers: {
              severity: {
                type: "score",
                score: 1.3,
                confidence: 0.54,
                legend: {
                  "0": "Cosmetic; no impact to functionality",
                  "1": {
                    what: "Broken or degraded feature, but workaround exists",
                    examples: ["export fails in one browser but works in another"]
                  },
                  "2": { what: "Blocking issue; no workaround exists", examples: ["service is down"] }
                },
                probabilities: { "0": 0, "1": 0.7, "2": 0.3 }
              },
              escalated: { type: "noul", noul: 0.12 },
              team: {
                type: "choice",
                choice: "technical",
                confidence: 0.88,
                probabilities: { billing: 0.1, technical: 0.88, other: 0.02 }
              }
            }
          })
        ))
      )
    )

    // A legend of objects must survive decoding; typing it as Record<string,
    // string> would have rejected this response outright.
    expect(result.answers.severity.legend["1"]).toEqual({
      what: "Broken or degraded feature, but workaround exists",
      examples: ["export fails in one browser but works in another"]
    })
    expect(result.answers.severity.legend["0"]).toBe("Cosmetic; no impact to functionality")
    expect(result.answers.team.choice).toBe("technical")
  })

  test("structured criteria survive into the request body", async () => {
    let sent: any
    await run(
      SystemOne.evaluate({ state: ticket, questions: structured }).pipe(
        Effect.provide(SystemOne.layer({ apiKey })),
        Effect.provide(Testing.layerHttp((request) => {
          sent = JSON.parse(new TextDecoder().decode((request.body as { body: Uint8Array }).body))
          return {
            status: 200,
            body: JSON.stringify(Testing.response({
              answers: {
                severity: {
                  type: "score",
                  score: 1,
                  confidence: 0.9,
                  legend: { "0": "a", "1": "b", "2": "c" },
                  probabilities: { "0": 0, "1": 1, "2": 0 }
                },
                escalated: { type: "noul", noul: 0.5 },
                team: {
                  type: "choice",
                  choice: "other",
                  confidence: 0.4,
                  probabilities: { billing: 0.3, technical: 0.3, other: 0.4 }
                }
              }
            }))
          }
        }))
      )
    )

    expect(sent.questions.severity.instructions.field.name).toBe("severity")
    expect(sent.questions.severity.criteria[1].examples).toHaveLength(1)
    expect(sent.questions.escalated.criteria.true.what).toContain("prior ticket")
    expect(sent.questions.escalated.criteria.false).toBe("No sign of any previous contact")
    expect(sent.questions.team.criteria.billing.not_for).toEqual(["outages"])
    expect(sent.questions.team.criteria.technical).toEqual(["Bugs", "Outages"])
    expect(sent.questions.team.criteria.other).toBe(null)
  })
})

describe("reading a score", () => {
  const answer: Answer.Score = {
    type: "score",
    score: 0.73,
    confidence: 0.27,
    legend: { "0": "None", "1": "Limited", "2": { what: "Serious" }, "3": "Severe" },
    probabilities: { "0": 0.5, "1": 0.3, "2": 0.15, "3": 0.05 }
  }

  test("recovers the scale the score was measured on", () => {
    expect(Answer.levelCount(answer)).toBe(4)
    // 0.73 of three is a quarter of the way up, not 73% of anything.
    expect(Answer.normalized(answer)).toBeCloseTo(0.243, 3)
  })

  test("names the nearest level, entry and all", () => {
    expect(Answer.nearestLevel(answer)).toEqual({ index: 1, entry: "Limited" })
    expect(Answer.nearestLevel({ ...answer, score: 2.4 })).toEqual({ index: 2, entry: { what: "Serious" } })
  })

  test("a two-level score still normalizes", () => {
    const binary: Answer.Score = { ...answer, score: 0.5, legend: { "0": "no", "1": "yes" } }
    expect(Answer.normalized(binary)).toBe(0.5)
  })
})
