/**
 * Guardrails for LLMs — CLI.
 *
 * Replicates TypeSafe's cookbook: one request per message carrying four hazard
 * nouls and a severity score, then a policy that turns those probabilities into
 * pass / review / block / support.
 *
 * The same readings are run through all three policies, because that is the
 * point the cookbook makes: detection and policy are different things, and only
 * one of them costs a request.
 *
 *   bun run examples/guardrails/cli.ts
 */
import { Console, Effect } from "effect"
import { type Message, messages } from "./messages.js"
import { type Action, clientLayer, type Policy, policies, type Reading, route, screen } from "./policy.js"
import { recorded, recordedModel } from "./recorded.js"

const pad = (value: string, width: number) =>
  value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width)

const glyph: Record<Action, string> = {
  pass: "·  pass",
  review: "?  review",
  block: "✕  block",
  support: "♥  support"
}

const report = (results: ReadonlyArray<{ message: Message; reading: Reading }>) =>
  Effect.gen(function*() {
    const balanced = policies.find((p) => p.name === "balanced")!

    yield* Console.log("")
    yield* Console.log(
      pad("MESSAGE", 26) + pad("JAIL", 6) + pad("HARM", 6) + pad("MED", 6) + pad("CRISIS", 8) +
        pad("SEV", 6) + pad("BALANCED", 12) + "EXPECTED"
    )
    yield* Console.log("-".repeat(88))
    for (const { message, reading } of results) {
      const decision = route(reading, balanced)
      yield* Console.log(
        pad(message.id, 26) +
          pad(reading.jailbreak.toFixed(2), 6) +
          pad(reading.harmful.toFixed(2), 6) +
          pad(reading.medical.toFixed(2), 6) +
          pad(reading.distress.toFixed(2), 8) +
          pad(reading.severity.toFixed(2), 6) +
          pad(glyph[decision.action], 12) +
          (decision.action === message.expected ? "—" : `expected ${message.expected}`)
      )
    }

    yield* Console.log("")
    yield* Console.log("The same readings under all three policies — no further requests:")
    yield* Console.log("")
    yield* Console.log(
      pad("MESSAGE", 26) + policies.map((p) => pad(p.name, 12)).join("")
    )
    yield* Console.log("-".repeat(88))
    for (const { message, reading } of results) {
      yield* Console.log(
        pad(message.id, 26) +
          policies.map((policy) => pad(glyph[route(reading, policy).action], 12)).join("")
      )
    }

    yield* Console.log("")
    for (const policy of policies) {
      const counts = results.reduce<Record<Action, number>>(
        (acc, { reading }) => {
          const action = route(reading, policy).action
          return { ...acc, [action]: acc[action] + 1 }
        },
        { pass: 0, review: 0, block: 0, support: 0 }
      )
      const agreed = results.filter(({ message, reading }) =>
        route(reading, policy).action === message.expected
      ).length
      yield* Console.log(
        `  ${pad(policy.name, 12)} pass ${counts.pass}  review ${counts.review}  block ${counts.block}  support ${counts.support}   ` +
          `agrees with the human label on ${agreed}/${results.length}`
      )
    }

    yield* Console.log("")
    yield* Console.log(
      `${results.length} messages is an illustration, not an evaluation. The thresholds are examples,`
    )
    yield* Console.log(
      "and a battery that passes does not establish that a message is safe."
    )

    const tokens = results.reduce((total, r) => total + r.reading.usage.totalTokens, 0)
    yield* Console.log(
      `\n${results.length} requests · ${tokens} tokens · answered by ${results[0]?.reading.model ?? "?"}.`
    )
    yield* Console.log(
      "Re-routing all of them under a different policy costs nothing: the probabilities are already in hand."
    )
  })

const main = Effect.gen(function*() {
  const results = yield* Effect.forEach(
    messages,
    (message) => Effect.map(screen(message), (reading) => ({ message, reading })),
    { concurrency: 4 }
  )
  yield* report(results)
})

Effect.runPromise(main.pipe(Effect.provide(clientLayer(recorded, recordedModel)))).catch((error) => {
  console.error(error)
  process.exit(1)
})
