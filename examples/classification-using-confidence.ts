/**
 * Classification using confidence — CLI.
 *
 * A replication of TypeSafe's cookbook of the same name:
 * https://docs.typesafe.ai/cookbooks/classification_using_confidence
 *
 * One Choice question offers every SIC major group at once. When the answer's
 * confidence clears the threshold, report the narrow group. When it does not,
 * report the group's parent division instead — a local lookup, no second call.
 * The bet is that a correct broad label beats a wrong narrow one.
 *
 * Runs offline against fixtures by default. Set TYPESAFE_API_KEY to run the
 * same code against the live service:
 *
 *   bun run examples/classification-using-confidence.ts
 *
 * For the same policy with a slider on it, see `bun run web`.
 */
import { Console, Effect } from "effect"
import { clientLayer, decide, defaultThreshold, isCorrect, isLive, read } from "./classification.js"
import { type Filing, filings } from "./filings.js"
import { recordedModel } from "./recorded.js"

interface Row {
  readonly filing: Filing
  readonly group: string
  readonly confidence: number
  readonly level: "group" | "division"
  readonly label: string
  readonly correct: boolean
  readonly groupWasRight: boolean
  readonly model: string
}

const classify = (filing: Filing) =>
  Effect.map(read({ id: filing.id, business: filing.text }), (reading): Row => {
    const decision = decide(reading, defaultThreshold)
    return {
      filing,
      group: reading.group,
      confidence: reading.confidence,
      level: decision.level,
      label: decision.label,
      correct: isCorrect(reading, decision, filing.expected),
      groupWasRight: reading.group === filing.expected,
      model: reading.model
    }
  })

const pad = (value: string, width: number) =>
  value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width)

const report = (results: ReadonlyArray<Row>) =>
  Effect.gen(function*() {
    yield* Console.log("")
    yield* Console.log(
      `${pad("FILING", 18)}${pad("CONF", 7)}${pad("REPORTED AS", 13)}${pad("LABEL", 44)}`
    )
    yield* Console.log("-".repeat(82))
    for (const r of results) {
      yield* Console.log(
        pad(r.filing.id, 18) + pad(r.confidence.toFixed(2), 7) + pad(r.level, 13) + pad(r.label, 44) +
          (r.correct ? " ok" : " miss")
      )
    }

    const sure = results.filter((r) => r.level === "group")
    const unsure = results.filter((r) => r.level === "division")
    const rate = (hits: number, total: number) =>
      total === 0 ? "n/a" : `${hits}/${total} (${Math.round((100 * hits) / total)}%)`

    yield* Console.log("")
    yield* Console.log("Two policies over the same answers:")
    yield* Console.log(
      `  always name a group      ${rate(results.filter((r) => r.groupWasRight).length, results.length)}`
    )
    yield* Console.log(
      `  fall back when unsure    ${rate(results.filter((r) => r.correct).length, results.length)}`
    )
    yield* Console.log("")
    yield* Console.log(
      `  confident (>= ${defaultThreshold})     ${
        rate(sure.filter((r) => r.correct).length, sure.length)
      } as groups`
    )
    yield* Console.log(
      `  unsure    (< ${defaultThreshold})     ${
        rate(unsure.filter((r) => r.correct).length, unsure.length)
      } as divisions`
    )
    yield* Console.log(
      `  (of those unsure cases, ${
        unsure.filter((r) => r.groupWasRight).length
      }/${unsure.length} had the right group anyway)`
    )
    yield* Console.log("")
    yield* Console.log(
      `${results.length} cases is far too few to measure anything. The point is the shape of the`
    )
    yield* Console.log("policy: one request, and a threshold that trades specificity for being right.")
    const models = [...new Set(results.map((r) => r.model))]
    yield* Console.log(`Answered by ${models.join(", ")}.`)
  })

const main = Effect.gen(function*() {
  const live = yield* isLive
  yield* Console.log(
    live
      ? "Asking the live System One API."
      : `No TYPESAFE_API_KEY set. Replaying responses recorded from ${recordedModel};\n` +
        "a recording is one draw from a distribution, not a fresh measurement."
  )
  // Bounded concurrency, and one request per filing: the fallback costs nothing extra.
  const results = yield* Effect.forEach(filings, classify, { concurrency: 4 })
  yield* report(results)
})

Effect.runPromise(main.pipe(Effect.provide(clientLayer))).catch((error) => {
  console.error(error)
  process.exit(1)
})
