/**
 * Line-by-line semantic search over `SPEC.md`, replicating TypeSafe's
 * cookbook: rank candidate lines against a query with a `Choice`, and ask a
 * companion `Noul` in the same request about whether the document answers the
 * query at all. `Choice.probabilities` sums to 1, so some line always wins —
 * the companion question is the only thing that can say "nothing here".
 *
 * `SPEC.md` has more candidate lines (`corpus.clauses.length`, currently 282)
 * than the API's 255-option `Choice` ceiling
 * (`Question.choiceOptionBounds.max`) allows in one request, so a naive
 * "offer every line" request is invalid before it is sent — see
 * `wholeDocumentCapMessage` below. The documented workaround, also
 * implemented here: a first pass offers `##`-level sections as coarse
 * `Choice` options (`windows` in `corpus.ts`, always far under the cap), and
 * only the retained section's lines go into the second, fine-grained request.
 *
 * The split that matters, same as the other examples: `search` is the
 * measurement (two requests, nothing else), and `classify` is a pure,
 * zero-cost policy applied to its result.
 */
import { Effect } from "effect"
import { Answer, Question, SystemOne, Testing } from "../../src/index.js"
import { type Clause, clauses, windowById, windows } from "./corpus.js"

/**
 * The `Choice` question a naive implementation would send: every line in the
 * document as one option set. Built so `Question.validate` can report exactly
 * why it is rejected — this is the lesson the 255-option cap exists to
 * surface, not a hypothetical.
 */
const wholeDocumentChoice = Question.choice({
  instructions: "Which line of the document is most relevant to the query?",
  criteria: Object.fromEntries(clauses.map((c) => [c.id, c.text]))
})

/**
 * `undefined` if a single request over every line in the document would pass
 * pre-flight validation, or the reason it would not.
 */
export const wholeDocumentCapMessage: string | undefined = Question.validate({ line: wholeDocumentChoice })

/** The coarse first-pass question: which section is most likely to hold the answer. */
const windowQuestion = (query: string) =>
  Question.choice({
    instructions: {
      what: "Which section of this specification document is most likely to state or imply the answer to the query? Pick the single best section even if none is a strong match.",
      query
    },
    criteria: Object.fromEntries(windows.map((w) => [w.id, { title: w.title, excerpt: w.excerpt }]))
  })

/** The fine-grained second-pass question: which line, within the retained section(s). */
const lineQuestion = (query: string, candidates: ReadonlyArray<Clause>) =>
  Question.choice({
    instructions: {
      what: "Which line is most relevant to the query? Pick the single best line even if none is a perfect match.",
      query
    },
    criteria: Object.fromEntries(candidates.map((c) => [c.id, c.text]))
  })

/**
 * The companion question: does the retained excerpt answer this at all,
 * independent of which single line the `Choice` above picks as the winner.
 *
 * Scoped to the excerpt in `state`, not to the literal whole of `SPEC.md`:
 * once the window pass has run, the excerpt *is* everything this request
 * shows the model, so that is the honest scope for "does the document answer
 * this" to be judged against. See `search`'s state for what the excerpt
 * contains.
 */
const existenceQuestion = (query: string) =>
  Question.noul({
    instructions: {
      what:
        "The shared state holds an excerpt of a larger specification document. Does that excerpt state, or clearly imply, an answer to the query?",
      query
    },
    criteria: {
      true: "The excerpt directly states, or unambiguously implies, an answer to the query.",
      false: "The excerpt does not address this, or only touches it tangentially."
    }
  })

/**
 * A close second is kept alongside the top-ranked window rather than
 * discarded, since the line that answers a query does not always sit in the
 * single highest-scoring section. "Close" is deliberately generous (half the
 * leader's probability) — the fine-grained pass is what actually decides, so
 * a window costs nothing to include beyond making the fine-grained option set
 * bigger, and it is cheap right up to `Question.choiceOptionBounds.max`.
 *
 * Pure and local: given the same ranked windows, this always keeps the same
 * ones, which is what lets a replayed run reconstruct the exact candidate set
 * a recording was made against without storing it separately.
 */
export const closeSecondRatio = 0.5

/**
 * The excerpt shared as `state` for the fine-grained request: every retained
 * candidate line, id-prefixed, in document order. Both the line `Choice` and
 * the existence `Noul` are judged against exactly this text and nothing more
 * — which is also why `existenceQuestion` is careful to call it an excerpt of
 * a larger document rather than the document itself.
 */
const excerptOf = (candidates: ReadonlyArray<Clause>): string =>
  candidates.map((c) => `${c.id}: ${c.text}`).join("\n")

/**
 * Which window ids to carry into the fine-grained pass, given the ranked
 * window answer.
 */
export const selectWindows = (
  ranked: ReadonlyArray<readonly [string, number]>
): ReadonlyArray<string> => {
  const [, topProbability] = ranked[0] ?? ["", 0]
  const kept: Array<string> = []
  let clauseTotal = 0
  for (const [id, probability] of ranked) {
    if (kept.length > 0 && probability < topProbability * closeSecondRatio) break
    const window = windowById.get(id)
    if (window === undefined) continue
    if (kept.length > 0 && clauseTotal + window.clauseIds.length > Question.choiceOptionBounds.max) break
    kept.push(id)
    clauseTotal += window.clauseIds.length
  }
  return kept
}

/**
 * Answer availability, classified from the companion `Noul` by a threshold
 * applied locally — nothing here re-runs the request, so re-classifying with
 * a different threshold costs nothing.
 */
export type Availability = "present" | "partial" | "missing"

/** Illustrative, not calibrated — see docs/primitives.md's own caution about starting conservative. */
export const defaultThresholds = { present: 0.6, partial: 0.25 } as const

export const classify = (
  existence: number,
  thresholds: { readonly present: number; readonly partial: number } = defaultThresholds
): Availability =>
  existence >= thresholds.present ? "present" : existence >= thresholds.partial ? "partial" : "missing"

/**
 * What two requests told us about one query, before any threshold is applied.
 */
export interface Reading {
  readonly queryId: string
  readonly query: string
  readonly model: string
  readonly documentClauseCount: number
  readonly window: Answer.Choice<string>
  readonly windowUsage: Answer.Usage
  readonly retainedWindowIds: ReadonlyArray<string>
  readonly retainedClauseCount: number
  readonly line: Answer.Choice<string>
  readonly existence: Answer.Noul
  readonly lineUsage: Answer.Usage
}

/**
 * Runs one query against the document: a coarse window `Choice`, then a
 * fine-grained line `Choice` plus the companion existence `Noul` over
 * whichever window(s) survived, in a single second request.
 *
 * Two requests, always — `SPEC.md` never fits the 255-option cap in one, so
 * there is no single-request path to fall back to here (see
 * `wholeDocumentCapMessage`).
 */
export const search = (
  queryId: string,
  query: string
): Effect.Effect<Reading, SystemOne.SystemOneError, SystemOne.SystemOne> =>
  Effect.gen(function*() {
    const windowStage = yield* SystemOne.evaluate({
      state: { document: "SPEC.md", queryId, query },
      questions: { window: windowQuestion(query) }
    })
    const windowAnswer = windowStage.answers.window
    const retainedWindowIds = selectWindows(Answer.ranked(windowAnswer))
    const candidates = clauses.filter((c) => retainedWindowIds.includes(c.windowId))

    const fineStage = yield* SystemOne.evaluate({
      state: { excerpt: excerptOf(candidates), queryId, query },
      questions: {
        line: lineQuestion(query, candidates),
        existence: existenceQuestion(query)
      }
    })

    return {
      queryId,
      query,
      model: fineStage.model,
      documentClauseCount: clauses.length,
      window: windowAnswer,
      windowUsage: windowStage.usage,
      retainedWindowIds,
      retainedClauseCount: candidates.length,
      line: fineStage.answers.line,
      existence: fineStage.answers.existence,
      lineUsage: fineStage.usage
    }
  })

/**
 * The shape a recorded fixture stores for one query — sparse distributions
 * (only entries worth naming), reconstructed to full coverage on replay.
 */
export interface Recording {
  readonly model: string
  readonly windowProbabilities: { readonly [id: string]: number }
  readonly windowConfidence: number
  readonly windowUsage: { readonly inputTokens: number; readonly outputTokens: number }
  readonly lineProbabilities: { readonly [id: string]: number }
  readonly lineConfidence: number
  readonly existence: number
  readonly lineUsage: { readonly inputTokens: number; readonly outputTokens: number }
}

/**
 * Rebuilds the raw JSON body for one stage of one query from a sparse
 * recording, filling in the zero-probability options a real response would
 * have included but that the recording omits for readability — the same
 * technique `examples/classification/classification.ts`'s `respond` uses.
 *
 * Reused by both stages of the same query: the fine-grained stage's candidate
 * set depends on which window(s) `selectWindows` retains, which this
 * recomputes from the *reconstructed* (zero-filled) window distribution —
 * the same pure function the live path uses, over the same numbers, so it
 * retains the same windows the real run did.
 */
export const respond = (
  recorded: { readonly [queryId: string]: Recording }
) =>
(request: { readonly state: unknown; readonly questions: Question.Questions }): unknown | undefined => {
  const state = request.state as { readonly queryId?: unknown }
  const queryId = typeof state.queryId === "string" ? state.queryId : undefined
  const reading = queryId !== undefined ? recorded[queryId] : undefined
  if (reading === undefined) return undefined

  const windowProbabilities = Object.fromEntries(
    windows.map((w) => [w.id, reading.windowProbabilities[w.id] ?? 0])
  )

  if ("window" in request.questions) {
    return Testing.response({
      model: reading.model,
      answers: { window: Testing.choiceAnswer(windowProbabilities, reading.windowConfidence) },
      usage: reading.windowUsage
    })
  }

  const retainedWindowIds = selectWindows(
    Answer.ranked(Testing.choiceAnswer(windowProbabilities, reading.windowConfidence))
  )
  const candidates = clauses.filter((c) => retainedWindowIds.includes(c.windowId))
  const lineProbabilities = Object.fromEntries(
    candidates.map((c) => [c.id, reading.lineProbabilities[c.id] ?? 0])
  )
  return Testing.response({
    model: reading.model,
    answers: {
      line: Testing.choiceAnswer(lineProbabilities, reading.lineConfidence),
      existence: { type: "noul", noul: reading.existence }
    },
    usage: reading.lineUsage
  })
}
