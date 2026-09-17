/**
 * Regenerates `recorded.ts` from the live API. Refuses to run without a key,
 * so recorded fixtures can never be recorded from fixtures.
 *
 * Two requests per query (the window pass, then the line-and-existence pass)
 * — `SPEC.md` never fits the 255-option cap in one request, so every query
 * costs two round trips, never one.
 *
 *   TYPESAFE_API_KEY=... bun run examples/semantic-find/record.ts
 */
import { Console, Effect } from "effect"
import { SystemOne } from "../../src/index.js"
import { isLive } from "./client.js"
import { queries } from "./queries.js"
import { search } from "./search.js"

// Only entries at least this likely are worth naming in the checked-in file;
// everything else is reconstructed as zero on replay (see `search.ts`'s
// `respond`). This keeps the fixture readable without losing the requirement
// that a replayed `Choice` answer's `probabilities` covers every option that
// was actually offered.
const keepAbove = 0.005

const sparse = (probabilities: { readonly [key: string]: number }) =>
  Object.fromEntries(Object.entries(probabilities).filter(([, p]) => p >= keepAbove))

const captured = Effect.gen(function*() {
  if (!(yield* isLive)) {
    return yield* Effect.die(new Error("no TYPESAFE_API_KEY set — recording requires the live API"))
  }

  const readings = yield* Effect.forEach(
    queries,
    (query) => search(query.id, query.text),
    { concurrency: 2 }
  )

  const model = readings[0]?.model ?? "unknown"
  const totalTokens = readings.reduce(
    (sum, r) => sum + r.windowUsage.totalTokens + r.lineUsage.totalTokens,
    0
  )

  const entries = readings.map((r) => {
    const windowProbabilities = sparse(r.window.probabilities)
    const lineProbabilities = sparse(r.line.probabilities)
    return `  ${JSON.stringify(r.queryId)}: {
    model: ${JSON.stringify(r.model)},
    windowProbabilities: ${JSON.stringify(windowProbabilities)},
    windowConfidence: ${r.window.confidence},
    windowUsage: { inputTokens: ${r.windowUsage.inputTokens}, outputTokens: ${r.windowUsage.outputTokens} },
    lineProbabilities: ${JSON.stringify(lineProbabilities)},
    lineConfidence: ${r.line.confidence},
    existence: ${r.existence.noul},
    lineUsage: { inputTokens: ${r.lineUsage.inputTokens}, outputTokens: ${r.lineUsage.outputTokens} }
  }`
  })

  const source = `/**
 * Semantic-find readings recorded from the live System One API, keyed by
 * query id — see \`queries.ts\`. Sparse: only probabilities at or above
 * ${keepAbove} are named; \`search.ts\`'s \`respond\` reconstructs the rest as
 * zero before replaying, which is what lets a strict \`Choice\` reconcile
 * (every offered option must have a probability entry) still pass offline.
 *
 * Recorded ${new Date().toISOString().slice(0, 10)} from ${model} against the
 * frozen \`spec-snapshot.ts\`. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/semantic-find/record.ts
 *
 * One recording is a single draw from a distribution, not a measurement —
 * probabilities near a threshold will not land on the same side every time.
 */
import type { Recording } from "./search.js"

export const recorded: { readonly [queryId: string]: Recording } = {
${entries.join(",\n")}
}
`

  yield* Effect.promise(() => Bun.write(`${import.meta.dir}/recorded.ts`, source))
  yield* Console.log(
    `recorded ${readings.length} queries (${readings.length * 2} requests) from ${model} (${totalTokens} tokens)`
  )
})

await Effect.runPromise(Effect.provide(captured, SystemOne.layerFetch()))
