/**
 * Records an OpenRouter golden fixture: verbatim response bytes from the
 * live OpenRouter Decisions API, committed to `test/golden/openrouter-*.json`
 * so a future `test/golden.test.ts` extension can decode real OpenRouter wire
 * bytes with `Answer.ResponseSchema` and `SystemOne.decode` — no key, no
 * network, every time after this.
 *
 * Mirrors `test/golden/record.ts` exactly in structure and intent, adapted
 * for the second provider: same "write the raw bytes before any JSON.parse
 * or schema decode" discipline, same refuse-without-a-key guard, same
 * `import.meta.main` gate so this file can be imported (for its exported
 * question sets and state) without ever firing a live request.
 *
 * This is NOT run as part of this change. `OPENROUTER_API_KEY` is not
 * configured in this repository's `.env` — recording real OpenRouter bytes
 * spends live credits, which is the repo owner's call, not an automated
 * workflow's. Once a key is available, recording is:
 *
 *   OPENROUTER_API_KEY=... bun run test/golden/record-openrouter.ts
 *
 * This makes exactly one live request, deliberately mixed to satisfy
 * SPEC.md's "OpenRouter support is not complete until equivalent golden
 * evidence exists" paragraph in one fixture: a `choice` with four options, a
 * `noul` whose `criteria.true`/`criteria.false` are structured objects (not
 * strings, and both sides present — OpenRouter requires both when `criteria`
 * is given at all, see `src/Provider.ts`'s `preflight`), and a `score` whose
 * levels are structured objects. The recorded bytes are expected to carry
 * OpenRouter's documented extra top-level fields (`id`, `provider`) and
 * `usage.cost`, which `Answer.ResponseSchema` does not model and which
 * `test/golden.test.ts`'s TypeSafe fixtures therefore cannot exercise.
 */
import { Config, Effect, Option, Redacted } from "effect"
import { Question } from "../../src/index.js"
import * as Provider from "../../src/Provider.js"

/** A blank `OPENROUTER_API_KEY=` counts as absent, same as the rest of this repo. */
const configuredKey = (name: string) =>
  Effect.map(Config.option(Config.Redacted(name)), (key) =>
    Option.isSome(key)
      ? Option.filter(Option.some(Redacted.value(key.value).trim()), (s) => s.length > 0)
      : Option.none<string>())

const apiKey = Effect.gen(function*() {
  const key = yield* configuredKey("OPENROUTER_API_KEY")
  if (Option.isSome(key)) return key.value
  // Explicit provider selection never falls back to another provider's key
  // (see SPEC.md and `Provider.resolveCredentials`) — a TypeSafe key
  // configured in this repo's `.env` must not silently substitute here.
  return yield* Effect.die(
    new Error("no OPENROUTER_API_KEY set — recording an OpenRouter golden fixture requires the live API")
  )
})

// --- The one request -------------------------------------------------

export const mixedState = {
  id: "openrouter-golden-mixed",
  report:
    "A diner said the fish tasted off and has been vomiting since dinner. They want a refund and are asking whether they should see a doctor."
}

export const mixedQuestions = {
  department: Question.choice({
    instructions: "Which team at the restaurant should first respond to this message?",
    criteria: {
      food_safety: "Illness, contamination, or an allergic reaction linked to food served",
      refunds: "A request for money back with no illness or safety concern",
      reservations: "Booking, seating, or waitlist questions",
      general: "Anything else, including compliments or general feedback"
    }
  }),
  urgent: Question.noul({
    instructions: "Does this message need a same-day response from a manager?",
    criteria: {
      true: {
        what: "Describes a possible foodborne illness or another health risk needing prompt attention",
        examples: ["felt sick after eating here", "went to the ER after dinner"]
      },
      false: {
        what: "A routine matter that can wait for normal handling",
        examples: ["a seating complaint", "a request to change a reservation time"]
      }
    }
  }),
  severity: Question.score({
    instructions: "How severe is the health risk described in this message?",
    criteria: [
      { what: "None. No health complaint of any kind", examples: ["a billing question", "a compliment"] },
      {
        what: "Mild. Discomfort mentioned but no medical attention sought or considered",
        examples: ["felt a bit off after the meal"]
      },
      {
        what: "Serious. Ongoing symptoms, or medical attention sought or considered",
        examples: ["vomiting for hours", "asking whether to see a doctor"]
      }
    ]
  })
}

// --- The recorder -------------------------------------------------

const dir = import.meta.dir

const record = (name: string, state: unknown, questions: unknown) =>
  Effect.gen(function*() {
    const key = yield* apiKey
    const url = Provider.buildUrl("openrouter")
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({ state, model: Provider.providers.openrouter.defaultModel, questions })
        }),
      catch: (cause) => new Error(`request for ${JSON.stringify(name)} failed in transport: ${String(cause)}`)
    })

    // The raw bytes, read BEFORE any JSON.parse or schema decode — this is
    // what "verbatim" means. Written to disk exactly as received, no
    // reformatting, so no risk of `JSON.parse`/`JSON.stringify` normalizing a
    // number and quietly hiding what the wire actually sent.
    const text = yield* Effect.promise(() => response.text())

    if (!response.ok) {
      return yield* Effect.die(
        new Error(`recording ${JSON.stringify(name)} got HTTP ${response.status}, expected 2xx. Body: ${text}`)
      )
    }

    const headers: Record<string, string> = {}
    response.headers.forEach((value, headerName) => {
      headers[headerName] = value
    })
    const meta = JSON.stringify({ status: response.status, headers }, null, 2) + "\n"

    yield* Effect.promise(() => Bun.write(`${dir}/${name}.json`, text))
    yield* Effect.promise(() => Bun.write(`${dir}/${name}.meta.json`, meta))

    return { name, status: response.status, bytes: text.length }
  })

const program = Effect.gen(function*() {
  const results = yield* Effect.forEach(
    [{ name: "openrouter-mixed", state: mixedState, questions: mixedQuestions }],
    ({ name, questions, state }) => record(name, state, questions),
    { concurrency: 1 }
  )
  for (const r of results) {
    console.log(`  recorded ${r.name.padEnd(16)} HTTP ${r.status}  ${r.bytes} bytes -> test/golden/${r.name}.json`)
  }
  console.log(`\nrecorded ${results.length} OpenRouter golden fixture(s).`)
})

// Guarded exactly like `test/golden/record.ts`, so a future golden test can
// import the question set and state above (to decode against exactly what
// produced the fixture) without firing a live request on every test run —
// only running this file directly records.
if (import.meta.main) {
  await Effect.runPromise(program)
}
