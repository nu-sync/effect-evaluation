/**
 * Deterministic layers for testing without a paid API call.
 *
 * Handlers return raw JSON, which is then run through exactly the decoder and
 * reconciliation the live client uses. A fixture that the real client would
 * reject therefore fails your test too, which is the only way a stub is worth
 * having.
 *
 * @since 0.1.0
 */
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type * as Answer from "./Answer.js"
import type { SystemOneError } from "./Errors.js"
import type * as Question from "./Question.js"
import * as SystemOne from "./SystemOne.js"

/**
 * A stand-in for the service: given a request, produce the raw JSON body the
 * API would have returned, or fail with a typed error.
 *
 * @since 0.1.0
 */
export type Handler = (
  request: SystemOne.EvaluateRequest<Question.Questions>
) => Effect.Effect<unknown, SystemOneError> | unknown

const toEffect = (result: Effect.Effect<unknown, SystemOneError> | unknown): Effect.Effect<unknown, SystemOneError> =>
  Effect.isEffect(result) ? result as Effect.Effect<unknown, SystemOneError> : Effect.succeed(result)

/**
 * A {@link SystemOne.SystemOne} layer backed by a handler.
 *
 * @example
 * ```ts
 * import { Testing } from "@nu-sync/effect-evaluation"
 *
 * const layer = Testing.layer((request) =>
 *   Testing.response({
 *     answers: { refund: { type: "noul", noul: 0.97 } }
 *   })
 * )
 * ```
 *
 * @since 0.1.0
 */
export const layer = (handler: Handler): Layer.Layer<SystemOne.SystemOne> =>
  Layer.succeed(SystemOne.SystemOne)({
    evaluate: <const Q extends Question.Questions>(request: SystemOne.EvaluateRequest<Q>) =>
      Effect.flatMap(
        toEffect(handler(request as SystemOne.EvaluateRequest<Question.Questions>)),
        (json) => SystemOne.decode(request.questions, json)
      )
  })

/**
 * A layer that answers every request with the same raw JSON body.
 *
 * @since 0.1.0
 */
export const layerFixture = (json: unknown): Layer.Layer<SystemOne.SystemOne> => layer(() => json)

/**
 * A layer that fails every request with the given error. Useful for exercising
 * failure paths and retry policies.
 *
 * @since 0.1.0
 */
export const layerFailure = (error: SystemOneError): Layer.Layer<SystemOne.SystemOne> =>
  layer(() => Effect.fail(error))

/**
 * Builds a well-formed response body from answers, filling in the envelope.
 *
 * @since 0.1.0
 */
export const response = (options: {
  readonly answers: { readonly [name: string]: Answer.Any }
  readonly model?: string
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
}): unknown => ({
  model: options.model ?? SystemOne.defaultModel,
  answers: options.answers,
  usage: {
    input_tokens: options.usage?.inputTokens ?? 0,
    output_tokens: options.usage?.outputTokens ?? 0
  }
})

/**
 * Builds a choice answer with a distribution, deriving `choice` as the
 * highest-probability option.
 *
 * `confidence` is supplied explicitly rather than computed: the real statistic
 * is not a documented formula, and inventing one here would make fixtures
 * disagree with the service in a way tests could not catch.
 *
 * @since 0.1.0
 */
export const choiceAnswer = <K extends string>(
  probabilities: { readonly [P in K]: number },
  confidence: number
): Answer.Choice<K> => {
  const entries = Object.entries(probabilities) as Array<[K, number]>
  let best = entries[0]!
  for (const entry of entries) {
    if (entry[1] > best[1]) best = entry
  }
  return { type: "choice", choice: best[0], probabilities, confidence }
}

/**
 * A canned HTTP response.
 *
 * @since 0.1.0
 */
export interface StubResponse {
  readonly status: number
  readonly body?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
}

/**
 * An `HttpClient` layer that answers every request from a function, for
 * exercising status handling — 401, 429 with `retry-after`, 529 — without a
 * network or an API key.
 *
 * Unlike {@link layer}, this stubs the transport, so the real request building,
 * status matching, and decoding all run.
 *
 * @since 0.1.0
 */
export const layerHttp = (
  handler: (request: HttpClientRequest.HttpClientRequest) => StubResponse
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => {
      const stub = handler(request)
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(stub.body ?? "", {
            status: stub.status,
            headers: { "content-type": "application/json", ...stub.headers }
          })
        )
      )
    })
  )
