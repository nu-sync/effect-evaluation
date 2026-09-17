import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Schedule } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { isTransient, type SystemOneError } from "../src/Errors.js"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const apiKey = Redacted.make("test-key")

const questions = {
  refund: Question.noul({ instructions: "Is the customer asking for a refund?" })
}

const okBody = JSON.stringify(
  Testing.response({ answers: { refund: { type: "noul", noul: 0.97 } } })
)

const evaluate = (
  handler: (request: HttpClientRequest.HttpClientRequest) => Testing.StubResponse,
  options?: { readonly model?: string; readonly baseUrl?: string }
) =>
  SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
    Effect.provide(SystemOne.layer({ apiKey, model: options?.model, baseUrl: options?.baseUrl })),
    Effect.provide(Testing.layerHttp(handler))
  )

const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

describe("the request that goes out", () => {
  test("posts the documented body to the documented endpoint with a bearer token", async () => {
    let seen: { url: string; auth: string | undefined; body: unknown } | undefined

    await Effect.runPromise(
      evaluate((request) => {
        seen = {
          url: request.url,
          auth: request.headers["authorization"],
          body: JSON.parse(new TextDecoder().decode((request.body as { body: Uint8Array }).body))
        }
        return { status: 200, body: okBody }
      })
    )

    expect(seen?.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(seen?.auth).toBe("Bearer test-key")
    expect(seen?.body).toEqual({
      state: "I was charged twice.",
      model: "jev-latest",
      questions: {
        refund: { type: "noul", instructions: "Is the customer asking for a refund?" }
      }
    })
  })

  test("honours a configured base URL and model", async () => {
    let seen: { url: string; model: unknown } | undefined

    await Effect.runPromise(
      evaluate(
        (request) => {
          seen = {
            url: request.url,
            model: JSON.parse(new TextDecoder().decode((request.body as { body: Uint8Array }).body)).model
          }
          return { status: 200, body: okBody }
        },
        { baseUrl: "https://proxy.internal/v1/", model: "jev-1.13" }
      )
    )

    expect(seen?.url).toBe("https://proxy.internal/v1/systemone")
    expect(seen?.model).toBe("jev-1.13")
  })
})

describe("status handling", () => {
  test("401 becomes an AuthError", async () => {
    const error = await failure(evaluate(() => ({ status: 401, body: "bad key" })))
    expect(error._tag).toBe("SystemOne/AuthError")
    expect(isTransient(error)).toBe(false)
  })

  test("422 becomes a terminal RequestError", async () => {
    const error = await failure(evaluate(() => ({ status: 422, body: "invalid question" })))
    expect(error._tag).toBe("SystemOne/RequestError")
    expect(isTransient(error)).toBe(false)
  })

  test("429 becomes a transient RateLimitError carrying retry-after", async () => {
    const error = await failure(
      evaluate(() => ({ status: 429, body: "slow down", headers: { "retry-after": "12" } }))
    )
    expect(error._tag).toBe("SystemOne/RateLimitError")
    expect(isTransient(error)).toBe(true)
    if (error._tag === "SystemOne/RateLimitError") {
      expect(error.retryAfterSeconds).toBe(12)
    }
  })

  test("529 becomes a transient OverloadedError", async () => {
    const error = await failure(evaluate(() => ({ status: 529, body: "overloaded" })))
    expect(error._tag).toBe("SystemOne/OverloadedError")
    expect(isTransient(error)).toBe(true)
    if (error._tag === "SystemOne/OverloadedError") {
      expect(error.status).toBe(529)
    }
  })

  test("500 is treated as transient too", async () => {
    const error = await failure(evaluate(() => ({ status: 500, body: "boom" })))
    expect(error._tag).toBe("SystemOne/OverloadedError")
  })

  test("an undocumented status is a ResponseError, not a guess", async () => {
    const error = await failure(evaluate(() => ({ status: 302, body: "" })))
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("unexpected status 302")
  })
})

describe("retries are opt-in", () => {
  const immediately = { schedule: Schedule.recurs(5), times: 5 } as const

  test("nothing is retried by default", async () => {
    let attempts = 0
    await failure(
      evaluate(() => {
        attempts += 1
        return { status: 529, body: "overloaded" }
      })
    )
    expect(attempts).toBe(1)
  })

  test("retryTransient retries a 429 and then succeeds", async () => {
    let attempts = 0
    const result = await Effect.runPromise(
      SystemOne.retryTransient(
        evaluate(() => {
          attempts += 1
          return attempts < 3 ? { status: 429, body: "slow down" } : { status: 200, body: okBody }
        }),
        immediately
      )
    )
    expect(attempts).toBe(3)
    expect(result.answers.refund.noul).toBe(0.97)
  })

  test("retryTransient does not retry a rejected key", async () => {
    let attempts = 0
    const error: SystemOneError = await failure(
      SystemOne.retryTransient(
        evaluate(() => {
          attempts += 1
          return { status: 401, body: "bad key" }
        }),
        immediately
      )
    )
    expect(attempts).toBe(1)
    expect(error._tag).toBe("SystemOne/AuthError")
  })
})
