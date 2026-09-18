/**
 * An Effect HTTP server hosting both demos.
 *
 * Two things here are deliberate and shared by both pages.
 *
 * The server returns *measurements* — distributions, probabilities, confidence
 * — and never a decision. Classification's threshold and the guardrail policy
 * are both applied in the browser, which is what makes their sliders free:
 * move one and everything re-decides with no request and no spend.
 *
 * And the batch endpoints are server-sent event streams rather than single
 * responses, so the middle of a run is visible: what is in flight, when each
 * case lands, what it cost. Bounded concurrency is observable rather than
 * merely configured.
 *
 *   just web          → classification
 *   just guardrails   → guardrails
 */
import { Effect, Layer, Ref, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { SystemOne } from "../../src/index.js"
import { defaultThreshold, isLive, read } from "../classification/classification.js"
import { recordedModel } from "../classification/recorded.js"
import { filings } from "../data/filings.js"
import { divisions, groups } from "../data/sic.js"
import { messages } from "../guardrails/messages.js"
import { questions as guardrailQuestions, screen } from "../guardrails/policy.js"
import { recordedModel as guardrailModel } from "../guardrails/recorded.js"
import { policies } from "../guardrails/route.js"
import { clientLayer } from "./client.js"

/** How many requests are allowed in flight at once. Visible in both UIs. */
const CONCURRENCY = 4

const here = import.meta.dir

const bundle = async (entry: string) => {
  const built = await Bun.build({
    entrypoints: [`${here}/${entry}`],
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("development") }
  })
  if (!built.success) {
    for (const log of built.logs) console.error(log)
    throw new Error(`failed to build ${entry}`)
  }
  return built.outputs[0]!.text()
}

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

/**
 * Builds an SSE route that narrates a batch: `queued`, then `requesting` and
 * `answered` per item with the live in-flight count, then `done`.
 *
 * The events are produced by the stream itself rather than by a forked fiber,
 * so the work is tied to the response body's lifetime — if the browser
 * disconnects, the outstanding requests are interrupted with it.
 */
const narrate = <A extends { readonly id: string }, R>(
  path: `/${string}`,
  items: ReadonlyArray<A>,
  run: (item: A) => Effect.Effect<R & { usage: { totalTokens: number } }, SystemOne.SystemOneError, SystemOne.SystemOne>
) =>
  HttpRouter.add(
    "GET",
    path,
    Effect.gen(function*() {
      const service = yield* SystemOne.SystemOne

      const body = Stream.unwrap(Effect.gen(function*() {
        const inFlight = yield* Ref.make(0)
        const tokens = yield* Ref.make(0)
        const startedAt = Date.now()

        const one = (item: A) =>
          Stream.concat(
            // Emitted when this item actually starts, which is what makes the
            // concurrency limit observable rather than theoretical.
            Stream.fromEffect(
              Effect.map(
                Ref.updateAndGet(inFlight, (n) => n + 1),
                (n) => frame({ type: "requesting", id: item.id, inFlight: n })
              )
            ),
            Stream.fromEffect(Effect.gen(function*() {
              const began = Date.now()
              const outcome = yield* Effect.provideService(run(item), SystemOne.SystemOne, service).pipe(
                Effect.matchEffect({
                  onSuccess: (reading) =>
                    Effect.as(
                      Ref.update(tokens, (total) => total + reading.usage.totalTokens),
                      { type: "answered" as const, reading: { ...reading, elapsedMillis: Date.now() - began } }
                    ),
                  onFailure: (error) =>
                    Effect.succeed({
                      type: "failed" as const,
                      error: { tag: error._tag, message: error.message }
                    })
                })
              )
              const left = yield* Ref.updateAndGet(inFlight, (n) => n - 1)
              return frame({ ...outcome, id: item.id, inFlight: left })
            }))
          )

        return Stream.concat(
          Stream.make(frame({ type: "queued", ids: items.map((i) => i.id), concurrency: CONCURRENCY })),
          Stream.concat(
            Stream.flatMap(Stream.fromIterable(items), one, { concurrency: CONCURRENCY }),
            Stream.fromEffect(
              Effect.map(Ref.get(tokens), (total) =>
                frame({ type: "done", totalTokens: total, elapsedMillis: Date.now() - startedAt }))
            )
          )
        )
      }))

      return HttpServerResponse.stream(Stream.encodeText(body), {
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache", "x-accel-buffering": "no" }
      })
    })
  )

/**
 * A provider failure is part of what these demos show — sending text with no
 * recording while offline produces a real `ResponseError` — so failures come
 * back as data with their tag intact rather than as an opaque 500.
 */
const classifyRoute = HttpRouter.add(
  "POST",
  "/api/classify",
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const body = yield* Effect.orElseSucceed(request.json, () => null)
    const { business, id } = (body ?? {}) as { readonly id?: string; readonly business?: string }
    if (typeof id !== "string" || typeof business !== "string") {
      return HttpServerResponse.jsonUnsafe(
        { ok: false, error: { tag: "BadRequest", message: "expected { id, business }" } },
        { status: 400 }
      )
    }
    const started = Date.now()
    return yield* read({ id, business }).pipe(
      Effect.map((reading) =>
        HttpServerResponse.jsonUnsafe({
          ok: true,
          id,
          reading: { ...reading, elapsedMillis: Date.now() - started }
        })
      ),
      Effect.catch((error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe({ ok: false, id, error: { tag: error._tag, message: error.message } })
        )
      )
    )
  })
)

/**
 * Builds the `fetch` handler.
 *
 * Exported so tests can drive the whole app — routes, streams, bundles and
 * browser code — without opening a port. `client` lets a caller pin the backing
 * layer and the mode it reports, so a test does not silently change behaviour
 * depending on whether the machine running it happens to have an API key.
 */
export const makeHandler = async (options?: {
  readonly disableLogger?: boolean
  readonly client?: {
    readonly layer: Layer.Layer<SystemOne.SystemOne>
    readonly mode: "live" | "replay"
  }
}) => {
  const [styles, classificationShell, guardrailShell, classificationApp, guardrailApp] = await Promise.all([
    Bun.file(`${here}/styles.css`).text(),
    Bun.file(`${here}/index.html`).text(),
    Bun.file(`${here}/guardrails.html`).text(),
    bundle("app.tsx"),
    bundle("guardrails.tsx")
  ])
  const mode = options?.client?.mode ?? ((await Effect.runPromise(isLive)) ? "live" : "replay")
  const script = (source: string) =>
    HttpServerResponse.text(source, { contentType: "application/javascript" })

  const routes = Layer.mergeAll(
    HttpRouter.add("GET", "/", HttpServerResponse.html(classificationShell)),
    HttpRouter.add("GET", "/guardrails", HttpServerResponse.html(guardrailShell)),
    HttpRouter.add("GET", "/styles.css", HttpServerResponse.text(styles, { contentType: "text/css" })),
    HttpRouter.add("GET", "/app.js", script(classificationApp)),
    HttpRouter.add("GET", "/guardrails.js", script(guardrailApp)),
    HttpRouter.add(
      "GET",
      "/api/setup",
      HttpServerResponse.jsonUnsafe({
        mode,
        recordedModel,
        concurrency: CONCURRENCY,
        defaultThreshold,
        filings,
        groups,
        divisions
      })
    ),
    HttpRouter.add(
      "GET",
      "/api/guardrails/setup",
      HttpServerResponse.jsonUnsafe({
        mode,
        recordedModel: guardrailModel,
        concurrency: CONCURRENCY,
        messages,
        policies,
        // The severity ladder, so the page can name a level and scale the bar
        // rather than printing a 0-3 score beside a set of probabilities.
        severityLevels: guardrailQuestions.severity.criteria
      })
    ),
    classifyRoute,
    narrate("/api/stream", filings, (filing) => read({ id: filing.id, business: filing.text })),
    narrate("/api/guardrails/stream", messages, screen)
  )

  return HttpRouter.toWebHandler(Layer.provideMerge(routes, options?.client?.layer ?? clientLayer), {
    disableLogger: options?.disableLogger ?? false
  }).handler
}

if (import.meta.main) {
  const handler = await makeHandler()
  const port = Number(process.env.PORT ?? 3000)
  Bun.serve({ port, fetch: (request) => handler(request), idleTimeout: 120 })
  const live = await Effect.runPromise(isLive)
  console.log(`
  ${live ? "live API" : `replaying ${recordedModel}`}

  classification   http://localhost:${port}/
  guardrails       http://localhost:${port}/guardrails
`)
}
