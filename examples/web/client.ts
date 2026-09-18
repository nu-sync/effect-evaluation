/**
 * One `SystemOne` service for every demo the server hosts.
 *
 * Two layers cannot both provide the same service, so the offline path is a
 * single replay layer that asks each demo in turn whether it has a recording
 * for this state. Ids are disjoint, so the first one that answers wins.
 */
import { Effect, Layer } from "effect"
import { ResponseError, SystemOne, Testing } from "../../src/index.js"
import { isLive, respond as respondClassification } from "../classification/classification.js"
import { recorded as guardrailRecordings, recordedModel as guardrailModel } from "../guardrails/recorded.js"
import { respondWith } from "../guardrails/policy.js"

const respondGuardrails = respondWith(guardrailRecordings, guardrailModel)

const replayLayer = Testing.layer((request) => {
  const state = request.state as { readonly id?: unknown }
  const response = respondClassification(state) ?? respondGuardrails(state)
  if (response === undefined) {
    return Effect.fail(
      new ResponseError({
        reason:
          `no recorded response for ${JSON.stringify(state.id)} — set TYPESAFE_API_KEY to send new text to the model`
      })
    )
  }
  return response
})

/** The live client when a key is configured, replay otherwise. */
export const clientLayer = Layer.unwrap(
  Effect.map(isLive, (live) => live ? SystemOne.layerFetch() : replayLayer)
)

export { replayLayer }
