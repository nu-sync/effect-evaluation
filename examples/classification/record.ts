/**
 * Regenerates `recorded.ts` from the live API.
 *
 * The offline demo should show what the model actually did, not what someone
 * guessed it would do. Run this whenever the filings change:
 *
 *   TYPESAFE_API_KEY=... bun run examples/classification/record.ts
 *
 * It refuses to run without a key, so recorded fixtures can never be recorded
 * from fixtures.
 */
import { Console, Effect } from "effect"
import { SystemOne } from "../../src/index.js"
import { filings } from "../data/filings.js"
import { clientLayer, industry, isLive } from "./classification.js"

const captured = Effect.gen(function*() {
  if (!(yield* isLive)) {
    return yield* Effect.die(
      new Error("no TYPESAFE_API_KEY set — recording fixtures requires the live API")
    )
  }

  const results = yield* Effect.forEach(
    filings,
    (filing) =>
      Effect.map(
        SystemOne.evaluate({
          state: { id: filing.id, business: filing.text },
          questions: { industry }
        }),
        (result) => ({ filing, answer: result.answers.industry, model: result.model, usage: result.usage })
      ),
    { concurrency: 4 }
  )

  const model = results[0]?.model ?? "unknown"
  const tokens = results.reduce((total, r) => total + r.usage.totalTokens, 0)

  const entries = results.map(({ answer, filing }) => {
    // Options the model gave no weight to are dropped; the live API returns all
    // of them, and keeping 60 zeroes per case would bury the signal.
    const probabilities = Object.entries(answer.probabilities)
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([code, p]) => `      ${JSON.stringify(code)}: ${p}`)
      .join(",\n")
    return `  ${JSON.stringify(filing.id)}: {
    probabilities: {
${probabilities}
    },
    confidence: ${answer.confidence}
  }`
  })

  const source = `/**
 * Responses recorded from the live System One API, so the offline demo shows
 * what the model actually did rather than what someone assumed it would do.
 *
 * Recorded ${new Date().toISOString().slice(0, 10)} from ${model}. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/classification/record.ts
 *
 * Options the model gave zero weight are omitted; the live API returns the full
 * distribution across every option offered. A single recording is one draw from
 * a distribution, not a measurement — the same filing does not always come back
 * with the same confidence.
 */
import type { GroupCode } from "../data/sic.js"

export interface Recorded {
  readonly probabilities: Partial<Record<GroupCode, number>>
  readonly confidence: number
}

export const recordedModel = ${JSON.stringify(model)}

export const recorded: { readonly [id: string]: Recorded } = {
${entries.join(",\n")}
}
`

  yield* Effect.promise(() => Bun.write(`${import.meta.dir}/recorded.ts`, source))
  yield* Console.log(`recorded ${results.length} responses from ${model} (${tokens} tokens)`)
  for (const { answer, filing } of results) {
    yield* Console.log(
      `  ${filing.id.padEnd(17)} ${answer.choice.padEnd(4)} conf ${answer.confidence.toFixed(2)}  ${
        answer.choice === filing.expected ? "matches" : `differs from ${filing.expected}`
      }`
    )
  }
})

await Effect.runPromise(Effect.provide(captured, clientLayer))
