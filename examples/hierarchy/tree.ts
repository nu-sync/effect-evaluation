/**
 * The taxonomy walk: division → group as two levels of `Choice`, plus the
 * pure path math from docs/hierarchical_classification.md.
 *
 * Nothing in this file makes a request. `pathScore` and `separation` take
 * already-answered edges and read them, which is what lets `cli.ts` re-derive
 * greedy and beam decisions — and the diagnostic view of where they diverged —
 * with no further spend.
 */
import { Question } from "../../src/index.js"
import { divisionOf, divisions, type DivisionCode, type GroupCode, groupCodes, groupName } from "../data/sic.js"

/**
 * Every group code that belongs to one division, precomputed once so
 * {@link groupQuestionFor} doesn't re-scan the full 60-entry table per call.
 */
export const codesByDivision: { readonly [D in DivisionCode]: ReadonlyArray<GroupCode> } = (
  Object.keys(divisions) as ReadonlyArray<DivisionCode>
).reduce(
  (acc, division) => {
    acc[division] = groupCodes.filter((code) => divisionOf(code) === division)
    return acc
  },
  {} as { [D in DivisionCode]: ReadonlyArray<GroupCode> }
)

/**
 * The root question: which of the 9 divisions in this taxonomy slice does the
 * filing belong to. `divisions` already enumerates every code this Choice can
 * answer with, so the cast to a literal-keyed criteria object is truthful —
 * unlike {@link groupQuestionFor}, whose criteria is a runtime subset.
 */
export const divisionQuestion: Question.Choice<DivisionCode> = Question.choice({
  instructions:
    "Which broad industry division does this company operate in? Judge the company's own operations as this filing describes them.",
  criteria: divisions
}) as Question.Choice<DivisionCode>

/**
 * The second-level question for one division: which of its groups. Built at
 * runtime from {@link codesByDivision}, so the option set — and the type this
 * function returns — cannot be pinned to a compile-time literal union the way
 * {@link divisionQuestion} is: only some group codes are valid for a given
 * division, and claiming the full `GroupCode` union here would be the kind of
 * cast this codebase's "decode, then reconcile" discipline exists to prevent
 * on the answer side. Read `Answer.Choice<string>` back and check membership
 * against `codesByDivision[division]` before treating a value as a `GroupCode`.
 */
export const groupQuestionFor = (division: DivisionCode): Question.Choice<string> => {
  const codes = codesByDivision[division]
  const criteria = Object.fromEntries(codes.map((code) => [code, groupName(code)]))
  return Question.choice({
    instructions:
      `Within ${divisions[division]}, which group best describes this company's operations? ` +
      "Judge the company's own operations as this filing describes them.",
    criteria
  })
}

/**
 * One step of a path: the node chosen, its human label, and the probability
 * the model assigned it *among the options it was offered at that step* —
 * not a global probability.
 *
 * Kept alongside every candidate path so a divergence between greedy and beam
 * can be read off directly (which division, which group, at what confidence)
 * rather than only compared by final score — the cookbook's point that
 * tracking visited nodes and edges is what makes an error diagnosable.
 */
export interface Edge {
  readonly level: "division" | "group"
  readonly code: string
  readonly label: string
  readonly probability: number
}

/**
 * One fully-decided path from the root to a leaf group, with the edges that
 * produced it and its length-normalized score.
 */
export interface CandidatePath {
  readonly divisionCode: DivisionCode
  readonly groupCode: GroupCode
  readonly edges: readonly [Edge, Edge]
  readonly score: number
}

/**
 * `path_score = product(edge_probabilities) ** (1 / decisions)` — the
 * length-normalized geometric mean, so paths of different depth remain
 * comparable to each other.
 *
 * This tree is two decisions deep, so multiplying the two probabilities
 * directly and taking a square root never underflows. The cookbook's own
 * caveat is worth repeating for anyone reusing this on a deeper taxonomy:
 * for a tree with many more levels, multiplying probabilities directly can
 * underflow to 0 before the root of the product is taken, so the mean should
 * be computed as `exp(mean(log(probabilities)))` instead — same value,
 * computed in log space so a long chain of small numbers never collapses to
 * zero along the way.
 */
export const pathScore = (edges: ReadonlyArray<Edge>): number => {
  if (edges.length === 0) return 0
  const product = edges.reduce((acc, edge) => acc * edge.probability, 1)
  return product ** (1 / edges.length)
}

/**
 * Below this, an edge probability is treated as "the model assigned this
 * branch nothing" rather than as a real, if tiny, reading. No probability
 * this API returns for a genuine candidate lands anywhere near this range —
 * it exists only so that a runner-up whose true probability the response
 * reported as exactly (or numerically indistinguishable from) zero can't turn
 * a "there is no real second candidate" case into a separation of several
 * million through nothing but floating-point noise. (This can happen in
 * `search.ts`'s offline replay, whose fixtures nudge a tied-at-zero runner-up
 * just off zero to make its rank reproducible — see the comment there. This
 * guard is what keeps that internal nudge from leaking into a displayed
 * number, and it is equally correct against genuine live data, where no real
 * probability is ever this close to zero either.)
 */
const negligible = 1e-6

/**
 * `separation = best_path_score / second_best_path_score`. This describes how
 * much more confident the top path is than the runner-up — it is reported,
 * not thresholded. The cookbook is explicit that separation is not a pruning
 * rule: a search that discarded paths whenever separation ran high would
 * throw away exactly the cases where beam search's extra paths would
 * otherwise have been available to recover from a wrong first guess.
 *
 * Returns `undefined` when there is no meaningful second path to compare
 * against: fewer than two candidates, or a runner-up whose score is
 * {@link negligible}.
 */
export const separation = (
  pathsByScoreDescending: ReadonlyArray<CandidatePath>
): number | undefined => {
  const best = pathsByScoreDescending[0]
  const second = pathsByScoreDescending[1]
  if (best === undefined || second === undefined || second.score < negligible) return undefined
  return best.score / second.score
}

/** Whether a path's leaf group matches the label a human reader assigned. */
export const isCorrect = (path: CandidatePath, expected: GroupCode): boolean => path.groupCode === expected
