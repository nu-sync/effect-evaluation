/**
 * Regenerates `recorded.ts` from the live API.
 *
 * Two requests per filing — one root (division), one batched level-2 (a group
 * question per division the root retained) — so this makes
 * `filings.length * 2` live requests in total. Refuses to run without a key,
 * so recorded fixtures can never be recorded from fixtures.
 *
 *   TYPESAFE_API_KEY=... bun run examples/hierarchy/record.ts
 */
import { Console, Effect } from "effect"
import { SystemOne } from "../../src/index.js"
import { filings } from "../filings.js"
import { defaultBeamWidth, groupQuestionName, isLive, readRaw } from "./search.js"

const captured = Effect.gen(function*() {
  if (!(yield* isLive)) {
    return yield* Effect.die(new Error("no TYPESAFE_API_KEY set — recording requires the live API"))
  }

  const readings = yield* Effect.forEach(
    filings,
    (filing) => Effect.map(readRaw(filing, defaultBeamWidth), (raw) => ({ filing, raw })),
    { concurrency: 4 }
  )

  const model = readings[0]?.raw.root.model ?? "unknown"
  const totalTokens = readings.reduce(
    (total, { raw }) => total + raw.root.usage.totalTokens + raw.level2.usage.totalTokens,
    0
  )

  const entries = readings.map(({ filing, raw }) => {
    const divisionAnswer = raw.root.answers.division
    // Options given zero weight are dropped; the live API returns all of
    // them, and keeping every zero here would bury the signal in the file.
    const divisionProbabilities = Object.entries(divisionAnswer.probabilities)
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([code, p]) => `        ${JSON.stringify(code)}: ${p}`)
      .join(",\n")

    const groupEntries = raw.topDivisions.map(([division]) => {
      const groupAnswer = raw.level2.answers[groupQuestionName(division)]!
      const groupProbabilities = Object.entries(groupAnswer.probabilities)
        .filter(([, p]) => p > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([code, p]) => `          ${JSON.stringify(code)}: ${p}`)
        .join(",\n")
      return `      ${JSON.stringify(division)}: {
        probabilities: {
${groupProbabilities}
        },
        confidence: ${groupAnswer.confidence}
      }`
    }).join(",\n")

    return `  ${JSON.stringify(filing.id)}: {
    division: {
      probabilities: {
${divisionProbabilities}
      },
      confidence: ${divisionAnswer.confidence}
    },
    groups: {
${groupEntries}
    },
    usage: {
      root: { inputTokens: ${raw.root.usage.inputTokens}, outputTokens: ${raw.root.usage.outputTokens} },
      level2: { inputTokens: ${raw.level2.usage.inputTokens}, outputTokens: ${raw.level2.usage.outputTokens} }
    }
  }`
  })

  const source = `/**
 * Hierarchical readings recorded from the live System One API: for each
 * filing, the root division answer and the level-2 group answer for every
 * division the root retained (\`beamWidth\` of them).
 *
 * Recorded ${new Date().toISOString().slice(0, 10)} from ${model}. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/hierarchy/record.ts
 *
 * Options a division or group answer gave zero weight to are omitted; the
 * live API returns the full distribution across every option offered. A
 * single recording is one draw from a distribution, not a measurement.
 */
import type { DivisionCode, GroupCode } from "../sic.js"

export interface Reading<Code extends string> {
  readonly probabilities: Partial<Record<Code, number>>
  readonly confidence: number
}

export interface FilingRecording {
  readonly division: Reading<DivisionCode>
  /** Keyed by division code — one entry per division the root retained. */
  readonly groups: { readonly [division: string]: Reading<GroupCode> }
  readonly usage: {
    readonly root: { readonly inputTokens: number; readonly outputTokens: number }
    readonly level2: { readonly inputTokens: number; readonly outputTokens: number }
  }
}

/** How many divisions were retained after the root request, when this was recorded. */
export const beamWidth = ${defaultBeamWidth}

export const recordedModel = ${JSON.stringify(model)}

export const recorded: { readonly [id: string]: FilingRecording } = {
${entries.join(",\n")}
}
`

  yield* Effect.promise(() => Bun.write(`${import.meta.dir}/recorded.ts`, source))
  yield* Console.log(
    `recorded ${readings.length} filings × 2 requests from ${model} (${totalTokens} tokens)`
  )
  for (const { filing, raw } of readings) {
    const top = raw.topDivisions[0]!
    yield* Console.log(`  ${filing.id.padEnd(17)} top division ${top[0]} (${(top[1] * 100).toFixed(0)}%)`)
  }
})

await Effect.runPromise(Effect.provide(captured, SystemOne.layerFetch()))
