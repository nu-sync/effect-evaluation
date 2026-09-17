/**
 * Regenerates `recorded.ts` from the live API. Refuses to run without a key, so
 * recorded fixtures can never be recorded from fixtures.
 *
 *   TYPESAFE_API_KEY=... bun run examples/guardrails/record.ts
 */
import { Console, Effect } from "effect"
import { SystemOne } from "../../src/index.js"
import { messages } from "./messages.js"
import { isLive, screen } from "./policy.js"

const captured = Effect.gen(function*() {
  if (!(yield* isLive)) {
    return yield* Effect.die(new Error("no TYPESAFE_API_KEY set — recording requires the live API"))
  }

  const readings = yield* Effect.forEach(
    messages,
    (message) => Effect.map(screen(message), (reading) => ({ message, reading })),
    { concurrency: 4 }
  )

  const model = readings[0]?.reading.model ?? "unknown"
  const tokens = readings.reduce((total, r) => total + r.reading.usage.totalTokens, 0)

  const entries = readings.map(({ message, reading }) =>
    `  ${JSON.stringify(message.id)}: {
    jailbreak: ${reading.jailbreak},
    harmful: ${reading.harmful},
    medical: ${reading.medical},
    distress: ${reading.distress},
    severity: ${reading.severity},
    severityConfidence: ${reading.severityConfidence},
    usage: { totalTokens: ${reading.usage.totalTokens} },
    model: ${JSON.stringify(reading.model)}
  }`
  )

  const source = `/**
 * Guardrail readings recorded from the live System One API, so the offline demo
 * shows what the model actually did rather than what someone assumed it would.
 *
 * Recorded ${new Date().toISOString().slice(0, 10)} from ${model}. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/guardrails/record.ts
 *
 * One recording is a single draw, not a measurement. Probabilities near a
 * threshold will not land on the same side every time.
 */
import type { Reading } from "./policy.js"

export const recordedModel = ${JSON.stringify(model)}

export const recorded: { readonly [id: string]: Reading } = {
${entries.join(",\n")}
}
`

  yield* Effect.promise(() => Bun.write(`${import.meta.dir}/recorded.ts`, source))
  yield* Console.log(`recorded ${readings.length} screenings from ${model} (${tokens} tokens)`)
})

await Effect.runPromise(Effect.provide(captured, SystemOne.layerFetch()))
