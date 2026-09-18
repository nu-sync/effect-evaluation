/**
 * The classification-by-confidence policy, shared by the CLI example and the
 * web server so both run exactly the same code.
 *
 * The split that matters is between the *call* and the *policy*. One request
 * produces a distribution; the threshold is applied locally afterwards. That is
 * why the web UI can re-derive every label as you drag the slider without
 * spending another token.
 */
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { Question, ResponseError, SystemOne, Testing } from "../../src/index.js"
import { divisionName, divisionOf, type GroupCode, groupCodes, groupName } from "../data/sic.js"
import { recorded, recordedModel } from "./recorded.js"

/** Report the narrow group at or above this confidence, the division below it. */
export const defaultThreshold = 0.9

const criteria = Object.fromEntries(
  groupCodes.map((code) => [code, groupName(code)])
) as { readonly [Code in GroupCode]: string }

export const industry = Question.choice({
  instructions:
    "Which broad industry does this company operate in? Judge the company's own operations as this filing describes them.",
  criteria
})

/**
 * What one request tells us, before any policy is applied.
 */
export interface Reading {
  readonly group: GroupCode
  readonly confidence: number
  readonly probabilities: { readonly [Code in GroupCode]: number }
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }
  readonly model: string
}

/**
 * The label to report, given a reading and a threshold. Pure: no request, no
 * clock, no randomness — drag the threshold and this is all that re-runs.
 */
export interface Decision {
  readonly level: "group" | "division"
  readonly label: string
  readonly code: string
}

export const decide = (reading: Reading, threshold: number): Decision =>
  reading.confidence >= threshold
    ? { level: "group", label: groupName(reading.group), code: reading.group }
    : { level: "division", label: divisionName(reading.group), code: divisionOf(reading.group) }

/** Whether a decision matched the label a human reader assigned. */
export const isCorrect = (reading: Reading, decision: Decision, expected: GroupCode): boolean =>
  decision.level === "group" ? reading.group === expected : divisionOf(reading.group) === divisionOf(expected)

/**
 * One request: every SIC group offered as options, one state, one answer.
 */
export const read = (
  state: { readonly id: string; readonly business: string }
): Effect.Effect<Reading, SystemOne.SystemOneError, SystemOne.SystemOne> =>
  Effect.map(
    SystemOne.evaluate({ state, questions: { industry } }),
    (result): Reading => ({
      group: result.answers.industry.choice,
      confidence: result.answers.industry.confidence,
      probabilities: result.answers.industry.probabilities,
      usage: result.usage,
      model: result.model
    })
  )

/**
 * Builds the recorded answer for one filing id, or `undefined` if this demo has
 * nothing recorded for it.
 *
 * Separated from the layer so a server hosting more than one demo can put a
 * single `SystemOne` service in front of all of them — two layers cannot both
 * provide the same service.
 */
export const respond = (state: { readonly id?: unknown }): unknown | undefined => {
  const fixture = typeof state.id === "string" ? recorded[state.id] : undefined
  if (fixture === undefined) return undefined
  // The live API returns a probability for every group offered; `record.ts`
  // omits the zero-weight ones to keep the recording readable. Reconcile now
  // checks that a choice answer's `probabilities` covers every offered
  // option, so the omitted zeros have to be put back before this fixture can
  // stand in for a real response.
  const probabilities = Object.fromEntries(
    groupCodes.map((code) => [code, fixture.probabilities[code] ?? 0])
  ) as { readonly [Code in GroupCode]: number }
  return Testing.response({
    model: recordedModel,
    answers: {
      industry: Testing.choiceAnswer(probabilities, fixture.confidence)
    },
    usage: { inputTokens: 1438, outputTokens: 12 }
  })
}

/**
 * Replays recordings keyed by filing id. Text with no recording fails as a
 * typed `ResponseError` rather than inventing an answer — which is also what
 * the UI shows you when you edit a filing while offline.
 */
export const offlineLayer = Testing.layer((request) => {
  const state = request.state as { readonly id?: unknown }
  const response = respond(state)
  if (response === undefined) {
    return Effect.fail(
      new ResponseError({
        reason: `no recorded response for ${JSON.stringify(state.id)} — set TYPESAFE_API_KEY to classify new text`
      })
    )
  }
  return response
})

const configuredKey = (name: string) =>
  Effect.map(
    Config.option(Config.Redacted(name)),
    (key) => Option.isSome(key) && Redacted.value(key.value).trim().length > 0
  )

/**
 * Whether a live API key is configured.
 *
 * A present-but-blank variable counts as absent. A checked-in `.env` with
 * `TYPESAFE_API_KEY=` should mean "no key", not "go live with an empty bearer
 * token and collect a 401".
 */
export const isLive = Effect.map(
  Effect.all([configuredKey("TYPESAFE_API_KEY"), configuredKey("TYPESAFE_AI_API_KEY")]),
  ([primary, secondary]) => primary || secondary
)

/** The live client when a key is configured, fixtures otherwise. */
export const clientLayer = Layer.unwrap(
  Effect.map(isLive, (live) => live ? SystemOne.layerFetch() : offlineLayer)
)
