/**
 * The two hierarchical strategies, plus the flat baseline reused as-is.
 *
 * **Greedy** takes the top child at each level. **Beam search** keeps the best
 * `K` paths (default 3), batching the retained paths' questions into one
 * request per level rather than one request per path — the same "batch
 * questions that share state" point docs/parallel_questions.md makes, applied
 * to a set of candidate paths instead of a set of unrelated questions.
 *
 * Both strategies are computed from the *same two requests* per filing: one
 * root request (division) and one batched second-level request (the group
 * question for however many divisions the beam retained). Greedy's path is
 * always one of the candidates that batch already contains — the group
 * question for the single top division is one of the `K` questions asked
 * regardless of which strategy is reading the result — so running greedy
 * "separately" would just repeat a request beam search already made. Reusing
 * the same response is not a shortcut on the algorithm; it is the batching
 * this cookbook is about, applied one level further.
 *
 * The flat baseline (`examples/classification.ts`'s single 60-option Choice)
 * costs nothing here: it is decoded from the recordings `examples/record.ts`
 * already made for the other demo, through the same production decoder,
 * with no request of its own.
 */
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { Answer, ResponseError, SystemOne, Testing } from "../../src/index.js"
import { industry, respond as flatRespond } from "../classification.js"
import type { Filing } from "../filings.js"
import { divisionOf, type DivisionCode, divisions, type GroupCode, groupCodes, groupName } from "../sic.js"
import { recorded, recordedModel } from "./recorded.js"
import {
  type CandidatePath,
  codesByDivision,
  divisionQuestion,
  type Edge,
  groupQuestionFor,
  pathScore
} from "./tree.js"

/** Keeps the best this many paths at each level. */
export const defaultBeamWidth = 3

/** The question name a level-2 batched request uses for one division. */
export const groupQuestionName = (division: DivisionCode) => `group_${division}`

/**
 * Every candidate leaf considered for one filing, plus what each of the two
 * requests actually cost — this is the shared evidence greedy and beam both
 * read, computed once.
 */
export interface FilingReading {
  readonly filing: Filing
  readonly model: string
  /** Every offered division and its probability, most likely first. */
  readonly divisions: ReadonlyArray<readonly [DivisionCode, number]>
  /** Every candidate path considered — one division × every one of its groups, for each retained division. */
  readonly candidates: ReadonlyArray<CandidatePath>
  readonly usage: { readonly totalTokens: number }
}

/**
 * The flat baseline: one 60-option `Choice`, decoded from the recording
 * `examples/record.ts` already made. No request — `SystemOne.decode` is the
 * same pure decoder the live client uses, just handed a stored body instead of
 * one fetched over HTTP.
 */
export const flatReading = (filing: Filing): Effect.Effect<Answer.Choice<GroupCode>, ResponseError> =>
  Effect.gen(function*() {
    const json = flatRespond({ id: filing.id })
    if (json === undefined) {
      return yield* Effect.fail(
        new ResponseError({ reason: `no flat recording for ${JSON.stringify(filing.id)}` })
      )
    }
    const evaluation = yield* SystemOne.decode({ industry }, json)
    return evaluation.answers.industry as Answer.Choice<GroupCode>
  })

/**
 * The two requests themselves, undecided: the root division answer, the
 * batched level-2 group answers for whichever divisions the root retained,
 * and which divisions those were. `record.ts` reads this directly (it needs
 * each division's raw `confidence`, which a flattened {@link CandidatePath}
 * doesn't carry); {@link readFiling} reduces it into candidate paths for the
 * CLI.
 */
export interface RawReading {
  readonly root: SystemOne.Evaluation<{ readonly division: typeof divisionQuestion }>
  readonly level2: SystemOne.Evaluation<{ readonly [name: string]: ReturnType<typeof groupQuestionFor> }>
  readonly topDivisions: ReadonlyArray<readonly [DivisionCode, number]>
}

/**
 * Makes the two requests: one root request, then one batched level-2 request
 * carrying a group question for every division the root retained. This is the
 * only place either request is actually made — {@link readFiling} and
 * `record.ts` both read their answer through this.
 */
export const readRaw = (
  filing: Filing,
  beamWidth = defaultBeamWidth
): Effect.Effect<RawReading, SystemOne.SystemOneError, SystemOne.SystemOne> =>
  Effect.gen(function*() {
    const state = { id: filing.id, business: filing.text }

    const root = yield* SystemOne.evaluate({ state, questions: { division: divisionQuestion } })
    const topDivisions = Answer.top(root.answers.division, beamWidth)

    const groupQuestions = Object.fromEntries(
      topDivisions.map(([division]) => [groupQuestionName(division), groupQuestionFor(division)])
    )
    const level2 = yield* SystemOne.evaluate({ state, questions: groupQuestions })

    return { root, level2, topDivisions }
  })

/**
 * Runs the two hierarchical requests for one filing and returns every
 * candidate path they produced. Greedy and beam search are both read off of
 * this — see the module doc for why one pair of requests serves both.
 */
export const readFiling = (
  filing: Filing,
  beamWidth = defaultBeamWidth
): Effect.Effect<FilingReading, SystemOne.SystemOneError, SystemOne.SystemOne> =>
  Effect.map(readRaw(filing, beamWidth), ({ level2, root, topDivisions }) => {
    const candidates: Array<CandidatePath> = []
    for (const [divisionCode, divisionProbability] of topDivisions) {
      const groupAnswer = level2.answers[groupQuestionName(divisionCode)]!
      for (const [groupCode, groupProbability] of Answer.ranked(groupAnswer)) {
        const edges: readonly [Edge, Edge] = [
          { level: "division", code: divisionCode, label: divisions[divisionCode], probability: divisionProbability },
          { level: "group", code: groupCode, label: groupName(groupCode as GroupCode), probability: groupProbability }
        ]
        candidates.push({
          divisionCode,
          groupCode: groupCode as GroupCode,
          edges,
          score: pathScore(edges)
        })
      }
    }

    return {
      filing,
      model: root.model,
      divisions: topDivisions,
      candidates,
      usage: { totalTokens: root.usage.totalTokens + level2.usage.totalTokens }
    }
  })

/**
 * Greedy: the single path formed by taking the top child at every level. It is
 * always present among `reading.candidates` because the top division's group
 * question is always one of the ones the batched level-2 request asked for
 * (beam width is never 0), so this is a pure lookup, not a further decision.
 */
export const greedyPath = (reading: FilingReading): CandidatePath => {
  const topDivision = reading.divisions[0]![0]
  const topGroupCandidates = reading.candidates.filter((c) => c.divisionCode === topDivision)
  // Highest edge probability within this division only — "the top child at
  // this level" — not the highest path score, which is what beam search reads
  // instead.
  return topGroupCandidates.reduce((best, c) => (c.edges[1].probability > best.edges[1].probability ? c : best))
}

/**
 * Beam search: the `K` candidates with the highest length-normalized path
 * score, most likely first. Because every retained division's groups were
 * asked about, this considers paths through *every* retained division, not
 * only the single strongest one — which is the whole reason beam search can
 * recover from a root guess that turns out, once the next level is in hand,
 * not to have been the best one.
 */
export const beamPaths = (
  reading: FilingReading,
  beamWidth = defaultBeamWidth
): ReadonlyArray<CandidatePath> => [...reading.candidates].sort((a, b) => b.score - a.score).slice(0, beamWidth)

/**
 * Builds the recorded response for one of the two hierarchical requests, or
 * `undefined` if this demo has nothing recorded for it.
 *
 * Dispatches on which question names the request actually carries: a request
 * asking only `division` is the root request; a request whose every question
 * name starts with `group_` is a batched level-2 request, one entry per
 * retained division. Zero-fills `probabilities` the same way
 * `examples/classification.ts`'s `respond` does, over exactly the option set
 * the corresponding question offers — an omitted zero for an option outside
 * that division would fail `reconcile`'s coverage check for a different
 * reason than the one this fixture is standing in for.
 */
export const respond = (state: { readonly id?: unknown }, questionNames: ReadonlyArray<string>): unknown | undefined => {
  const fixture = typeof state.id === "string" ? recorded[state.id] : undefined
  if (fixture === undefined) return undefined

  if (questionNames.length === 1 && questionNames[0] === "division") {
    const divisionCodes = Object.keys(codesByDivision) as ReadonlyArray<DivisionCode>
    const probabilities: Record<string, number> = {}
    for (const code of divisionCodes) probabilities[code] = fixture.division.probabilities[code] ?? 0
    // `fixture.groups` is keyed by exactly the divisions the *live* run's own
    // beam search retained, in that order — the ground truth for which
    // division ranked 2nd or 3rd. A flat zero-fill can't recover that on its
    // own: `record.ts` only keeps nonzero division probabilities, so a
    // concentrated live answer (one division at ~1, the rest genuinely ~0)
    // leaves every runner-up tied at exactly 0 here, and the live wire's own
    // key order for those ties isn't alphabetical — it reflects whatever
    // order the model returned, which this recording doesn't otherwise
    // preserve. Nudging just the recorded runner-ups off zero, ranked by the
    // order they appear in `groups`, makes `Answer.top` retain the same
    // divisions here that produced this fixture's `groups` entries, instead
    // of an arbitrary alphabetically-first zero-tie that has no recording to
    // answer its group question.
    const retained = Object.keys(fixture.groups) as ReadonlyArray<DivisionCode>
    retained.forEach((code, index) => {
      if (probabilities[code] === 0) probabilities[code] = Number.EPSILON * (retained.length - index)
    })
    return Testing.response({
      model: recordedModel,
      answers: {
        division: Testing.choiceAnswer(
          probabilities as { readonly [Code in DivisionCode]: number },
          fixture.division.confidence
        )
      },
      usage: fixture.usage.root
    })
  }

  if (questionNames.every((name) => name.startsWith("group_"))) {
    const answers: Record<string, Answer.Any> = {}
    for (const name of questionNames) {
      const division = name.slice("group_".length) as DivisionCode
      const group = fixture.groups[division]
      if (group === undefined) return undefined
      const codes = codesByDivision[division]
      const probabilities = Object.fromEntries(
        codes.map((code) => [code, group.probabilities[code] ?? 0])
      ) as { readonly [Code in GroupCode]: number }
      answers[name] = Testing.choiceAnswer(probabilities, group.confidence)
    }
    return Testing.response({ model: recordedModel, answers, usage: fixture.usage.level2 })
  }

  return undefined
}

/**
 * Replays the recorded root and level-2 responses, keyed by filing id and
 * dispatched by which questions a request carries. A filing with no recording
 * fails as a genuine `ResponseError`, never an invented one — matching
 * `examples/classification.ts`'s `offlineLayer`.
 */
export const offlineLayer = Testing.layer((request) => {
  const state = request.state as { readonly id?: unknown }
  const response = respond(state, Object.keys(request.questions))
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

/** A present-but-blank `TYPESAFE_API_KEY=` counts as absent, not as a live key. */
export const isLive = Effect.map(
  Effect.all([configuredKey("TYPESAFE_API_KEY"), configuredKey("TYPESAFE_AI_API_KEY")]),
  ([primary, secondary]) => primary || secondary
)

/** The live client when a key is configured, fixtures otherwise. */
export const clientLayer = Layer.unwrap(
  Effect.map(isLive, (live) => live ? SystemOne.layerFetch() : offlineLayer)
)

// Re-exported so callers of this module don't also need to import from
// `../sic.js` just to print a code's human name.
export { divisionOf, groupCodes }
