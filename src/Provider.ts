/**
 * The seam between the one shared `SystemOne` service and the two APIs it can
 * be configured against.
 *
 * TypeSafe's own System One endpoint and OpenRouter's Decisions endpoint
 * serve the same model family and share the core request/response shape, but
 * they are different APIs: different base URLs and paths, different default
 * models, different accepted environment variables, and small documented
 * differences in what a request may look like. This module is the single
 * place that knows there are two providers — the provider table, credential
 * resolution and its selection order, URL building, and the provider-specific
 * pre-flight checks — so `SystemOne.ts` stays one code path that only differs
 * in which `Layer` it was built from.
 *
 * Depends only on `Question.ts`'s types and `Errors.ts`'s
 * `MissingCredentialsError`. Nothing but `SystemOne.ts` (and, transitively,
 * `index.ts`) imports this module.
 *
 * @since 0.1.0
 */
import { Config, Effect, Option, Redacted } from "effect"
import { MissingCredentialsError } from "./Errors.js"
import type * as Question from "./Question.js"

/**
 * The providers `SystemOne` can be configured against.
 *
 * @since 0.1.0
 */
export type Provider = "typesafe" | "openrouter"

/**
 * Everything provider-specific: where to send the request, what model to ask
 * for when the caller doesn't say, and which environment variables carry a
 * usable API key for it, in priority order.
 *
 * @since 0.1.0
 */
export interface ProviderConfig {
  readonly baseUrl: string
  readonly path: string
  readonly defaultModel: string
  readonly envVars: ReadonlyArray<string>
}

/**
 * The provider table, matching SPEC.md's "Providers, transport and
 * configuration" section exactly.
 *
 * @since 0.1.0
 */
export const providers: Record<Provider, ProviderConfig> = {
  typesafe: {
    baseUrl: "https://api.typesafe.ai/v1",
    path: "/systemone",
    defaultModel: "jev-latest",
    envVars: ["TYPESAFE_API_KEY", "TYPESAFE_AI_API_KEY"]
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/alpha",
    path: "/decisions",
    defaultModel: "typesafe/jev-1.13",
    envVars: ["OPENROUTER_API_KEY"]
  }
}

/**
 * `SystemOne.ts`'s exported `defaultModel`/`defaultBaseUrl` constants are
 * sourced from here, so both stay in one table while keeping their existing
 * exported values unchanged (`test/golden/record.ts` and any other consumer
 * of those constants keeps working untouched).
 *
 * @since 0.1.0
 */
export const defaultModel: string = providers.typesafe.defaultModel

/**
 * @since 0.1.0
 */
export const defaultBaseUrl: string = providers.typesafe.baseUrl

/**
 * Builds the full request URL for a provider: an explicit `baseUrlOverride`
 * wins over the provider's own base URL, but the provider always supplies the
 * path suffix (`/systemone` or `/decisions`) — overriding `baseUrl` changes
 * where the request goes, not the shape of what's appended to it, exactly as
 * the existing TypeSafe-only code already behaved.
 *
 * Trailing slashes on the base are stripped first, preserving today's
 * behaviour.
 *
 * @since 0.1.0
 */
export const buildUrl = (provider: Provider, baseUrlOverride?: string | undefined): string => {
  const config = providers[provider]
  const base = baseUrlOverride ?? config.baseUrl
  return `${base.replace(/\/+$/, "")}${config.path}`
}

/**
 * Reads one environment variable as an optional, trimmed string. A blank
 * value (`FOO=`) counts as absent, the same treatment
 * `test/golden/record.ts` already gives `TYPESAFE_API_KEY`/`TYPESAFE_AI_API_KEY`
 * when deciding whether a key is really configured.
 *
 * @since 0.1.0
 */
export const configuredKey = (name: string): Effect.Effect<Option.Option<string>> =>
  Effect.map(Config.option(Config.Redacted(name)), (key) =>
    Option.isSome(key)
      ? Option.filter(Option.some(Redacted.value(key.value).trim()), (s) => s.length > 0)
      : Option.none<string>()).pipe(
        // `Config.option` only fails if the underlying source itself errors
        // (not merely "unset", which it already turns into `None`) — treat
        // that the same as the variable being unset rather than widening
        // every caller's error channel for a case this narrow.
        Effect.orElseSucceed(() => Option.none<string>())
      )

const namesFor = (provider: Provider): string => providers[provider].envVars.join(" or ")

/**
 * Resolves which provider to use and which of its API keys is configured.
 *
 * This is startup/layer-construction logic only — called once per
 * `Layer.unwrap`, never per request, so nothing can fail over mid-run:
 *
 * - An explicit `provider` reads only that provider's `envVars`, in order,
 *   and fails naming only those variables if none is set. It never falls
 *   back to another provider's key even if one is configured.
 * - With no explicit `provider`, tries `TYPESAFE_API_KEY`, then
 *   `TYPESAFE_AI_API_KEY`, then `OPENROUTER_API_KEY` (each non-blank), and
 *   fails naming all three if none is set.
 *
 * @since 0.1.0
 */
export const resolveCredentials = (
  explicit?: Provider | undefined
): Effect.Effect<
  { readonly provider: Provider; readonly apiKey: Redacted.Redacted<string> },
  MissingCredentialsError
> =>
  Effect.gen(function*() {
    if (explicit !== undefined) {
      for (const name of providers[explicit].envVars) {
        const key = yield* configuredKey(name)
        if (Option.isSome(key)) {
          return { provider: explicit, apiKey: Redacted.make(key.value) }
        }
      }
      return yield* Effect.fail(
        new MissingCredentialsError({
          reason: `no ${namesFor(explicit)} set for provider ${JSON.stringify(explicit)}`
        })
      )
    }

    for (const provider of ["typesafe", "openrouter"] as const) {
      for (const name of providers[provider].envVars) {
        const key = yield* configuredKey(name)
        if (Option.isSome(key)) {
          return { provider, apiKey: Redacted.make(key.value) }
        }
      }
    }
    return yield* Effect.fail(
      new MissingCredentialsError({
        reason: `no ${providers.typesafe.envVars.join(", ")}, or ${providers.openrouter.envVars.join(", ")} set`
      })
    )
  })

/**
 * A pure, provider-specific pre-flight check, in the same "return the reason
 * or `undefined`" style as `Question.validate`. Never mutates `state` or any
 * question's `criteria` — an incompatible request is rejected, not silently
 * normalized to fit.
 *
 * The bounds `Question.validate` already enforces (2+ choice options, 2-10
 * score levels) stay there and apply to both providers unchanged; this only
 * adds the two documented OpenRouter-only constraints.
 *
 * @since 0.1.0
 */
export const preflight = (
  provider: Provider,
  request: { readonly state: Question.Json; readonly questions: Question.Questions }
): string | undefined => {
  if (provider !== "openrouter") return undefined

  // OpenRouter documents top-level `state` as a string, object, or array —
  // never a bare number, boolean, or null. Nested values are unaffected.
  const state = request.state
  if (state === null || typeof state === "number" || typeof state === "boolean") {
    return `OpenRouter does not accept a top-level state of type ${state === null ? "null" : typeof state}`
  }

  for (const name of Object.keys(request.questions)) {
    const question = request.questions[name]!
    if (question.type === "noul" && question.criteria !== undefined) {
      const hasTrue = Object.hasOwn(question.criteria, "true")
      const hasFalse = Object.hasOwn(question.criteria, "false")
      if (hasTrue !== hasFalse) {
        return `question ${
          JSON.stringify(name)
        } is a noul with a criteria object that omits ${hasTrue ? "\"false\"" : "\"true\""}; OpenRouter requires both when criteria is present`
      }
    }
  }

  return undefined
}
