/**
 * Offline replay coverage for the two newest example demos: semantic-find
 * (line-level search over SPEC.md with a companion existence question) and
 * hierarchy (division -> group taxonomy walk with greedy and beam search).
 *
 * Same pattern as test/integration.test.ts's "examples still work offline"
 * block and test/guardrails.test.ts's pure-policy tests: drive each demo's
 * replay layer through the real production decode/reconcile path (never a
 * shortcut that hands back a pre-built `Answer`), and confirm an id with no
 * recording fails as a genuine `SystemOne/ResponseError` rather than
 * inventing an answer — the invariant that keeps an offline demo honest.
 */
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Question from "../src/Question.js"

import { offlineLayer as semanticOfflineLayer } from "../examples/semantic-find/client.js"
import { clauses, windows } from "../examples/semantic-find/corpus.js"
import { queries } from "../examples/semantic-find/queries.js"
import { recorded as semanticRecorded } from "../examples/semantic-find/recorded.js"
import {
  classify,
  defaultThresholds,
  search,
  selectWindows,
  wholeDocumentCapMessage
} from "../examples/semantic-find/search.js"

import { filings } from "../examples/data/filings.js"
import { recorded as hierarchyRecorded } from "../examples/hierarchy/recorded.js"
import {
  beamPaths,
  defaultBeamWidth,
  greedyPath,
  offlineLayer as hierarchyOfflineLayer,
  readFiling
} from "../examples/hierarchy/search.js"
import { type CandidatePath, type Edge, isCorrect, pathScore, separation } from "../examples/hierarchy/tree.js"

const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

describe("semantic-find replay", () => {
  test("produces a reading for every recorded query, decoded through the real production path", async () => {
    for (const query of queries) {
      expect(semanticRecorded[query.id]).toBeDefined()

      const reading = await Effect.runPromise(
        search(query.id, query.text).pipe(Effect.provide(semanticOfflineLayer(semanticRecorded)))
      )

      expect(reading.queryId).toBe(query.id)
      // The full distribution survives replay, not just the winning line: a
      // real Choice.probabilities always sums to ~1, and reconcile would have
      // rejected a partial one on the way through decode.
      const windowTotal = Object.values(reading.window.probabilities).reduce((sum, p) => sum + p, 0)
      expect(windowTotal).toBeCloseTo(1, 5)
      const lineTotal = Object.values(reading.line.probabilities).reduce((sum, p) => sum + p, 0)
      expect(lineTotal).toBeCloseTo(1, 5)
      expect(reading.existence.noul).toBeGreaterThanOrEqual(0)
      expect(reading.existence.noul).toBeLessThanOrEqual(1)
      expect(reading.retainedClauseCount).toBeGreaterThan(0)
    }
  })

  test("a query id with no recording fails as a genuine ResponseError, not an invented reading", async () => {
    const error = await failure(
      search("no-such-query", "Does this query exist in the recordings?").pipe(
        Effect.provide(semanticOfflineLayer(semanticRecorded))
      )
    )
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("no-such-query")
  })

  test("classify is pure: the same existence reading always sorts into the same bucket, no request", () => {
    expect(classify(0.9)).toBe("present")
    expect(classify(defaultThresholds.present)).toBe("present")
    expect(classify(0.4)).toBe("partial")
    expect(classify(defaultThresholds.partial)).toBe("partial")
    expect(classify(0.1)).toBe("missing")
    // A different threshold set re-derives the same reading with no request.
    expect(classify(0.5, { present: 0.99, partial: 0.99 })).toBe("missing")
  })

  test("the 255-option cap: the whole-document Choice is rejected, and every windowed Choice stays under it", () => {
    expect(wholeDocumentCapMessage).toBeDefined()
    expect(wholeDocumentCapMessage).toContain(String(Question.choiceOptionBounds.max))

    // The coarse window pass itself is always under the cap...
    expect(windows.length).toBeLessThanOrEqual(Question.choiceOptionBounds.max)
    // ...and so is the naive "offer every line" set that motivated windowing
    // in the first place (recorded here so a future edit to SPEC.md that
    // shrinks it under the cap doesn't silently stop testing the constraint).
    expect(clauses.length).toBeGreaterThan(Question.choiceOptionBounds.max)

    // selectWindows is pure local logic: for every recorded query, replay the
    // exact window ranking it produced and confirm the retained candidate set
    // it hands to the fine-grained Choice never exceeds the cap — this is the
    // real constraint that shaped search.ts's two-pass design, checked
    // directly rather than only implied by the recordings happening to fit.
    for (const query of queries) {
      const reading = semanticRecorded[query.id]!
      const windowProbabilities = Object.fromEntries(
        windows.map((w) => [w.id, reading.windowProbabilities[w.id] ?? 0])
      )
      const ranked = Object.entries(windowProbabilities).sort(([, a], [, b]) => b - a)
      const retainedIds = selectWindows(ranked)
      const retainedClauseCount = clauses.filter((c) => retainedIds.includes(c.windowId)).length
      expect(retainedClauseCount).toBeLessThanOrEqual(Question.choiceOptionBounds.max)
      expect(retainedClauseCount).toBeGreaterThan(0)
    }
  })
})

describe("hierarchy replay", () => {
  test("produces a reading for every recorded filing, decoded through the real production path", async () => {
    for (const filing of filings) {
      expect(hierarchyRecorded[filing.id]).toBeDefined()

      const reading = await Effect.runPromise(
        readFiling(filing, defaultBeamWidth).pipe(Effect.provide(hierarchyOfflineLayer))
      )

      expect(reading.filing.id).toBe(filing.id)
      expect(reading.divisions.length).toBeGreaterThan(0)
      expect(reading.divisions.length).toBeLessThanOrEqual(defaultBeamWidth)
      // Every retained division contributed at least one candidate path —
      // the whole point of batching the level-2 request is that beam search
      // sees paths through more than the single top division.
      expect(reading.candidates.length).toBeGreaterThanOrEqual(reading.divisions.length)
      expect(reading.usage.totalTokens).toBeGreaterThan(0)
    }
  })

  test("a filing id with no recording fails as a genuine ResponseError, not an invented reading", async () => {
    const error = await failure(
      Effect.provide(
        readFiling({ id: "NO-SUCH-FILING", text: "irrelevant", expected: "01", note: "" } as any, defaultBeamWidth),
        hierarchyOfflineLayer
      )
    )
    expect(error._tag).toBe("SystemOne/ResponseError")
    expect(error.message).toContain("NO-SUCH-FILING")
  })

  test("pathScore is the documented length-normalized geometric mean, on hand-built edges", () => {
    const edge = (probability: number): Edge => ({ level: "division", code: "X", label: "x", probability })

    // Two levels, matching probability: product(p, p) ** (1/2) === p.
    expect(pathScore([edge(0.8), edge(0.8)])).toBeCloseTo(0.8, 10)
    // Asymmetric: product(0.9, 0.4) ** (1/2) === sqrt(0.36) === 0.6.
    expect(pathScore([edge(0.9), edge(0.4)])).toBeCloseTo(0.6, 10)
    // Certainty at every level composes to certainty.
    expect(pathScore([edge(1), edge(1), edge(1)])).toBeCloseTo(1, 10)
    // No edges at all scores 0 rather than throwing or dividing by zero.
    expect(pathScore([])).toBe(0)
  })

  test("separation compares the best hand-built path against the runner-up, and is undefined with fewer than two", () => {
    const path = (score: number): CandidatePath => ({
      divisionCode: "A" as any,
      groupCode: "01" as any,
      edges: [
        { level: "division", code: "A", label: "a", probability: score },
        { level: "group", code: "01", label: "a", probability: 1 }
      ],
      score
    })

    expect(separation([path(0.9), path(0.3)])).toBeCloseTo(3, 10)
    expect(separation([path(0.9)])).toBeUndefined()
    expect(separation([])).toBeUndefined()
    // A runner-up score of exactly 0 (or numerically indistinguishable from
    // it) is treated as "no real second candidate", not an enormous but
    // meaningless ratio.
    expect(separation([path(0.9), path(0)])).toBeUndefined()
  })

  test("greedy and beam re-derive from the same recorded candidates, with no further request", async () => {
    for (const filing of filings) {
      const reading = await Effect.runPromise(
        readFiling(filing, defaultBeamWidth).pipe(Effect.provide(hierarchyOfflineLayer))
      )

      const greedy = greedyPath(reading)
      const beam = beamPaths(reading, defaultBeamWidth)

      // Greedy always picks a candidate under the root's own top division.
      expect(greedy.divisionCode).toBe(reading.divisions[0]![0])
      // Beam is sorted by score, most likely first, and never exceeds the
      // requested width.
      expect(beam.length).toBeLessThanOrEqual(defaultBeamWidth)
      for (let i = 1; i < beam.length; i++) {
        expect(beam[i - 1]!.score).toBeGreaterThanOrEqual(beam[i]!.score)
      }
      // Greedy's own path is always among the full candidate set beam search
      // draws from — same two requests, read two different ways.
      expect(reading.candidates.some((c) => c.divisionCode === greedy.divisionCode && c.groupCode === greedy.groupCode))
        .toBe(true)
      // isCorrect is pure comparison against the human label, no request.
      expect(isCorrect(greedy, filing.expected)).toBe(greedy.groupCode === filing.expected)
    }
  })
})
