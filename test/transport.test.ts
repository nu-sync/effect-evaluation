import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Redacted, Schedule } from "effect"
import { HttpClientRequest } from "effect/unstable/http"
import { isTransient, type SystemOneError } from "../src/Errors.js"
import * as Provider from "../src/Provider.js"
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

/**
 * Runs an effect against an explicit, fake environment record rather than the
 * real process environment — this repository's `.env` carries a live
 * `TYPESAFE_API_KEY` (for the examples), so any test exercising
 * `SystemOne.layerConfig`'s credential resolution must pin its own
 * environment or it could pass by accident against a real key.
 * `preserveEmptyStrings: true` keeps `Provider.configuredKey`'s own
 * blank-is-absent handling under test, rather than letting the config
 * provider itself already treat `""` as unset.
 */
const withEnv = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  env: Record<string, string>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env, preserveEmptyStrings: true }))
  )

/**
 * The full path from environment variables to an actual request:
 * `SystemOne.layerConfig` resolves credentials and a provider, and that
 * resolved provider/apiKey pair is what builds the URL and bearer token the
 * stub below observes — proving credential resolution actually reaches the
 * wire, not just that `Provider.resolveCredentials` returns the right shape
 * in isolation (see test/provider.test.ts for that unit-level coverage).
 */
const evaluateFromConfig = (
  env: Record<string, string>,
  handler: (request: HttpClientRequest.HttpClientRequest) => Testing.StubResponse,
  options?: { readonly provider?: Provider.Provider }
) =>
  withEnv(
    SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
      Effect.provide(SystemOne.layerConfig({ provider: options?.provider })),
      Effect.provide(Testing.layerHttp(handler))
    ),
    env
  )

const evaluate = (
  handler: (request: HttpClientRequest.HttpClientRequest) => Testing.StubResponse,
  options?: { readonly model?: string; readonly baseUrl?: string; readonly provider?: Provider.Provider }
) =>
  SystemOne.evaluate({ state: "I was charged twice.", questions }).pipe(
    Effect.provide(
      SystemOne.layer({ apiKey, provider: options?.provider, model: options?.model, baseUrl: options?.baseUrl })
    ),
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

describe("the OpenRouter transport", () => {
  test("posts to the documented OpenRouter endpoint with its default model", async () => {
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
        { provider: "openrouter" }
      )
    )

    expect(seen?.url).toBe("https://openrouter.ai/api/alpha/decisions")
    expect(seen?.model).toBe("typesafe/jev-1.13")
  })

  test("an overridden base URL still ends in OpenRouter's /decisions path, not TypeSafe's", async () => {
    let seenUrl: string | undefined

    await Effect.runPromise(
      evaluate(
        (request) => {
          seenUrl = request.url
          return { status: 200, body: okBody }
        },
        { provider: "openrouter", baseUrl: "https://proxy.internal/or/", model: "typesafe/jev-1.13" }
      )
    )

    expect(seenUrl).toBe("https://proxy.internal/or/decisions")
  })

  test("choosing openrouter never changes TypeSafe's own defaults", async () => {
    let seenUrl: string | undefined
    await Effect.runPromise(
      evaluate((request) => {
        seenUrl = request.url
        return { status: 200, body: okBody }
      })
    )
    expect(seenUrl).toBe("https://api.typesafe.ai/v1/systemone")
  })
})

describe("credential resolution reaches the wire", () => {
  test("explicit typesafe selection sends TYPESAFE_API_KEY as the bearer token, ignoring a configured OpenRouter key", async () => {
    let seen: { url: string; auth: string | undefined } | undefined
    await Effect.runPromise(
      evaluateFromConfig(
        { TYPESAFE_API_KEY: "ts-secret", OPENROUTER_API_KEY: "or-secret" },
        (request) => {
          seen = { url: request.url, auth: request.headers["authorization"] }
          return { status: 200, body: okBody }
        },
        { provider: "typesafe" }
      )
    )
    expect(seen?.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(seen?.auth).toBe("Bearer ts-secret")
  })

  test("explicit openrouter selection sends OPENROUTER_API_KEY, ignoring a configured TypeSafe key", async () => {
    let seen: { url: string; auth: string | undefined } | undefined
    await Effect.runPromise(
      evaluateFromConfig(
        { TYPESAFE_API_KEY: "ts-secret", OPENROUTER_API_KEY: "or-secret" },
        (request) => {
          seen = { url: request.url, auth: request.headers["authorization"] }
          return { status: 200, body: okBody }
        },
        { provider: "openrouter" }
      )
    )
    expect(seen?.url).toBe("https://openrouter.ai/api/alpha/decisions")
    expect(seen?.auth).toBe("Bearer or-secret")
  })

  test("explicit typesafe selection fails before any request when only OPENROUTER_API_KEY is configured", async () => {
    let calls = 0
    const error = await failure(
      evaluateFromConfig(
        { OPENROUTER_API_KEY: "or-secret" },
        () => {
          calls += 1
          return { status: 200, body: okBody }
        },
        { provider: "typesafe" }
      )
    )
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
    if (error._tag === "SystemOne/MissingCredentialsError") {
      expect(error.reason).toContain("TYPESAFE_API_KEY")
      expect(error.reason).not.toContain("OPENROUTER_API_KEY")
    }
    expect(calls).toBe(0)
  })

  test("automatic selection: TYPESAFE_API_KEY wins over both TYPESAFE_AI_API_KEY and OPENROUTER_API_KEY", async () => {
    let seenUrl: string | undefined
    await Effect.runPromise(
      evaluateFromConfig(
        { TYPESAFE_API_KEY: "primary", TYPESAFE_AI_API_KEY: "secondary", OPENROUTER_API_KEY: "or-secret" },
        (request) => {
          seenUrl = request.url
          return { status: 200, body: okBody }
        }
      )
    )
    expect(seenUrl).toBe("https://api.typesafe.ai/v1/systemone")
  })

  test("automatic selection: a blank TYPESAFE_API_KEY is treated as absent, falling through to TYPESAFE_AI_API_KEY", async () => {
    let seen: { url: string; auth: string | undefined } | undefined
    await Effect.runPromise(
      evaluateFromConfig(
        { TYPESAFE_API_KEY: "", TYPESAFE_AI_API_KEY: "secondary" },
        (request) => {
          seen = { url: request.url, auth: request.headers["authorization"] }
          return { status: 200, body: okBody }
        }
      )
    )
    expect(seen?.url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(seen?.auth).toBe("Bearer secondary")
  })

  test("automatic selection: falls through to OPENROUTER_API_KEY once both TypeSafe variables are absent", async () => {
    let seenUrl: string | undefined
    await Effect.runPromise(
      evaluateFromConfig(
        { OPENROUTER_API_KEY: "or-secret" },
        (request) => {
          seenUrl = request.url
          return { status: 200, body: okBody }
        }
      )
    )
    expect(seenUrl).toBe("https://openrouter.ai/api/alpha/decisions")
  })

  test("automatic selection fails, naming all three variables, before any request when none is configured", async () => {
    let calls = 0
    const error = await failure(
      evaluateFromConfig({}, () => {
        calls += 1
        return { status: 200, body: okBody }
      })
    )
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
    if (error._tag === "SystemOne/MissingCredentialsError") {
      expect(error.reason).toContain("TYPESAFE_API_KEY")
      expect(error.reason).toContain("TYPESAFE_AI_API_KEY")
      expect(error.reason).toContain("OPENROUTER_API_KEY")
    }
    expect(calls).toBe(0)
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
    if (error._tag === "SystemOne/RequestError") {
      expect(error.status).toBe(422)
      expect(error.body).toBe("invalid question")
    }
  })

  // SPEC.md's "Provider error mapping" table: 400/402/403/404/413 are
  // OpenRouter-documented statuses that share the exact same terminal
  // RequestError treatment as TypeSafe's 422 above — one status matcher,
  // provider-neutral, each preserving the real HTTP status and body.
  describe("OpenRouter's documented terminal statuses map the same way TypeSafe's 422 does", () => {
    const cases = [
      { status: 400, body: "malformed request", meaning: "malformed or invalid request" },
      { status: 402, body: "insufficient credits", meaning: "insufficient credits or quota" },
      { status: 403, body: "operation denied", meaning: "authenticated but denied" },
      { status: 404, body: "model not found", meaning: "resource, route, or model not found" },
      { status: 413, body: "payload too large", meaning: "request payload too large" }
    ] as const

    for (const { body, meaning, status } of cases) {
      test(`${status} (${meaning}) becomes a terminal RequestError carrying that status and body`, async () => {
        const error = await failure(
          evaluate(() => ({ status, body }), { provider: "openrouter" })
        )
        expect(error._tag).toBe("SystemOne/RequestError")
        expect(isTransient(error)).toBe(false)
        if (error._tag === "SystemOne/RequestError") {
          expect(error.status).toBe(status)
          expect(error.body).toBe(body)
        }
      })
    }
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

  // SPEC.md's error table documents 500, 502, 503, 524, and 529 (among
  // others) as OpenRouter/upstream overload statuses, all transient.
  describe("every documented 5xx is transient, carrying its real status and body", () => {
    for (const status of [500, 502, 503, 524, 529] as const) {
      test(`${status} becomes a transient OverloadedError`, async () => {
        const error = await failure(
          evaluate(() => ({ status, body: `upstream ${status}` }), { provider: "openrouter" })
        )
        expect(error._tag).toBe("SystemOne/OverloadedError")
        expect(isTransient(error)).toBe(true)
        if (error._tag === "SystemOne/OverloadedError") {
          expect(error.status).toBe(status)
          expect(error.body).toBe(`upstream ${status}`)
        }
      })
    }
  })

  test("an undocumented status is a ResponseError, not a guess", async () => {
    const error = await failure(evaluate(() => ({ status: 302, body: "" })))
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("unexpected status 302")
  })

  test("an undocumented status is a ResponseError for OpenRouter too — the mapping is provider-neutral", async () => {
    const error = await failure(evaluate(() => ({ status: 418, body: "" }), { provider: "openrouter" }))
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("unexpected status 418")
  })
})

describe("pre-flight rejects an incompatible OpenRouter request before transport", () => {
  const countingLayer = () => {
    let calls = 0
    const layer = Testing.layerHttp(() => {
      calls += 1
      return { status: 200, body: okBody }
    })
    return { layer, calls: () => calls }
  }

  const evaluateOpenRouter = (
    state: Question.Json,
    requestQuestions: Question.Questions,
    http: ReturnType<typeof countingLayer>
  ) =>
    SystemOne.evaluate({ state, questions: requestQuestions }).pipe(
      Effect.provide(SystemOne.layer({ apiKey, provider: "openrouter" })),
      Effect.provide(http.layer)
    )

  test("a bare top-level number state never reaches the network", async () => {
    const http = countingLayer()
    const error = await failure(evaluateOpenRouter(42, questions, http))
    expect(error._tag).toBe("SystemOne/RequestError")
    if (error._tag === "SystemOne/RequestError") {
      // A local pre-flight rejection never reached a real response, so it
      // must not invent an HTTP status.
      expect(error.status).toBeUndefined()
    }
    expect(http.calls()).toBe(0)
  })

  test("a noul criteria object missing 'false' never reaches the network", async () => {
    const http = countingLayer()
    const criteria = { true: "yes signal" }
    const incompatible = { urgent: Question.noul({ instructions: "Escalated?", criteria }) }
    const stateBefore = "I was charged twice."

    const error = await failure(evaluateOpenRouter(stateBefore, incompatible, http))

    expect(error._tag).toBe("SystemOne/RequestError")
    expect(http.calls()).toBe(0)
    // Not mutated, not filled in — rejected as-is.
    expect(incompatible.urgent.criteria).toBe(criteria)
    expect(criteria).toEqual({ true: "yes signal" })
  })

  test("the same request is accepted for TypeSafe (this is an OpenRouter-only constraint)", async () => {
    const http = countingLayer()
    const criteria = { true: "yes signal" }
    const lopsided = { urgent: Question.noul({ instructions: "Escalated?", criteria }) }

    // Only pre-flight passing (i.e. a request was actually dispatched) is
    // under test here — whatever the stubbed response then does is
    // irrelevant, so the result is discarded rather than asserted on.
    await Effect.runPromise(
      Effect.ignore(
        SystemOne.evaluate({ state: 42, questions: lopsided }).pipe(
          Effect.provide(SystemOne.layer({ apiKey })),
          Effect.provide(http.layer)
        )
      )
    )

    expect(http.calls()).toBe(1)
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

  test("retryTransient never switches providers mid-retry", async () => {
    // `retryTransient` just retries the same Effect, and the provider is
    // baked into that Effect at layer-construction time (a fixed URL) — so
    // this can only regress if a future change threaded provider selection
    // through per-attempt state instead. Every attempt's URL must stay
    // OpenRouter's, never falling back to TypeSafe's.
    const seenUrls: Array<string> = []
    const result = await Effect.runPromise(
      SystemOne.retryTransient(
        evaluate(
          (request) => {
            seenUrls.push(request.url)
            return seenUrls.length < 3 ? { status: 529, body: "overloaded" } : { status: 200, body: okBody }
          },
          { provider: "openrouter" }
        ),
        immediately
      )
    )
    expect(seenUrls).toEqual([
      "https://openrouter.ai/api/alpha/decisions",
      "https://openrouter.ai/api/alpha/decisions",
      "https://openrouter.ai/api/alpha/decisions"
    ])
    expect(result.answers.refund.noul).toBe(0.97)
  })
})
