/**
 * An Effect service for TypeSafe AI System One models.
 *
 * Jev is not a language model: it takes a state and a map of typed questions
 * and returns a probability distribution per question, with no text. That does
 * not fit `LanguageModel` or `EmbeddingModel` from `effect/unstable/ai`, so
 * this module defines its own service rather than bending an existing one.
 *
 * @since 0.1.0
 */
import { Config, Context, Duration, Effect, Function, Layer, Redacted, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import * as Answer from "./Answer.js"
import {
  AuthError,
  EncodeError,
  isTransient,
  OverloadedError,
  RateLimitError,
  RequestError,
  ResponseError,
  type SystemOneError,
  TransportError
} from "./Errors.js"
import * as Question from "./Question.js"

/**
 * Re-exported so the failure type is reachable alongside the service that
 * produces it.
 *
 * @since 0.1.0
 */
export type { SystemOneError } from "./Errors.js"

/**
 * The default model identifier.
 *
 * @since 0.1.0
 */
export const defaultModel = "jev-latest"

/**
 * The default API base URL.
 *
 * @since 0.1.0
 */
export const defaultBaseUrl = "https://api.typesafe.ai/v1"

/**
 * One System One request: a shared state, and the questions to ask about it.
 *
 * All questions are answered against the same state in a single round trip.
 *
 * @since 0.1.0
 */
export interface EvaluateRequest<Q extends Question.Questions> {
  readonly state: Question.Json
  readonly questions: Q
  /** Overrides the model this client was configured with. */
  readonly model?: string
}

/**
 * The result of one request: the typed answer map, what it cost, the decoded
 * wire response it came from, and the verbatim body it was decoded from.
 *
 * `raw` and `body` are both kept, deliberately, and are not the same thing:
 *
 * - `raw` is the **decoded, schema-checked** view — `Answer.DecodedResponse`,
 *   the shape `Answer.ResponseSchema` models. `Schema.Struct` drops any
 *   property it does not declare, so `raw` only ever shows what this version
 *   of the client already knows how to read.
 * - `body` is **what actually arrived**: the verbatim, undecoded JSON the
 *   service returned, before `Schema` touched it. A request id, a per-answer
 *   rationale, a new usage counter — anything the API adds tomorrow that this
 *   client does not model yet — survives here even though it is invisible on
 *   `raw`.
 *
 * An aggregate is never enough evidence, and neither, on its own, is a value
 * a schema has already filtered. Keep `body` around for anything that needs
 * the response as it truly was — an audit trail, a content-addressed
 * artifact, a future decoder — and use `raw` for everything that just wants
 * the typed, checked view.
 *
 * @since 0.1.0
 */
export interface Evaluation<Q extends Question.Questions> {
  readonly model: string
  readonly answers: Answer.AnswersFor<Q>
  readonly usage: Answer.Usage
  readonly raw: Answer.DecodedResponse
  readonly body: unknown
}

/**
 * The service interface.
 *
 * @since 0.1.0
 */
export interface Service {
  readonly evaluate: <const Q extends Question.Questions>(
    request: EvaluateRequest<Q>
  ) => Effect.Effect<Evaluation<Q>, SystemOneError>
}

/**
 * The System One service key.
 *
 * @since 0.1.0
 */
export class SystemOne extends Context.Service<SystemOne, Service>()("effect-evaluation/SystemOne") {}

/**
 * How to reach the service.
 *
 * @since 0.1.0
 */
export interface Options {
  readonly apiKey: Redacted.Redacted<string>
  /** Defaults to {@link defaultModel}. */
  readonly model?: string | undefined
  /** Defaults to {@link defaultBaseUrl}. */
  readonly baseUrl?: string | undefined
}

// Only the delta-seconds form of `Retry-After` is handled. RFC 9110 also
// allows an HTTP-date form; that form fails `Number(raw)` and degrades to
// `undefined` rather than being parsed, which just means the schedule's own
// backoff runs with no server hint — never a wrong wait.
const parseRetryAfter = (headers: Readonly<Record<string, string | undefined>>): number | undefined => {
  const raw = headers["retry-after"]
  if (raw === undefined) return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) ? seconds : undefined
}

const bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

/**
 * Checks a decoded response against the questions that were asked, and builds
 * the typed answer map.
 *
 * A missing answer, an answer of the wrong type, or a chosen option that was
 * never offered all fail here rather than being coerced — each one would make
 * the static answer type a lie. The same reasoning extends to the shape of the
 * distribution itself: `Choice.probabilities` is typed as a total map over
 * every offered option (`noUncheckedIndexedAccess` does not see through a
 * mapped type over a literal union, so every read comes back typed `number`),
 * and `Score.legend`/`probabilities` are read by level index up to
 * `levelCount`. A partial response would make those typed reads lie about
 * being `number`, so a missing or extra entry fails here too, before it can
 * reach a caller as `undefined`.
 *
 * Exported so test and replay layers decode and check exactly like the live
 * client does.
 *
 * `body` is the verbatim, undecoded JSON `decoded` came from — reconcile
 * takes it only to carry it through onto {@link Evaluation.body} unchanged,
 * never to read from it. Its only caller today is {@link decode}, which
 * already has the raw JSON in hand; a caller reconciling a decoded value with
 * no body of its own may pass `decoded` itself, since a decoded value is
 * always a subset of the JSON it came from.
 *
 * @since 0.1.0
 */
export const reconcile = <const Q extends Question.Questions>(
  questions: Q,
  decoded: Answer.DecodedResponse,
  body: unknown
): Effect.Effect<Evaluation<Q>, ResponseError> =>
  Effect.suspend(() => {
    const answers: Record<string, Answer.Any> = {}
    for (const name of Object.keys(questions)) {
      const question = questions[name]!
      const answer = decoded.answers[name]
      if (answer === undefined) {
        return Effect.fail(
          new ResponseError({ reason: `no answer for question ${JSON.stringify(name)}` })
        )
      }
      if (answer.type !== question.type) {
        return Effect.fail(
          new ResponseError({
            reason: `question ${JSON.stringify(name)} is a ${question.type} but the answer is a ${answer.type}`
          })
        )
      }
      if (answer.type === "choice" && question.type === "choice") {
        if (!Object.hasOwn(question.criteria, answer.choice)) {
          return Effect.fail(
            new ResponseError({
              reason: `question ${JSON.stringify(name)} was answered with option ${
                JSON.stringify(answer.choice)
              }, which was not offered`
            })
          )
        }
        // `probabilities` is typed as a total map over every offered option —
        // a missing entry would make that typed `number` read a lie, and an
        // extra one would be a live option the question never offered.
        for (const option of Object.keys(question.criteria)) {
          if (!Object.hasOwn(answer.probabilities, option)) {
            return Effect.fail(
              new ResponseError({
                reason:
                  `question ${JSON.stringify(name)} offers option ${JSON.stringify(option)}, but the response's probabilities has no entry for it`
              })
            )
          }
        }
        for (const option of Object.keys(answer.probabilities)) {
          if (!Object.hasOwn(question.criteria, option)) {
            return Effect.fail(
              new ResponseError({
                reason:
                  `question ${JSON.stringify(name)}'s probabilities included option ${
                    JSON.stringify(option)
                  }, which was not offered`
              })
            )
          }
        }
      }
      if (answer.type === "score" && question.type === "score") {
        // `legend`/`probabilities` are read by level index up to `levelCount`;
        // a legend with fewer entries than the question offered would leave
        // `Answer.normalized` dividing by the wrong span instead of failing.
        const levels = (question.criteria as ReadonlyArray<Question.Entry>).length
        for (let level = 0; level < levels; level++) {
          const key = String(level)
          if (!Object.hasOwn(answer.legend, key)) {
            return Effect.fail(
              new ResponseError({
                reason:
                  `question ${JSON.stringify(name)} offers ${levels} level(s), but the response's legend has no entry for level ${key}`
              })
            )
          }
          if (!Object.hasOwn(answer.probabilities, key)) {
            return Effect.fail(
              new ResponseError({
                reason:
                  `question ${JSON.stringify(name)} offers ${levels} level(s), but the response's probabilities has no entry for level ${key}`
              })
            )
          }
        }
      }
      answers[name] = answer
    }
    return Effect.succeed({
      model: decoded.model,
      answers: answers as Answer.AnswersFor<Q>,
      usage: {
        inputTokens: decoded.usage.input_tokens,
        outputTokens: decoded.usage.output_tokens,
        totalTokens: decoded.usage.input_tokens + decoded.usage.output_tokens
      },
      raw: decoded,
      body
    })
  })

const decodeResponse = Schema.decodeUnknownEffect(Answer.ResponseSchema)

/**
 * Decodes raw JSON into a checked, typed evaluation.
 *
 * `json` is threaded through unchanged onto {@link Evaluation.body}: `raw`
 * (the decoded value) only ever carries what `Answer.ResponseSchema` models,
 * so `body` is what preserves anything this client does not decode yet.
 *
 * @since 0.1.0
 */
export const decode = <const Q extends Question.Questions>(
  questions: Q,
  json: unknown
): Effect.Effect<Evaluation<Q>, ResponseError> =>
  decodeResponse(json).pipe(
    Effect.mapError((cause) =>
      new ResponseError({ reason: "response body did not match the documented shape", cause })
    ),
    Effect.flatMap((decoded) => reconcile(questions, decoded, json))
  )

const handleResponse = <const Q extends Question.Questions>(
  questions: Q,
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<Evaluation<Q>, SystemOneError> =>
  HttpClientResponse.matchStatus({
    "2xx": (ok: HttpClientResponse.HttpClientResponse) =>
      ok.json.pipe(
        Effect.mapError((cause) => new ResponseError({ reason: "response body was not JSON", cause })),
        Effect.flatMap((json) => decode(questions, json))
      ),
    401: (r: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(bodyText(r), (body) => Effect.fail(new AuthError({ body }))),
    422: (r: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(bodyText(r), (body) =>
        Effect.fail(new RequestError({ reason: "the service rejected the request (422)", body }))),
    429: (r: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(bodyText(r), (body) =>
        Effect.fail(new RateLimitError({ retryAfterSeconds: parseRetryAfter(r.headers), body }))),
    "5xx": (r: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(bodyText(r), (body) => Effect.fail(new OverloadedError({ status: r.status, body }))),
    orElse: (r: HttpClientResponse.HttpClientResponse) =>
      Effect.flatMap(bodyText(r), (body) =>
        Effect.fail(new ResponseError({ reason: `unexpected status ${r.status}`, cause: body })))
  })(response) as Effect.Effect<Evaluation<Q>, SystemOneError>

/**
 * Builds the service from an `HttpClient`.
 *
 * @since 0.1.0
 */
export const make = (options: Options): Effect.Effect<Service, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const baseUrl = options.baseUrl ?? defaultBaseUrl
    const configuredModel = options.model ?? defaultModel
    const url = `${baseUrl.replace(/\/+$/, "")}/systemone`

    const evaluate = <const Q extends Question.Questions>(
      request: EvaluateRequest<Q>
    ): Effect.Effect<Evaluation<Q>, SystemOneError> => {
      const model = request.model ?? configuredModel
      return Effect.gen(function*() {
        const invalid = Question.validate(request.questions)
        if (invalid !== undefined) {
          return yield* Effect.fail(new RequestError({ reason: invalid }))
        }
        const httpRequest = yield* HttpClientRequest.post(url).pipe(
          HttpClientRequest.bearerToken(Redacted.value(options.apiKey)),
          HttpClientRequest.bodyJson({
            state: request.state,
            model,
            questions: request.questions
          }),
          Effect.mapError((cause) => new EncodeError({ cause }))
        )
        const response = yield* client.execute(httpRequest).pipe(
          Effect.mapError((cause) => new TransportError({ cause }))
        )
        return yield* handleResponse(request.questions, response)
      }).pipe(
        Effect.withSpan("SystemOne.evaluate", {
          attributes: {
            "systemone.model": model,
            "systemone.questions": Object.keys(request.questions).length
          }
        })
      )
    }

    return { evaluate }
  })

/**
 * A layer providing {@link SystemOne} from explicit options. Requires an
 * `HttpClient`.
 *
 * @since 0.1.0
 */
export const layer = (options: Options): Layer.Layer<SystemOne, never, HttpClient.HttpClient> =>
  Layer.effect(SystemOne)(make(options))

/**
 * A layer reading the API key from configuration.
 *
 * Reads `TYPESAFE_API_KEY`, falling back to `TYPESAFE_AI_API_KEY` — the
 * official JavaScript SDK uses the first name and the AI SDK provider uses the
 * second, and being strict about which one is set helps nobody.
 *
 * @since 0.1.0
 */
export const layerConfig = (options?: {
  readonly model?: string | undefined
  readonly baseUrl?: string | undefined
}): Layer.Layer<SystemOne, Config.ConfigError, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.map(
      Config.Redacted("TYPESAFE_API_KEY").pipe(Config.orElse(() => Config.Redacted("TYPESAFE_AI_API_KEY"))),
      (apiKey) =>
        layer({
          apiKey,
          model: options?.model,
          baseUrl: options?.baseUrl
        })
    )
  )

/**
 * {@link layerConfig} with the platform `fetch` client already supplied.
 *
 * @since 0.1.0
 */
export const layerFetch = (options?: {
  readonly model?: string | undefined
  readonly baseUrl?: string | undefined
}): Layer.Layer<SystemOne, Config.ConfigError> => Layer.provide(layerConfig(options), FetchHttpClient.layer)

/**
 * Asks a set of questions about one state.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Question, SystemOne } from "effect-evaluation"
 *
 * const program = SystemOne.evaluate({
 *   state: "I was charged twice. Please refund the extra charge.",
 *   questions: {
 *     refund: Question.noul({ instructions: "Is the customer asking for a refund?" })
 *   }
 * })
 * ```
 *
 * @since 0.1.0
 */
export const evaluate = <const Q extends Question.Questions>(
  request: EvaluateRequest<Q>
): Effect.Effect<Evaluation<Q>, SystemOneError, SystemOne> =>
  Effect.flatMap(SystemOne, (service) => service.evaluate(request))

/**
 * Options for {@link retryTransient}.
 *
 * @since 0.1.0
 */
export interface RetryTransientOptions {
  readonly times?: number | undefined
  /** Defaults to exponential backoff from 500ms with jitter. */
  readonly schedule?: Schedule.Schedule<unknown, unknown, never> | undefined
  /**
   * Honour a 429's `Retry-After` header by sleeping for that long before the
   * schedule's own delay runs. Defaults to `true`.
   */
  readonly respectRetryAfter?: boolean | undefined
  /**
   * Upper bound on the `Retry-After` sleep, so a hostile or absurd header
   * cannot park a fiber indefinitely. Defaults to 60 seconds.
   */
  readonly maxRetryAfter?: Duration.Input | undefined
}

// A 429 whose `retryAfterSeconds` is present and positive is delayed by that
// many seconds (capped) before being re-failed, so the exponential schedule
// wrapped around this waits again on top of it rather than instead of it. The
// sleep is `Effect.sleep` under the hood, so it is interruptible like any
// other retry delay — interrupting the fiber does not wait out the cap first.
const withRetryAfter = <A, E extends SystemOneError, R>(
  self: Effect.Effect<A, E, R>,
  maxRetryAfter: Duration.Input
): Effect.Effect<A, E, R> =>
  Effect.catch(self, (error) => {
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined && error.retryAfterSeconds > 0) {
      const wait = Duration.min(Duration.seconds(error.retryAfterSeconds), Duration.fromInputUnsafe(maxRetryAfter))
      return Effect.delay(Effect.fail(error), wait)
    }
    return Effect.fail(error)
  })

/**
 * Retries only the failures that are actually worth retrying — transport
 * errors, 429, and 5xx/529 — with exponential backoff and jitter.
 *
 * This is opt-in on purpose. Evaluation is a pure read, so retrying is safe,
 * but a client that silently retries hides both latency and spend. Nothing in
 * this package retries unless you ask for it here.
 *
 * A 429 that carries a `Retry-After` hint is honoured before the schedule's
 * own backoff runs (see {@link RetryTransientOptions.respectRetryAfter}); the
 * wait is interruptible and capped by
 * {@link RetryTransientOptions.maxRetryAfter} so a hostile or absurd header
 * cannot park a fiber indefinitely.
 *
 * Dual: usable data-first (`SystemOne.retryTransient(program, options)`) or
 * data-last (`program.pipe(SystemOne.retryTransient(options))`).
 *
 * @since 0.1.0
 */
export const retryTransient: {
  (
    options?: RetryTransientOptions
  ): <A, E extends SystemOneError, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E extends SystemOneError, R>(
    self: Effect.Effect<A, E, R>,
    options?: RetryTransientOptions
  ): Effect.Effect<A, E, R>
} = Function.dual(
  (args) => Effect.isEffect(args[0]),
  <A, E extends SystemOneError, R>(
    self: Effect.Effect<A, E, R>,
    options?: RetryTransientOptions
  ): Effect.Effect<A, E, R> => {
    const respectRetryAfter = options?.respectRetryAfter ?? true
    const guarded = respectRetryAfter ? withRetryAfter(self, options?.maxRetryAfter ?? "60 seconds") : self
    return Effect.retry(guarded, {
      schedule: options?.schedule ?? Schedule.jittered(Schedule.exponential("500 millis")),
      times: options?.times ?? 3,
      while: (error: E) => isTransient(error)
    })
  }
)
