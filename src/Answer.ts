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

/**
 * True when the answer came from a `noul` question.
 *
 * @since 0.1.0
 */
export const isNoul = (answer: Any): answer is Noul => answer.type === "noul"

/**
 * True when the answer came from a `choice` question.
 *
 * @since 0.1.0
 */
export const isChoice = (answer: Any): answer is Choice<string> => answer.type === "choice"

/**
 * True when the answer came from a `score` question.
 *
 * @since 0.1.0
 */
export const isScore = (answer: Any): answer is Score => answer.type === "score"

/**
 * True for the two answer types that carry a `confidence` statistic.
 *
 * `noul` deliberately has none — the single probability it carries *is* the
 * distribution, so there is nothing further to summarize. Expressing that as
 * a predicate, rather than leaving every caller to hand-write
 * `answer.type !== "noul"`, is what lets code walking a mixed
 * `Record<string, Any>` (e.g. `raw.answers`) ask the question directly instead
 * of re-deriving the asymmetry each time.
 *
 * @since 0.1.0
 */
export const hasConfidence = (answer: Any): answer is Choice<string> | Score => answer.type !== "noul"

/**
 * The probability the answer assigns to one specific option, whether or not it
 * won.
 *
 * @since 0.1.0
 */
export const probabilityOf = <K extends string>(answer: Choice<K>, option: K): number => answer.probabilities[option]

/**
 * Every option and its probability, most likely first.
 *
 * `Array.prototype.sort` is stable, so two options tied on probability keep
 * whatever order they were enumerated in rather than an order that happens to
 * depend on the sort implementation — callers get the same ranking every time
 * for the same response.
 *
 * @since 0.1.0
 */
export const ranked = <K extends string>(answer: Choice<K>): ReadonlyArray<readonly [K, number]> =>
  (Object.entries(answer.probabilities) as Array<[K, number]>).sort(([, a], [, b]) => b - a)

/**
 * The probability attached to the winning option — `probabilities[choice]` —
 * as distinct from `confidence`.
 *
 * `confidence` is a statistic over the *whole* distribution (how concentrated
 * it is); this is only the number attached to the option that happened to
 * win. They diverge in practice: docs/classification_using_confidence.md
 * gates on `confidence` specifically because the winning probability alone
 * can't tell a runner-up dominated by one close second from one where the
 * remaining mass is spread across many near-ties, while
 * docs/consistency_choice_cookbook.md gates on the winning probability
 * (at 0.60) precisely because that recipe wants this reading, not
 * `confidence`. Use whichever one the decision in front of you actually
 * depends on.
 *
 * @since 0.1.0
 */
export const topProbability = <K extends string>(answer: Choice<K>): number => answer.probabilities[answer.choice]

/**
 * The `n` most likely options, most likely first.
 *
 * `n` is clamped to the number of options actually offered, and `n <= 0`
 * returns an empty list. This is the building block for beam search over a
 * taxonomy — docs/hierarchical_classification.md keeps the best `K` candidate
 * paths at each level rather than only the strongest one — and for
 * shortlisting before a second, more expensive pass, as
 * docs/skill_suggestion.md does when it ranks a large roster and then
 * re-evaluates only the top few with fuller descriptions.
 *
 * @since 0.1.0
 */
export const top = <K extends string>(answer: Choice<K>, n: number): ReadonlyArray<readonly [K, number]> =>
  ranked(answer).slice(0, Math.max(0, n))

/**
 * The standard deviation of the level-index distribution, weighted by
 * `probabilities` — the dispersion around the mean that `score` already is.
 *
 * `score` is each level index times its probability, summed: a weighted mean.
 * `spread` answers the question that mean can't: how much of the distribution
 * actually sits near it. docs/autoresearch_feature_discovery.md trains on
 * mean and spread as a pair of features precisely because the mean alone
 * conflates two different situations, and docs/primitives.md names the one
 * that matters most in practice — a distribution spread thin across levels
 * lands the mean near the middle of the scale, which crosses a threshold
 * exactly like a genuine mid-scale reading while carrying almost no
 * information. A low `spread` next to a boundary-hugging `score` is a real
 * reading; a high `spread` next to the same `score` is closer to a shrug.
 *
 * Only keys of `probabilities` that also appear in `legend` count as level
 * indices — the wire shape does not promise the two sets match, so a stray
 * key in one but not the other is excluded rather than silently pulled in.
 * A distribution over zero or one level has no dispersion to report, so this
 * returns `0` for both, and it also returns `0` if none of the legend's keys
 * have a matching entry in `probabilities`.
 *
 * @since 0.1.0
 */
export const spread = (answer: Score): number => {
  const levels = Object.keys(answer.legend)
  if (levels.length <= 1) return 0
  let weight = 0
  let variance = 0
  for (const level of levels) {
    const p = answer.probabilities[level]
    if (p === undefined) continue
    weight += p
    variance += p * (Number(level) - answer.score) ** 2
  }
  return weight > 0 ? Math.sqrt(variance / weight) : 0
}
