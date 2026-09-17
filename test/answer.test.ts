import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import * as Answer from "../src/Answer.js"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("type guards", () => {
  const noul: Answer.Any = { type: "noul", noul: 0.5 }
  const choice: Answer.Any = {
    type: "choice",
    choice: "a",
    probabilities: { a: 0.7, b: 0.3 },
    confidence: 0.4
  }
  const score: Answer.Any = {
    type: "score",
    score: 1.5,
    confidence: 0.6,
    legend: { "0": "low", "1": "mid", "2": "high" },
    probabilities: { "0": 0, "1": 0.5, "2": 0.5 }
  }

  test("each guard is true only for its own answer type", () => {
    expect(Answer.isNoul(noul)).toBe(true)
    expect(Answer.isNoul(choice)).toBe(false)
    expect(Answer.isNoul(score)).toBe(false)

    expect(Answer.isChoice(choice)).toBe(true)
    expect(Answer.isChoice(noul)).toBe(false)
    expect(Answer.isChoice(score)).toBe(false)

    expect(Answer.isScore(score)).toBe(true)
    expect(Answer.isScore(noul)).toBe(false)
    expect(Answer.isScore(choice)).toBe(false)
  })

  // The documented asymmetry: a noul answer *is* its distribution (a single
  // probability), so there is nothing left to summarize into a confidence.
  test("hasConfidence is false for a noul and true for choice and score", () => {
    expect(Answer.hasConfidence(noul)).toBe(false)
    expect(Answer.hasConfidence(choice)).toBe(true)
    expect(Answer.hasConfidence(score)).toBe(true)
  })

  test("isChoice narrows Any to Choice<string> at the type level", () => {
    const answer: Answer.Any = choice
    if (Answer.isChoice(answer)) {
      // Only compiles because the guard narrowed `answer` away from `Noul | Score`.
      const probabilities: { readonly [option: string]: number } = answer.probabilities
      expect(probabilities.a).toBe(0.7)
    } else {
      throw new Error("expected isChoice(choice) to be true")
    }
  })

  test("isScore narrows Any to Score at the type level", () => {
    const answer: Answer.Any = score
    if (Answer.isScore(answer)) {
      // Only compiles because the guard narrowed `answer` to Score.
      const legend: { readonly [level: string]: Question.Json } = answer.legend
      expect(legend["1"]).toBe("mid")
    } else {
      throw new Error("expected isScore(score) to be true")
    }
  })

  test("isNoul narrows Any to Noul at the type level", () => {
    const answer: Answer.Any = noul
    if (Answer.isNoul(answer)) {
      // Only compiles because the guard narrowed `answer` to Noul, which has no `confidence`.
      const value: number = answer.noul
      expect(value).toBe(0.5)
    } else {
      throw new Error("expected isNoul(noul) to be true")
    }
  })

  test("hasConfidence narrows Any to Choice<string> | Score at the type level", () => {
    for (const answer of [choice, score] as ReadonlyArray<Answer.Any>) {
      if (Answer.hasConfidence(answer)) {
        // Only compiles because the guard ruled out Noul, which has no `confidence`.
        const confidence: number = answer.confidence
        expect(typeof confidence).toBe("number")
      } else {
        throw new Error("expected hasConfidence to be true")
      }
    }
  })

  // The real use case: walking a decoded response's answer record, which is
  // typed `Record<string, Answer.Any>`, and narrowing case by case.
  test("narrows a decoded response's raw.answers record", async () => {
    const questions = {
      department: Question.choice({
        instructions: "Which team should handle this?",
        criteria: { billing: "Money", shipping: "Delivery" }
      }),
      urgent: Question.noul({ instructions: "Is this urgent?" }),
      severity: Question.score({
        instructions: "How severe?",
        criteria: ["low", "mid", "high"]
      })
    }

    const result = await run(
      SystemOne.evaluate({ state: "a ticket", questions }).pipe(
        Effect.provide(Testing.layerFixture(
          Testing.response({
            answers: {
              department: {
                type: "choice",
                choice: "billing",
                confidence: 0.9,
                probabilities: { billing: 0.9, shipping: 0.1 }
              },
              urgent: { type: "noul", noul: 0.8 },
              severity: {
                type: "score",
                score: 1.2,
                confidence: 0.5,
                legend: { "0": "low", "1": "mid", "2": "high" },
                probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 }
              }
            }
          })
        ))
      )
    )

    const withConfidence: Array<string> = []
    const nouls: Array<string> = []
    for (const [name, answer] of Object.entries(result.raw.answers)) {
      if (Answer.hasConfidence(answer)) {
        withConfidence.push(name)
        expect(typeof answer.confidence).toBe("number")
      } else {
        expect(Answer.isNoul(answer)).toBe(true)
        nouls.push(name)
      }
      if (Answer.isChoice(answer)) {
        expect(Answer.topProbability(answer)).toBe(0.9)
      }
      if (Answer.isScore(answer)) {
        expect(Answer.levelCount(answer)).toBe(3)
      }
    }
    expect(withConfidence.sort()).toEqual(["department", "severity"])
    expect(nouls).toEqual(["urgent"])
  })
})

describe("topProbability vs confidence", () => {
  // The whole point of `topProbability` is that it is NOT `confidence`:
  // `confidence` summarizes the shape of the entire distribution, while
  // `topProbability` is only the number attached to the option that won.
  // docs/consistency_choice_cookbook.md gates a decision on the winning
  // probability (>= 0.60), not on confidence, precisely because the two can
  // disagree — a client that read `confidence` there would be answering a
  // different question than the recipe asks.
  test("the winning probability and confidence can differ substantially", () => {
    const answer: Answer.Choice<"a" | "b" | "c"> = {
      type: "choice",
      choice: "a",
      probabilities: { a: 0.7, b: 0.2, c: 0.1 },
      // Supplied independently of the distribution, as the real API does:
      // deliberately low here even though one option carries most of the mass.
      confidence: 0.22
    }

    expect(Answer.topProbability(answer)).toBe(0.7)
    expect(answer.confidence).toBe(0.22)
    expect(Math.abs(Answer.topProbability(answer) - answer.confidence)).toBeGreaterThan(0.4)
  })
})

describe("ranked", () => {
  test("orders options from most to least likely", () => {
    const answer: Answer.Choice<"a" | "b" | "c"> = {
      type: "choice",
      choice: "b",
      probabilities: { a: 0.2, b: 0.5, c: 0.3 },
      confidence: 0.5
    }
    expect(Answer.ranked(answer)).toEqual([["b", 0.5], ["c", 0.3], ["a", 0.2]])
  })

  // Non-numeric-looking keys preserve insertion order in `Object.entries`, so
  // this exercises `Array.prototype.sort`'s stability directly rather than
  // relying on an engine's incidental key ordering.
  test("keeps insertion order among tied options", () => {
    const answer: Answer.Choice<"apple" | "banana" | "cherry" | "zebra"> = {
      type: "choice",
      choice: "apple",
      probabilities: { zebra: 0.2, apple: 0.5, banana: 0.5, cherry: 0.1 },
      confidence: 0.5
    }
    expect(Answer.ranked(answer)).toEqual([
      ["apple", 0.5],
      ["banana", 0.5],
      ["zebra", 0.2],
      ["cherry", 0.1]
    ])
  })

  test("a single-option distribution ranks trivially", () => {
    const answer: Answer.Choice<"only"> = {
      type: "choice",
      choice: "only",
      probabilities: { only: 1 },
      confidence: 1
    }
    expect(Answer.ranked(answer)).toEqual([["only", 1]])
  })
})

describe("top", () => {
  const answer: Answer.Choice<"a" | "b" | "c"> = {
    type: "choice",
    choice: "a",
    probabilities: { a: 0.5, b: 0.3, c: 0.2 },
    confidence: 0.5
  }

  test("returns the n most likely options", () => {
    expect(Answer.top(answer, 2)).toEqual([["a", 0.5], ["b", 0.3]])
  })

  test("clamps n above the number of options offered", () => {
    expect(Answer.top(answer, 100)).toEqual(Answer.ranked(answer))
  })

  test("n === 0 returns an empty list", () => {
    expect(Answer.top(answer, 0)).toEqual([])
  })

  test("a negative n returns an empty list rather than throwing", () => {
    expect(Answer.top(answer, -3)).toEqual([])
  })
})

describe("probabilityOf", () => {
  test("returns the weight of an option the model gave no mass to", () => {
    const answer: Answer.Choice<"a" | "b" | "c"> = {
      type: "choice",
      choice: "a",
      probabilities: { a: 1, b: 0, c: 0 },
      confidence: 1
    }
    expect(Answer.probabilityOf(answer, "b")).toBe(0)
    expect(Answer.probabilityOf(answer, "c")).toBe(0)
  })

  test("returns the weight of the winning option too", () => {
    const answer: Answer.Choice<"a" | "b"> = {
      type: "choice",
      choice: "a",
      probabilities: { a: 0.6, b: 0.4 },
      confidence: 0.6
    }
    expect(Answer.probabilityOf(answer, "a")).toBe(0.6)
  })
})

describe("spread", () => {
  test("is (near) zero for a distribution concentrated on one level", () => {
    const answer: Answer.Score = {
      type: "score",
      score: 2,
      confidence: 0.99,
      legend: { "0": "a", "1": "b", "2": "c" },
      probabilities: { "0": 0, "1": 0, "2": 1 }
    }
    expect(Answer.spread(answer)).toBeCloseTo(0, 10)
  })

  test("is larger for a distribution split across the extremes", () => {
    const answer: Answer.Score = {
      type: "score",
      score: 1,
      confidence: 0.1,
      legend: { "0": "a", "1": "b", "2": "c" },
      probabilities: { "0": 0.5, "1": 0, "2": 0.5 }
    }
    expect(Answer.spread(answer)).toBeGreaterThan(0.9)
  })

  // The reason `spread` exists: two answers can share the exact same `score`
  // (a weighted mean) while meaning completely different things. A score of
  // 1.0 reached by genuine certainty on level 1 is a real reading; the same
  // 1.0 reached by a coin flip between the two extremes is closer to a shrug.
  // Reading `score` alone cannot tell these apart — that's the misreading
  // docs/primitives.md warns a mid-scale score can silently be.
  test("the same score can come from a confident read or a coin flip, and spread tells them apart", () => {
    const legend = { "0": "a", "1": "b", "2": "c" }

    const confident: Answer.Score = {
      type: "score",
      score: 1.0,
      confidence: 0.95,
      legend,
      probabilities: { "0": 0, "1": 1, "2": 0 }
    }
    const splitAtExtremes: Answer.Score = {
      type: "score",
      score: 1.0,
      confidence: 0.1,
      legend,
      probabilities: { "0": 0.5, "1": 0, "2": 0.5 }
    }

    expect(confident.score).toBe(splitAtExtremes.score)
    expect(Answer.spread(confident)).toBeCloseTo(0, 10)
    expect(Answer.spread(splitAtExtremes)).toBeCloseTo(1, 10)
    expect(Answer.spread(splitAtExtremes)).toBeGreaterThan(Answer.spread(confident) + 0.5)
  })

  test("a legend of zero or one level has no dispersion to report", () => {
    const empty: Answer.Score = {
      type: "score",
      score: 0,
      confidence: 1,
      legend: {},
      probabilities: {}
    }
    const single: Answer.Score = {
      type: "score",
      score: 0,
      confidence: 1,
      legend: { "0": "only" },
      probabilities: { "0": 1 }
    }
    expect(Answer.spread(empty)).toBe(0)
    expect(Answer.spread(single)).toBe(0)
  })

  test("a two-level legend still reports a meaningful spread", () => {
    const uncertain: Answer.Score = {
      type: "score",
      score: 0.5,
      confidence: 0.1,
      legend: { "0": "no", "1": "yes" },
      probabilities: { "0": 0.5, "1": 0.5 }
    }
    // Both levels sit exactly 0.5 away from the mean.
    expect(Answer.spread(uncertain)).toBeCloseTo(0.5, 10)
  })

  // The wire shape does not promise `legend` and `probabilities` share every
  // key: a stray `probabilities` entry with no matching `legend` entry must
  // be excluded from the computation rather than silently pulled in.
  test("ignores a probabilities key that has no matching legend entry", () => {
    const answer: Answer.Score = {
      type: "score",
      score: 1,
      confidence: 0.8,
      legend: { "0": "a", "1": "b" },
      // "2" has no legend entry and must be ignored, not treated as a level.
      probabilities: { "0": 0, "1": 1, "2": 0.5 }
    }
    expect(Answer.spread(answer)).toBeCloseTo(0, 10)
  })
})
