/**
 * Line-by-line semantic search over SPEC.md — CLI.
 *
 * Replicates TypeSafe's semantic-find cookbook: split a document into clauses
 * with stable ids, offer those ids as `Choice` options to rank them against a
 * query, and ask a companion `Noul` in the same request about whether the
 * document answers the query at all. `Choice.probabilities` sums to 1, so
 * some line always wins — the companion question is the only thing that can
 * say "nothing here", and a query the document doesn't answer is included
 * below specifically so that reading has something real to say.
 *
 * SPEC.md has 282 candidate lines (`corpus.clauses.length`) — more than the
 * documented 255-option `Choice` ceiling — so a naive one-shot request would
 * fail pre-flight. The output below shows that failure message, then the
 * documented workaround this package implements: a coarse window pass first,
 * a line pass only within what survives it.
 *
 *   bun run examples/semantic-find/cli.ts
 */
import { Console, Effect } from "effect"
import { Answer, Question } from "../../src/index.js"
import { clientLayer, isLive } from "./client.js"
import { clauses, windowById, windows } from "./corpus.js"
import { queries } from "./queries.js"
import { recorded } from "./recorded.js"
import { classify, defaultThresholds, search, wholeDocumentCapMessage } from "./search.js"

const bar = (probability: number, width = 20) => {
  const filled = Math.round(probability * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`

const glyph: Record<ReturnType<typeof classify>, string> = {
  present: "●  present",
  partial: "◐  partial",
  missing: "○  missing"
}

const report = Effect.gen(function*() {
  const live = yield* isLive

  yield* Console.log("")
  yield* Console.log(`Semantic find over SPEC.md — ${live ? "LIVE" : "REPLAY"}`)
  yield* Console.log("=".repeat(64))

  yield* Console.log("")
  yield* Console.log(`SPEC.md splits into ${clauses.length} candidate lines across ${windows.length} sections.`)
  yield* Console.log(
    `Offering all ${clauses.length} as one Choice: ${
      wholeDocumentCapMessage === undefined ? "would pass pre-flight (surprising — check the cap)" : "REJECTED"
    }`
  )
  if (wholeDocumentCapMessage !== undefined) {
    yield* Console.log(`  Question.validate says: ${wholeDocumentCapMessage}`)
  }
  yield* Console.log(
    `So every query below costs two requests: a coarse Choice over the ${windows.length} sections,`
  )
  yield* Console.log(
    "then a line Choice + the existence Noul over only the section(s) that survive it."
  )

  for (const query of queries) {
    const reading = yield* search(query.id, query.text)

    yield* Console.log("")
    yield* Console.log("-".repeat(64))
    yield* Console.log(`"${reading.query}"`)
    yield* Console.log(`  ${query.note}`)

    yield* Console.log("")
    yield* Console.log("  Window pass (coarse):")
    for (const [id, probability] of Answer.top(reading.window, 3)) {
      const window = windowById.get(id)
      const kept = reading.retainedWindowIds.includes(id) ? "→ kept" : ""
      yield* Console.log(
        `    ${id.padEnd(4)} ${bar(probability)} ${pct(probability).padStart(4)}  ${window?.title ?? id} ${kept}`
      )
    }
    yield* Console.log(
      `  Retained ${reading.retainedWindowIds.length} section(s), ${reading.retainedClauseCount} line(s) — ` +
        `line Choice runs over ${reading.retainedClauseCount} options, well under the ${Question.choiceOptionBounds.max}-option cap.`
    )

    yield* Console.log("")
    yield* Console.log("  Line pass (fine, within the retained section(s)):")
    for (const [id, probability] of Answer.top(reading.line, 3)) {
      const clause = clauses.find((c) => c.id === id)
      const text = clause === undefined ? "" : clause.text.length > 72 ? `${clause.text.slice(0, 71)}…` : clause.text
      yield* Console.log(`    ${id} ${bar(probability)} ${pct(probability).padStart(4)}  ${text}`)
    }

    const availability = classify(reading.existence.noul)
    yield* Console.log("")
    yield* Console.log(
      `  Does the document answer this at all?  noul=${reading.existence.noul.toFixed(2)}  →  ${
        glyph[availability]
      }`
    )
    if (availability === "missing") {
      const [topLine, topProbability] = Answer.ranked(reading.line)[0] ?? ["?", 0]
      yield* Console.log(
        `  The top line still "won" at ${pct(topProbability)} (${topLine}) — Choice probabilities sum to 1,` +
          " so something always wins. The companion Noul is the only thing here that can say \"nothing here\"."
      )
    }
  }

  yield* Console.log("")
  yield* Console.log("=".repeat(64))
  yield* Console.log(
    `Availability is classified locally at present ≥ ${defaultThresholds.present}, partial ≥ ${defaultThresholds.partial} ` +
      "— re-run with different thresholds and nothing above re-requests anything; the distributions are already in hand."
  )
  yield* Console.log(
    `${queries.length} queries over one document is an illustration, not an evaluation, and each reading is one draw ` +
      "from a distribution, not a measurement."
  )
})

Effect.runPromise(report.pipe(Effect.provide(clientLayer(recorded)))).catch((error) => {
  console.error(error)
  process.exit(1)
})
