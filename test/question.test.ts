import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import * as Question from "../src/Question.js"
import * as SystemOne from "../src/SystemOne.js"
import * as Testing from "../src/Testing.js"

const apiKey = Redacted.make("test-key")

const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

/** A choice question with exactly `n` numbered options. */
const choiceWith = (n: number): Question.Choice =>
  Question.choice({
    instructions: "Pick one",
    criteria: Object.fromEntries(Array.from({ length: n }, (_, i) => [`option${i}`, null]))
  })

/** A score question with exactly `n` levels. */
const scoreWith = (n: number): Question.Score =>
  Question.score({
    instructions: "Rate it",
    criteria: Array.from({ length: n }, (_, i) => `level ${i}`) as unknown as readonly [
      Question.Entry,
      Question.Entry,
      ...Array<Question.Entry>
    ]
  })

/** A stub HttpClient layer that fails the test if the request ever reaches it. */
const neverCalledLayer = () =>
  Testing.layerHttp(() => {
    throw new Error("a validation failure must never reach the network")
  })

const evaluateWith = (questions: Question.Questions) =>
  SystemOne.evaluate({ state: "state", questions }).pipe(
    Effect.provide(SystemOne.layer({ apiKey })),
    Effect.provide(neverCalledLayer())
  )

describe("choice option bounds", () => {
  test("255 options validates", () => {
    expect(Question.validate({ q: choiceWith(255) })).toBeUndefined()
  })

  test("256 options is rejected, naming the question and the limit", () => {
    const result = Question.validate({ q: choiceWith(256) })
    expect(result).toContain('"q"')
    expect(result).toContain("256")
    expect(result).toContain("at most 255")
  })

  test("2 options validates", () => {
    expect(Question.validate({ q: choiceWith(2) })).toBeUndefined()
  })

  test("1 option is rejected", () => {
    const result = Question.validate({ q: choiceWith(1) })
    expect(result).toContain('"q"')
    expect(result).toContain("at least 2")
  })
})

describe("score level bounds", () => {
  test("2 levels validates", () => {
    expect(Question.validate({ q: scoreWith(2) })).toBeUndefined()
  })

  test("10 levels validates", () => {
    expect(Question.validate({ q: scoreWith(10) })).toBeUndefined()
  })

  test("1 level is rejected", () => {
    const result = Question.validate({ q: scoreWith(1) })
    expect(result).toContain('"q"')
    expect(result).toContain("1 level(s)")
  })

  test("11 levels is rejected", () => {
    const result = Question.validate({ q: scoreWith(11) })
    expect(result).toContain('"q"')
    expect(result).toContain("11 level(s)")
  })
})

describe("validate reports the first offending question", () => {
  test("by name, in the order the questions were given", () => {
    const result = Question.validate({
      fine: Question.noul({ instructions: "ok" }),
      firstBad: choiceWith(1),
      secondBad: scoreWith(20)
    })
    expect(result).toContain('"firstBad"')
    expect(result).not.toContain('"secondBad"')
  })
})

describe("builders keep questions as plain data", () => {
  test("noul omits criteria entirely when none is given", () => {
    const question = Question.noul({ instructions: "Is this urgent?" })
    expect("criteria" in question).toBe(false)
    expect(Object.keys(question)).toEqual(["type", "instructions"])
  })

  test("noul keeps criteria when given", () => {
    const question = Question.noul({
      instructions: "Is this urgent?",
      criteria: { true: "Clearly urgent", false: "Not urgent" }
    })
    expect(question.criteria).toEqual({ true: "Clearly urgent", false: "Not urgent" })
  })

  test("choice infers option keys as a literal union", () => {
    const question = Question.choice({
      instructions: "Which team?",
      criteria: { billing: "Money", technical: "Bugs" }
    })
    // Compile-time: this would not typecheck if `key` were widened to `string`.
    const key: "billing" | "technical" = Object.keys(question.criteria)[0] as "billing" | "technical"
    expect(key === "billing" || key === "technical").toBe(true)
    expect(question).toEqual({
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "Money", technical: "Bugs" }
    })
  })

  test("score keeps structured rubric levels (objects, arrays) unchanged", () => {
    const level = { what: "Broken feature", examples: ["export fails"] }
    const question = Question.score({
      instructions: "How severe?",
      criteria: ["Cosmetic", level, ["Blocking", "no workaround"]]
    })
    expect(question.criteria[0]).toBe("Cosmetic")
    expect(question.criteria[1]).toBe(level)
    expect(question.criteria[1]).toEqual({ what: "Broken feature", examples: ["export fails"] })
    expect(question.criteria[2]).toEqual(["Blocking", "no workaround"])
  })
})

describe("a validation failure never reaches the network", () => {
  test("an empty question set fails as a terminal RequestError", async () => {
    const failed = await failure(evaluateWith({}))
    expect(failed._tag).toBe("SystemOne/RequestError")
  })

  test("too few score levels fails as a terminal RequestError", async () => {
    const failed = await failure(evaluateWith({ q: scoreWith(1) }))
    expect(failed._tag).toBe("SystemOne/RequestError")
    expect(failed.message).toContain("1 level(s)")
  })

  test("too many choice options fails as a terminal RequestError", async () => {
    const failed = await failure(evaluateWith({ q: choiceWith(256) }))
    expect(failed._tag).toBe("SystemOne/RequestError")
    expect(failed.message).toContain("at most 255")
  })
})
