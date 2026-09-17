/**
 * Questions are data.
 *
 * A System One request carries a `state` and a map of named questions. Each
 * question type has a different answer shape, so the question types here carry
 * enough type information for {@link Answer.AnswersFor} to recover the exact
 * answer for each name.
 *
 * @since 0.1.0
 */

/**
 * Any JSON value. `state` and `instructions` both accept structured JSON, not
 * just text.
 *
 * @since 0.1.0
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json }

/**
 * The one shape every instruction and every criterion accepts: prose, a list, a
 * structured object with your own fields, or `null`.
 *
 * The API calls this an entry type, and it is the reason a rubric can be
 * expressed as data — `{ what, not_for, examples }` for a choice option,
 * `{ summary, signals }` for a score level, `{ what, examples }` for either
 * side of a noul — rather than crammed into a sentence.
 *
 * @since 0.1.0
 */
export type Entry = string | null | ReadonlyArray<Json> | { readonly [key: string]: Json }

/**
 * What a question asks.
 *
 * @since 0.1.0
 */
export type Instructions = Entry

/**
 * How one choice option is described. `null` lets the option key speak for
 * itself.
 *
 * @since 0.1.0
 */
export type Criterion = Entry

/**
 * A yes/no question. The answer is the probability that the answer is yes.
 *
 * @since 0.1.0
 */
export interface Noul {
  readonly type: "noul"
  readonly instructions: Instructions
  readonly criteria?: {
    readonly true?: Entry
    readonly false?: Entry
  }
}

/**
 * A selection from named options. `K` is the union of option keys, which is
 * what makes the answer's `choice` field a literal union rather than `string`.
 *
 * @since 0.1.0
 */
export interface Choice<K extends string = string> {
  readonly type: "choice"
  readonly instructions: Instructions
  readonly criteria: { readonly [P in K]: Criterion }
}

/**
 * An ordinal judgment over 2-10 ordered levels. The answer is a weighted mean
 * over level indices, so it lands between levels rather than on one.
 *
 * @since 0.1.0
 */
export interface Score<L extends ReadonlyArray<Entry> = ReadonlyArray<Entry>> {
  readonly type: "score"
  readonly instructions: Instructions
  readonly criteria: L
}

/**
 * Any single question.
 *
 * @since 0.1.0
 */
export type Any = Noul | Choice<any> | Score<any>

/**
 * A named set of questions asked against one shared state in one request.
 *
 * @since 0.1.0
 */
export type Questions = { readonly [name: string]: Any }

/**
 * Asks for the probability that a statement about the state is true.
 *
 * Note that a noul answer carries no `confidence` field — the number *is* the
 * distribution. Confidence-gated routing applies to {@link choice} and
 * {@link score} only.
 *
 * @example
 * ```ts
 * import { Question } from "effect-systemone"
 *
 * const urgent = Question.noul({
 *   instructions: "Does this message express urgency?"
 * })
 * ```
 *
 * @since 0.1.0
 */
export const noul = (options: {
  readonly instructions: Instructions
  readonly criteria?: { readonly true?: Entry; readonly false?: Entry }
}): Noul => (options.criteria === undefined
  ? { type: "noul", instructions: options.instructions }
  : { type: "noul", instructions: options.instructions, criteria: options.criteria })

/**
 * Asks the model to select one of the named options. Option keys are inferred,
 * so the answer's `choice` and `probabilities` are keyed by exactly the options
 * you passed.
 *
 * @example
 * ```ts
 * import { Question } from "effect-systemone"
 *
 * const department = Question.choice({
 *   instructions: "Which team should handle this?",
 *   criteria: {
 *     billing: "Payment or subscription issues",
 *     technical: "Bugs or integration problems"
 *   }
 * })
 * // answer.choice is "billing" | "technical"
 * ```
 *
 * @since 0.1.0
 */
export const choice = <const C extends { readonly [key: string]: Criterion }>(options: {
  readonly instructions: Instructions
  readonly criteria: C
}): Choice<Extract<keyof C, string>> => ({
  type: "choice",
  instructions: options.instructions,
  criteria: options.criteria as { readonly [P in Extract<keyof C, string>]: Criterion }
})

/**
 * Asks for an ordinal judgment across ordered levels, lowest first.
 *
 * @example
 * ```ts
 * import { Question } from "effect-systemone"
 *
 * const severity = Question.score({
 *   instructions: "How severe is the reported issue?",
 *   criteria: [
 *     "Cosmetic; no impact to functionality",
 *     // A level can be a rubric rather than a sentence.
 *     {
 *       what: "Broken or degraded feature, but workaround exists",
 *       examples: ["export fails in one browser but works in another"]
 *     },
 *     "Blocking issue; no workaround exists"
 *   ]
 * })
 * ```
 *
 * @since 0.1.0
 */
export const score = <const L extends readonly [Entry, Entry, ...Array<Entry>]>(options: {
  readonly instructions: Instructions
  readonly criteria: L
}): Score<L> => ({
  type: "score",
  instructions: options.instructions,
  criteria: options.criteria
})

/**
 * The documented bounds on a score question's level count.
 *
 * @since 0.1.0
 */
export const scoreLevelBounds = { min: 2, max: 10 } as const

/**
 * The documented bounds on a choice question's option count. The API documents
 * a 255-option ceiling; a document with more candidates than that is expected
 * to go through a windowing pass first rather than being offered as one choice
 * (see the semantic-find cookbook).
 *
 * @since 0.1.0
 */
export const choiceOptionBounds = { min: 2, max: 255 } as const

/**
 * Checks a question set against the constraints the API documents, so an
 * obviously invalid request fails locally instead of costing a round trip.
 *
 * Returns the reason a request would be rejected, or `undefined` if it looks
 * well formed. This is a pre-flight check, not a guarantee: the service remains
 * the authority.
 *
 * @since 0.1.0
 */
export const validate = (questions: Questions): string | undefined => {
  const names = Object.keys(questions)
  if (names.length === 0) {
    return "questions must contain at least one question"
  }
  for (const name of names) {
    const question = questions[name]!
    switch (question.type) {
      case "choice": {
        const options = Object.keys(question.criteria)
        if (options.length < choiceOptionBounds.min) {
          return `question ${JSON.stringify(name)} is a choice with ${options.length} option(s); at least ${choiceOptionBounds.min} are required`
        }
        if (options.length > choiceOptionBounds.max) {
          return `question ${JSON.stringify(name)} is a choice with ${options.length} option(s); at most ${choiceOptionBounds.max} are supported`
        }
        break
      }
      case "score": {
        const levels = question.criteria as ReadonlyArray<Entry>
        if (levels.length < scoreLevelBounds.min || levels.length > scoreLevelBounds.max) {
          return `question ${JSON.stringify(name)} is a score with ${levels.length} level(s); ${scoreLevelBounds.min}-${scoreLevelBounds.max} are supported`
        }
        break
      }
      case "noul":
        break
    }
  }
  return undefined
}
