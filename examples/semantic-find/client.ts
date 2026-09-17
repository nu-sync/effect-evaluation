/**
 * Live/replay split, identical in shape to the other two demos: a blank
 * `TYPESAFE_API_KEY=` counts as absent, live otherwise, and a query with no
 * recording fails as a genuine `ResponseError` rather than inventing an
 * answer.
 */
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { ResponseError, SystemOne, Testing } from "../../src/index.js"
import type { Recording } from "./search.js"
import { respond } from "./search.js"

const configuredKey = (name: string) =>
  Effect.map(
    Config.option(Config.Redacted(name)),
    (key) => Option.isSome(key) && Redacted.value(key.value).trim().length > 0
  )

/** A present-but-blank env var counts as absent, so an untouched `.env` stays on replay. */
export const isLive = Effect.map(
  Effect.all([configuredKey("TYPESAFE_API_KEY"), configuredKey("TYPESAFE_AI_API_KEY")]),
  ([primary, secondary]) => primary || secondary
)

/** Replays recordings keyed by query id, decoded exactly as the live client would. */
export const offlineLayer = (recorded: { readonly [queryId: string]: Recording }) => {
  const handler = respond(recorded)
  return Testing.layer((request) => {
    const response = handler(request as { readonly state: unknown; readonly questions: typeof request.questions })
    if (response === undefined) {
      const state = request.state as { readonly queryId?: unknown }
      return Effect.fail(
        new ResponseError({
          reason: `no recorded response for ${JSON.stringify(state.queryId)} — set TYPESAFE_API_KEY to search live`
        })
      )
    }
    return response
  })
}

export const clientLayer = (recorded: { readonly [queryId: string]: Recording }) =>
  Layer.unwrap(
    Effect.map(isLive, (live) => live ? SystemOne.layerFetch() : offlineLayer(recorded))
  )
