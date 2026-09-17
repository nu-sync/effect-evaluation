/**
 * End-to-end coverage that the per-area unit tests cannot give.
 *
 * Everything above this file stubs the *service* (`Testing.layer`) — request
 * building and status handling never run. This file stubs the *transport*
 * (`Testing.layerHttp`) instead, so a real request goes through
 * `SystemOne.make`: question validation, body encoding, the bearer token,
 * `HttpClientResponse.matchStatus`, `Answer.ResponseSchema` decoding, and
 * `SystemOne.reconcile`, all in one pass — see test/transport.test.ts for the
 * same pattern at smaller scope.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Redacted, Schedule } from "effect"
import { TestClock } from "effect/testing"
import { HttpClientRequest } from "effect/unstable/http"
import * as Answer from "../src/Answer.js"
import { isTransient } from "../src/Errors.js"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"
import { offlineLayer as classificationOfflineLayer, read as readFiling } from "../examples/classification.js"
import { filings } from "../examples/filings.js"
import { offlineLayer as guardrailsOfflineLayer, screen } from "../examples/guardrails/policy.js"
import { messages } from "../examples/guardrails/messages.js"
import { recorded as guardrailsRecorded, recordedModel as guardrailsModel } from "../examples/guardrails/recorded.js"

const apiKey = Redacted.make("test-key")

const requestBody = (request: HttpClientRequest.HttpClientRequest): unknown =>
  JSON.parse(new TextDecoder().decode((request.body as { body: Uint8Array }).body))

const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

describe("every module together, through the stubbed transport", () => {
  const questions = {
    urgency: Question.noul({ instructions: "Does this message express urgency?" }),
    department: Question.choice({
      instructions: "Which team should handle this?",
      criteria: {
        returns: "Exchanges, refunds, wrong or damaged items",
        shipping: "Delivery status, delays, lost packages",
        billing: "Charges, invoices, payment problems"
      }
    }),
    severity: Question.score({
      instructions: "How severe is the reported issue?",
      criteria: [
        "Cosmetic; no impact to functionality",
        // A structured rubric level, not just a sentence — docs/primitives.md's
        // "entry type" is what makes this legal.
        { what: "Broken or degraded feature, but workaround exists", examples: ["export fails in one browser"] },
        "Blocking issue; no workaround exists"
      ]
    })
  }

  const goodBody = JSON.stringify(
    Testing.response({
      model: "jev-1.13.0",
      answers: {
        urgency: { type: "noul", noul: 0.81 },
        department: {
          type: "choice",
          choice: "billing",
          confidence: 0.91,
          probabilities: { returns: 0.08, shipping: 0.01, billing: 0.91 }
        },
        severity: {
          type: "score",
          score: 1.3,
          confidence: 0.54,
          legend: {
            "0": "Cosmetic; no impact to functionality",
            "1": { what: "Broken or degraded feature, but workaround exists", examples: ["export fails in one browser"] },
            "2": "Blocking issue; no workaround exists"
          },
          probabilities: { "0": 0.0, "1": 0.7, "2": 0.3 }
        }
      },
      usage: { inputTokens: 360, outputTokens: 39 }
    })
  )

  test("request goes to the documented URL with a bearer token, and every answer reads correctly", async () => {
    let seen: { url: string; auth: string | undefined; body: unknown } | undefined

    const result = await Effect.runPromise(
      SystemOne.evaluate({ state: "I was charged twice. Please refund the extra charge.", questions }).pipe(
        Effect.provide(SystemOne.layer({ apiKey })),
        Effect.provide(Testing.layerHttp((request) => {
          seen = { url: request.url, auth: request.headers["authorization"], body: requestBody(request) }
          return { status: 200, body: goodBody }
        }))
      )
    )

    expect(seen?.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(seen?.auth).toBe("Bearer test-key")
    expect(seen?.body).toEqual({
      state: "I was charged twice. Please refund the extra charge.",
      model: "jev-latest",
      questions
    })

    // Every module together: decoded answers, read through Answer's helpers.
    expect(Answer.isNoul(result.answers.urgency)).toBe(true)
    expect(Answer.hasConfidence(result.answers.urgency)).toBe(false)

    expect(Answer.isChoice(result.answers.department)).toBe(true)
    expect(Answer.hasConfidence(result.answers.department)).toBe(true)
    const department: "returns" | "shipping" | "billing" = result.answers.department.choice
    expect(department).toBe("billing")
    expect(Answer.probabilityOf(result.answers.department, "shipping")).toBe(0.01)
    expect(Answer.topProbability(result.answers.department)).toBe(0.91)
    expect(Answer.ranked(result.answers.department)[0]).toEqual(["billing", 0.91])
    expect(Answer.top(result.answers.department, 2).map(([option]) => option)).toEqual(["billing", "returns"])

    expect(Answer.isScore(result.answers.severity)).toBe(true)
    expect(result.answers.severity.legend["1"]).toEqual({
      what: "Broken or degraded feature, but workaround exists",
      examples: ["export fails in one browser"]
    })
    expect(Answer.normalized(result.answers.severity)).toBeCloseTo(0.65, 5)
    // Mass split across the two extreme-ish levels near the mean, not
    // concentrated on it — spread is well above zero.
    expect(Answer.spread(result.answers.severity)).toBeGreaterThan(0)

    expect(result.usage).toEqual({ inputTokens: 360, outputTokens: 39, totalTokens: 399 })
    expect(result.model).toBe("jev-1.13.0")
  })

  test("a 200 carrying a partial choice distribution is a ResponseError, never a coerced answer", async () => {
    const partialBody = JSON.stringify(
      Testing.response({
        answers: {
          urgency: { type: "noul", noul: 0.81 },
          // "shipping" was offered but has no entry here.
          department: { type: "choice", choice: "billing", confidence: 0.91, probabilities: { returns: 0.08, billing: 0.92 } },
          severity: {
            type: "score",
            score: 1.3,
            confidence: 0.54,
            legend: { "0": "a", "1": "b", "2": "c" },
            probabilities: { "0": 0, "1": 0.7, "2": 0.3 }
          }
        }
      })
    )

    const error = await failure(
      SystemOne.evaluate({ state: "state", questions }).pipe(
        Effect.provide(SystemOne.layer({ apiKey })),
        Effect.provide(Testing.layerHttp(() => ({ status: 200, body: partialBody })))
      )
    )
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("shipping")
    expect(error.message).toContain("no entry for it")
  })
})

describe("retryTransient at transport level", () => {
  const questions = { refund: Question.noul({ instructions: "Is the customer asking for a refund?" }) }
  const okBody = JSON.stringify(Testing.response({ answers: { refund: { type: "noul", noul: 0.97 } } }))

  const evaluate = (handler: (request: HttpClientRequest.HttpClientRequest) => Testing.StubResponse) =>
    SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
      Effect.provide(SystemOne.layer({ apiKey })),
      Effect.provide(Testing.layerHttp(handler))
    )

  // No delay of its own, so a test using this schedule isolates whatever wait
  // retryTransient's own retry-after handling adds.
  const noDelay = { schedule: Schedule.recurs(3), times: 3 } as const

  test("piped and data-first forms retry the same number of times and produce the same answer", async () => {
    let pipedAttempts = 0
    const piped = await Effect.runPromise(
      evaluate(() => {
        pipedAttempts += 1
        return pipedAttempts < 3 ? { status: 529, body: "overloaded" } : { status: 200, body: okBody }
      }).pipe(SystemOne.retryTransient(noDelay))
    )

    let dataFirstAttempts = 0
    const dataFirst = await Effect.runPromise(
      SystemOne.retryTransient(
        evaluate(() => {
          dataFirstAttempts += 1
          return dataFirstAttempts < 3 ? { status: 529, body: "overloaded" } : { status: 200, body: okBody }
        }),
        noDelay
      )
    )

    expect(pipedAttempts).toBe(3)
    expect(dataFirstAttempts).toBe(3)
    expect(piped.answers.refund.noul).toBe(0.97)
    expect(dataFirst.answers.refund.noul).toBe(0.97)
  })

  test("honours retry-after before the schedule's own delay runs, using TestClock", async () => {
    let attempts = 0
    const program = evaluate(() => {
      attempts += 1
      return attempts === 1
        ? { status: 429, body: "slow down", headers: { "retry-after": "0.5" } }
        : { status: 200, body: okBody }
    }).pipe(SystemOne.retryTransient(noDelay))

    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(program)
        // Advancing less than the retry-after hint must not be enough.
        yield* TestClock.adjust("400 millis")
        expect(fiber.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust("100 millis")
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer()))
    )

    expect(attempts).toBe(2)
    expect(result.answers.refund.noul).toBe(0.97)
  })

  test("caps an absurd retry-after at maxRetryAfter", async () => {
    let attempts = 0
    const program = evaluate(() => {
      attempts += 1
      return attempts === 1
        ? { status: 429, body: "slow down", headers: { "retry-after": "86400" } }
        : { status: 200, body: okBody }
    }).pipe(SystemOne.retryTransient({ ...noDelay, maxRetryAfter: "1 second" }))

    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(program)
        // The 86400s hint is capped to 1 second, so the fiber must already be
        // done well before a day of test-clock time would otherwise pass.
        yield* TestClock.adjust("1 second")
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer()))
    )

    expect(attempts).toBe(2)
    expect(result.answers.refund.noul).toBe(0.97)
  })

  test("respectRetryAfter: false skips the wait entirely", async () => {
    let attempts = 0
    const program = evaluate(() => {
      attempts += 1
      return attempts === 1
        ? { status: 429, body: "slow down", headers: { "retry-after": "86400" } }
        : { status: 200, body: okBody }
    }).pipe(SystemOne.retryTransient({ ...noDelay, respectRetryAfter: false }))

    const result = await Effect.runPromise(
      Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(program)
        // No clock advance at all — with the wait disabled, the retry (and the
        // no-delay schedule around it) can complete on its own.
        yield* TestClock.adjust("0 millis")
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestClock.layer()))
    )

    expect(attempts).toBe(2)
    expect(result.answers.refund.noul).toBe(0.97)
  })

  test("401 and 422 are never retried, and stay terminal", async () => {
    for (const status of [401, 422] as const) {
      let attempts = 0
      const error = await failure(
        evaluate(() => {
          attempts += 1
          return { status, body: "no" }
        }).pipe(SystemOne.retryTransient(noDelay))
      )
      expect(attempts).toBe(1)
      expect(isTransient(error)).toBe(false)
      expect(error._tag).toBe(status === 401 ? "SystemOne/AuthError" : "SystemOne/RequestError")
    }
  })
})

describe("the examples still work offline, end to end", () => {
  test("classification replay produces a reading for a couple of filings", async () => {
    const novagrid = filings.find((f) => f.id === "NOVAGRID")!
    const harborlight = filings.find((f) => f.id === "HARBORLIGHT")!

    const readOffline = (filing: typeof novagrid) =>
      Effect.runPromise(
        readFiling({ id: filing.id, business: filing.text }).pipe(Effect.provide(classificationOfflineLayer))
      )

    const a = await readOffline(novagrid)
    const b = await readOffline(harborlight)

    expect(a.group).toBe("49")
    expect(a.confidence).toBeGreaterThan(0)
    // The full distribution survives replay, not just the winning group.
    expect(Object.values(a.probabilities).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1, 5)
    expect(b.group).toBe("65")
  })

  test("guardrails replay produces a reading for a couple of messages", async () => {
    const passwordReset = messages.find((m) => m.id === "password-reset")!
    const quietCrisis = messages.find((m) => m.id === "quiet-crisis")!
    const layer = guardrailsOfflineLayer(guardrailsRecorded, guardrailsModel)

    const screenOffline = (message: typeof passwordReset) =>
      Effect.runPromise(screen(message).pipe(Effect.provide(layer)))

    const a = await screenOffline(passwordReset)
    const b = await screenOffline(quietCrisis)

    expect(a.jailbreak).toBeLessThan(0.1)
    expect(a.harmful).toBeLessThan(0.1)
    expect(b.distress).toBeGreaterThan(0.5)
  })
})
