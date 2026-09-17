/**
 * Answers, and the mapping from a question set to its answer set.
 *
 * Every answer keeps the full distribution the model produced, not just the
 * winning label. That distribution is the reason to use a System One model over
 * an LLM with a JSON schema, so nothing here throws it away.
 *
 * @since 0.1.0
 */
import { Schema } from "effect"
import type * as Question from "./Question.js"

/**
 * The probability that the answer to a yes/no question is yes.
 *
 * There is deliberately no `confidence` field: the documented noul answer does
 * not carry one, and 0.5 means "evenly split", not "medium".
 *
 * @since 0.1.0
 */
export interface Noul {
  readonly type: "noul"
  readonly noul: number
}

/**
 * A selected option, the full distribution over options, and how concentrated
 * that distribution is.
 *
 * `confidence` is a statistic over the whole distribution, not the winning
 * option's probability — a two-way split at 0.5/0.5 and a flat spread across
 * ten options are both uncertain, but in different ways.
 *
 * @since 0.1.0
 */
export interface Choice<K extends string = string> {
  readonly type: "choice"
  readonly choice: K
  readonly probabilities: { readonly [P in K]: number }
  readonly confidence: number
}

/**
 * A weighted mean over level indices, the legend it was computed against, and
 * the distribution over levels.
 *
 * `score` is continuous: with levels `[a, b, c]` a score of 1.3 sits between
 * `b` and `c`, and rounding it to an integer discards the part that made the
 * model worth asking.
 *
 * @since 0.1.0
 */
export interface Score {
  readonly type: "score"
  readonly score: number
  /**
   * Maps each level number back to the criteria entry it came from, so a level
   * supplied as a rubric object comes back as that object.
   *
   * Typed as any JSON value rather than as `Question.Entry`: this package is
   * strict about what it sends and liberal about what it accepts, and failing
   * to decode a legend would be a poor reason to lose an otherwise good answer.
   */
  readonly legend: { readonly [level: string]: Question.Json }
  readonly probabilities: { readonly [level: string]: number }
  readonly confidence: number
}

/**
 * Any single answer.
 *
 * @since 0.1.0
 */
export type Any = Noul | Choice<string> | Score

/**
 * The answer type produced by one question type.
 *
 * @since 0.1.0
 */
export type AnswerFor<Q> = Q extends Question.Choice<infer K> ? Choice<K>
  : Q extends Question.Score<any> ? Score
  : Q extends Question.Noul ? Noul
  : never

/**
 * The answer map produced by a question map: same names, each one typed by the
 * question that asked it.
 *
 * @since 0.1.0
 */
export type AnswersFor<Q extends Question.Questions> = {
  readonly [Name in keyof Q]: AnswerFor<Q[Name]>
}

/**
 * Token counts reported by the service.
 *
 * @since 0.1.0
 */
export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

const NoulSchema = Schema.Struct({
  type: Schema.Literal("noul"),
  noul: Schema.Number
})

const ChoiceSchema = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.Record(Schema.String, Schema.Number),
  confidence: Schema.Number
})

const ScoreSchema = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  // Not `Record(String, String)`: the legend echoes the criteria entries, and a
  // level may have been supplied as an object or an array.
  legend: Schema.Record(Schema.String, Schema.Json),
  probabilities: Schema.Record(Schema.String, Schema.Number),
  confidence: Schema.Number
})

/**
 * Decoder for one answer of any type.
 *
 * @since 0.1.0
 */
export const AnswerSchema = Schema.Union([NoulSchema, ChoiceSchema, ScoreSchema])

/**
 * Decoder for the full `POST /v1/systemone` response body.
 *
 * Exported so fixtures and recorded responses can be validated by exactly the
 * decoder the live client uses.
 *
 * @since 0.1.0
 */
export const ResponseSchema = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, AnswerSchema),
  usage: Schema.Struct({
    input_tokens: Schema.Number,
    output_tokens: Schema.Number
  })
})

/**
 * The decoded wire response, before it is checked against the questions asked.
 *
 * @since 0.1.0
 */
export type DecodedResponse = typeof ResponseSchema.Type

/**
 * How many levels a score question offered, recovered from the legend.
 *
 * @since 0.1.0
 */
export const levelCount = (answer: Score): number => Object.keys(answer.legend).length

/**
 * The score rescaled to `0..1`.
 *
 * A raw `score` runs from 0 to `levelCount - 1`, which is not discoverable from
 * the number itself: `0.73` out of three is a low reading, and next to a
 * probability it looks like a high one. Anything that renders a score beside a
 * `noul` or a `confidence` wants this instead.
 *
 * @since 0.1.0
 */
export const normalized = (answer: Score): number => {
  const span = levelCount(answer) - 1
  return span <= 0 ? 0 : answer.score / span
}

/**
 * The level the score is closest to, with the criteria entry that defined it.
 *
 * Rounding a score discards the part worth having, so this is for labelling a
 * reading, never for deciding on one — compare the score itself against a
 * threshold.
 *
 * @since 0.1.0
 */
export const nearestLevel = (answer: Score): { readonly index: number; readonly entry: Question.Json } => {
  const index = Math.max(0, Math.min(levelCount(answer) - 1, Math.round(answer.score)))
  return { index, entry: answer.legend[String(index)] ?? null }
}
