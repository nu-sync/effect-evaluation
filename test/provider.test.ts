/**
 * Unit tests for `src/Provider.ts` — the module that knows there are two
 * providers. Covers the provider table, URL building, environment-variable
 * credential resolution (explicit selection that never falls back, the
 * automatic TypeSafe-then-OpenRouter ordering with blank-is-absent
 * semantics, and the missing-key failure), and the two OpenRouter-only
 * pre-flight checks.
 *
 * Everything here is pure or config-level: no HTTP layer is involved.
 * `test/transport.test.ts` covers the same provider distinctions end to end,
 * through a real (stubbed) request/response cycle.
 */
import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Redacted } from "effect"
import * as Provider from "../src/Provider.js"
import * as Question from "../src/Question.js"

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)
const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

/**
 * Runs an effect against an explicit, fake environment record instead of the
 * real process environment. This repository's `.env` carries a live
 * `TYPESAFE_API_KEY` (for the examples), so every credential-resolution test
 * below must pin its own environment rather than reading the real one — a
 * test that forgot to do this could pass by accident against a real key
 * instead of exercising the case it names.
 *
 * `preserveEmptyStrings: true` is deliberate: without it, `ConfigProvider`
 * itself would treat `""` as absent, which would test the provider's
 * behaviour instead of `Provider.configuredKey`'s own blank-is-absent
 * handling.
 */
const withEnv = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  env: Record<string, string>
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env, preserveEmptyStrings: true }))
  )

describe("the provider table", () => {
  test("matches SPEC.md's 'Providers, transport and configuration' table exactly", () => {
    expect(Provider.providers.typesafe).toEqual({
      baseUrl: "https://api.typesafe.ai/v1",
      path: "/systemone",
      defaultModel: "jev-latest",
      envVars: ["TYPESAFE_API_KEY", "TYPESAFE_AI_API_KEY"]
    })
    expect(Provider.providers.openrouter).toEqual({
      baseUrl: "https://openrouter.ai/api/alpha",
      path: "/decisions",
      defaultModel: "typesafe/jev-1.13",
      envVars: ["OPENROUTER_API_KEY"]
    })
  })

  test("SystemOne's exported defaults are still TypeSafe's, unchanged by adding a second provider", () => {
    expect(Provider.defaultModel).toBe("jev-latest")
    expect(Provider.defaultBaseUrl).toBe("https://api.typesafe.ai/v1")
  })
})

describe("buildUrl", () => {
  test("typesafe: the default base plus /systemone", () => {
    expect(Provider.buildUrl("typesafe")).toBe("https://api.typesafe.ai/v1/systemone")
  })

  test("openrouter: the default base plus /decisions", () => {
    expect(Provider.buildUrl("openrouter")).toBe("https://openrouter.ai/api/alpha/decisions")
  })

  test("an overridden base URL replaces the base but the provider still supplies the path suffix", () => {
    expect(Provider.buildUrl("openrouter", "https://proxy.internal/or")).toBe("https://proxy.internal/or/decisions")
    expect(Provider.buildUrl("typesafe", "https://proxy.internal/v1")).toBe("https://proxy.internal/v1/systemone")
  })

  test("a trailing slash on the override is stripped, same as the existing TypeSafe-only behaviour", () => {
    expect(Provider.buildUrl("typesafe", "https://proxy.internal/v1/")).toBe("https://proxy.internal/v1/systemone")
    expect(Provider.buildUrl("openrouter", "https://proxy.internal/or///")).toBe("https://proxy.internal/or/decisions")
  })
})

describe("configuredKey: a blank value counts as absent", () => {
  test("a real value comes back trimmed", async () => {
    const result = await run(withEnv(Provider.configuredKey("FOO"), { FOO: "  abc123  " }))
    expect(result._tag).toBe("Some")
    if (result._tag === "Some") expect(result.value).toBe("abc123")
  })

  test("an empty string is None, not Some('')", async () => {
    const result = await run(withEnv(Provider.configuredKey("FOO"), { FOO: "" }))
    expect(result._tag).toBe("None")
  })

  test("a whitespace-only value is None", async () => {
    const result = await run(withEnv(Provider.configuredKey("FOO"), { FOO: "   " }))
    expect(result._tag).toBe("None")
  })

  test("an unset variable is None", async () => {
    const result = await run(withEnv(Provider.configuredKey("FOO"), {}))
    expect(result._tag).toBe("None")
  })
})

describe("resolveCredentials: explicit selection never falls back", () => {
  test("explicit typesafe reads TYPESAFE_API_KEY when it is set", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials("typesafe"), {
        TYPESAFE_API_KEY: "primary-key",
        OPENROUTER_API_KEY: "or-key"
      })
    )
    expect(result.provider).toBe("typesafe")
    expect(Redacted.value(result.apiKey)).toBe("primary-key")
  })

  test("explicit typesafe falls through to TYPESAFE_AI_API_KEY only when TYPESAFE_API_KEY is blank", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials("typesafe"), {
        TYPESAFE_API_KEY: "",
        TYPESAFE_AI_API_KEY: "secondary-key"
      })
    )
    expect(result.provider).toBe("typesafe")
    expect(Redacted.value(result.apiKey)).toBe("secondary-key")
  })

  test("explicit typesafe fails naming only its own variables, even though OPENROUTER_API_KEY is configured", async () => {
    const error = await failure(
      withEnv(Provider.resolveCredentials("typesafe"), { OPENROUTER_API_KEY: "or-key" })
    )
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
    expect(error.reason).toContain("TYPESAFE_API_KEY")
    expect(error.reason).toContain("TYPESAFE_AI_API_KEY")
    expect(error.reason).not.toContain("OPENROUTER_API_KEY")
  })

  test("explicit openrouter reads OPENROUTER_API_KEY, ignoring a configured TypeSafe key", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials("openrouter"), {
        TYPESAFE_API_KEY: "ts-key",
        OPENROUTER_API_KEY: "or-key"
      })
    )
    expect(result.provider).toBe("openrouter")
    expect(Redacted.value(result.apiKey)).toBe("or-key")
  })

  test("explicit openrouter fails naming only OPENROUTER_API_KEY, even though a TypeSafe key is configured", async () => {
    const error = await failure(
      withEnv(Provider.resolveCredentials("openrouter"), { TYPESAFE_API_KEY: "ts-key" })
    )
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
    expect(error.reason).toContain("OPENROUTER_API_KEY")
    expect(error.reason).not.toContain("TYPESAFE_API_KEY")
  })
})

describe("resolveCredentials: automatic ordering (no explicit provider)", () => {
  test("TYPESAFE_API_KEY wins when all three variables are set", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials(), {
        TYPESAFE_API_KEY: "primary",
        TYPESAFE_AI_API_KEY: "secondary",
        OPENROUTER_API_KEY: "or-key"
      })
    )
    expect(result.provider).toBe("typesafe")
    expect(Redacted.value(result.apiKey)).toBe("primary")
  })

  test("falls through to TYPESAFE_AI_API_KEY when TYPESAFE_API_KEY is blank", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials(), {
        TYPESAFE_API_KEY: "",
        TYPESAFE_AI_API_KEY: "secondary",
        OPENROUTER_API_KEY: "or-key"
      })
    )
    expect(result.provider).toBe("typesafe")
    expect(Redacted.value(result.apiKey)).toBe("secondary")
  })

  test("falls through to OPENROUTER_API_KEY only once both TypeSafe variables are absent", async () => {
    const result = await run(
      withEnv(Provider.resolveCredentials(), { OPENROUTER_API_KEY: "or-key" })
    )
    expect(result.provider).toBe("openrouter")
    expect(Redacted.value(result.apiKey)).toBe("or-key")
  })

  test("a blank OPENROUTER_API_KEY is treated the same as absent", async () => {
    const error = await failure(
      withEnv(Provider.resolveCredentials(), { OPENROUTER_API_KEY: "   " })
    )
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
  })

  test("fails naming all three variables when none is configured", async () => {
    const error = await failure(withEnv(Provider.resolveCredentials(), {}))
    expect(error._tag).toBe("SystemOne/MissingCredentialsError")
    expect(error.reason).toContain("TYPESAFE_API_KEY")
    expect(error.reason).toContain("TYPESAFE_AI_API_KEY")
    expect(error.reason).toContain("OPENROUTER_API_KEY")
  })
})

describe("preflight: provider-specific request-shape checks", () => {
  const questions = {
    urgent: Question.noul({ instructions: "Is this urgent?" })
  }

  test("typesafe never rejects, regardless of state shape or a lopsided noul criteria object", () => {
    for (const state of [42, true, null, "text", { a: 1 }, [1, 2]] as const) {
      expect(Provider.preflight("typesafe", { state, questions })).toBeUndefined()
    }
    const lopsided = {
      urgent: Question.noul({ instructions: "Escalated?", criteria: { true: "yes signal" } })
    }
    expect(Provider.preflight("typesafe", { state: "text", questions: lopsided })).toBeUndefined()
  })

  test("openrouter rejects a bare top-level number, boolean, or null state", () => {
    for (const state of [42, true, false, null] as const) {
      const reason = Provider.preflight("openrouter", { state, questions })
      expect(reason).toBeDefined()
      expect(reason).toContain("does not accept a top-level state")
    }
  })

  test("openrouter accepts a string, object, or array state", () => {
    for (const state of ["text", { a: 1 }, [1, 2, 3]] as const) {
      expect(Provider.preflight("openrouter", { state, questions })).toBeUndefined()
    }
  })

  test("openrouter accepts a noul with no criteria at all", () => {
    expect(Provider.preflight("openrouter", { state: "text", questions })).toBeUndefined()
  })

  test("openrouter accepts a noul whose criteria has both true and false", () => {
    const both = {
      urgent: Question.noul({ instructions: "Escalated?", criteria: { true: "yes signal", false: "no signal" } })
    }
    expect(Provider.preflight("openrouter", { state: "text", questions: both })).toBeUndefined()
  })

  test("openrouter rejects a noul criteria object missing 'false'", () => {
    const missingFalse = {
      urgent: Question.noul({ instructions: "Escalated?", criteria: { true: "yes signal" } })
    }
    const reason = Provider.preflight("openrouter", { state: "text", questions: missingFalse })
    expect(reason).toBeDefined()
    expect(reason).toContain("urgent")
    expect(reason).toContain("false")
  })

  test("openrouter rejects a noul criteria object missing 'true'", () => {
    const missingTrue = {
      urgent: Question.noul({ instructions: "Escalated?", criteria: { false: "no signal" } })
    }
    const reason = Provider.preflight("openrouter", { state: "text", questions: missingTrue })
    expect(reason).toBeDefined()
    expect(reason).toContain("urgent")
    expect(reason).toContain("true")
  })

  test("never mutates the caller's state or questions, even when rejecting", () => {
    const state = { nested: { a: [1, 2, 3] } }
    const stateBefore = JSON.parse(JSON.stringify(state))
    const criteria = { true: "yes signal" }
    const rejectable = { urgent: Question.noul({ instructions: "Escalated?", criteria }) }

    // Exercise every branch: an offending state, an offending noul, and both
    // at once — none of them may touch the objects passed in.
    Provider.preflight("openrouter", { state: 42, questions })
    Provider.preflight("openrouter", { state, questions: rejectable })
    Provider.preflight("openrouter", { state: null, questions: rejectable })

    expect(state).toEqual(stateBefore)
    // The same criteria object reference, untouched — no key was filled in.
    expect(rejectable.urgent.criteria).toBe(criteria)
    expect(criteria).toEqual({ true: "yes signal" })
  })
})
