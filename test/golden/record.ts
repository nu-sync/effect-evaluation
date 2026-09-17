/**
 * Records golden fixtures: verbatim response bytes from the live System One
 * API, committed to `test/golden/*.json` so `test/golden.test.ts` can decode
 * real wire bytes with `Answer.ResponseSchema` and `SystemOne.decode` — no key,
 * no network, every time after this.
 *
 * Every other fixture in this package (`Testing.response`, the recorded demo
 * responses) is *built* from this library's own assumptions about the wire
 * shape. This script is the one place that writes down what the service
 * actually sent, byte for byte, before any decoding touches it: no
 * `JSON.parse` + re-`JSON.stringify` round trip through a decoded object, and
 * no dropped field — an unrecognised field is exactly the thing a golden
 * fixture exists to catch.
 *
 * Recorded 2026-09-17 from whatever `jev-latest` resolved to that day (see
 * the `model` field inside each committed file — do not hand-edit it).
 * Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run test/golden/record.ts
 *
 * This makes exactly two live requests. It refuses to run without a key, so a
 * golden fixture can never be produced from a fixture. The two requests are
 * deliberately mixed:
 *
 * - `mixed`: a `choice` with four options, a `noul` whose `criteria.true` /
 *   `criteria.false` are structured objects (not strings), and a `score`
 *   whose levels are structured objects (`{ what, examples }`) — the
 *   structured-entry round trip docs/primitives.md warns a naive client would
 *   reject.
 * - `plain`: a `choice` with plain string options and a `noul` with no
 *   `criteria` at all, to pin the case where the optional field is genuinely
 *   absent from both the request and (per the docs) irrelevant to the answer.
 *
 * The question sets below are exported so the test imports them instead of
 * retyping them — recorder and test can't drift apart on what was actually
 * asked.
 */
import { Config, Effect, Option, Redacted } from "effect"
import { Question, SystemOne } from "../../src/index.js"

/** A blank `TYPESAFE_API_KEY=` counts as absent, same as the rest of this repo. */
const configuredKey = (name: string) =>
  Effect.map(Config.option(Config.Redacted(name)), (key) =>
    Option.isSome(key)
      ? Option.filter(Option.some(Redacted.value(key.value).trim()), (s) => s.length > 0)
      : Option.none<string>())

const apiKey = Effect.gen(function*() {
  const primary = yield* configuredKey("TYPESAFE_API_KEY")
  if (Option.isSome(primary)) return primary.value
  const secondary = yield* configuredKey("TYPESAFE_AI_API_KEY")
  if (Option.isSome(secondary)) return secondary.value
  return yield* Effect.die(
    new Error(
      "no TYPESAFE_API_KEY (or TYPESAFE_AI_API_KEY) set — recording golden fixtures requires the live API"
    )
  )
})

// --- The two requests -------------------------------------------------

export const mixedState = {
  id: "golden-mixed",
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

export const plainState = {
  id: "golden-plain",
  message: "Can I get a refund for my order? It arrived a day late and the box was crushed."
}

export const plainQuestions = {
  topic: Question.choice({
    instructions: "What is this message mainly about?",
    criteria: {
      billing: "Payments, charges, or refunds",
      shipping: "Delivery, tracking, or package condition",
      other: "Anything else"
    }
  }),
  // Deliberately no `criteria` — the field is optional, and a golden fixture
  // should pin the case where it's genuinely absent from the wire request too.
  wantsRefund: Question.noul({
    instructions: "Is the customer asking for money back?"
  })
}

// --- The recorder -------------------------------------------------

const dir = import.meta.dir

const record = (name: string, state: unknown, questions: unknown) =>
  Effect.gen(function*() {
    const key = yield* apiKey
    const url = `${SystemOne.defaultBaseUrl.replace(/\/+$/, "")}/systemone`
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({ state, model: SystemOne.defaultModel, questions })
        }),
      catch: (cause) => new Error(`request for ${JSON.stringify(name)} failed in transport: ${String(cause)}`)
    })

    // The raw bytes, read BEFORE any JSON.parse or schema decode — this is
    // what "verbatim" means. Written to disk exactly as received, no
    // reformatting, so no risk of `JSON.parse`/`JSON.stringify` normalizing a
    // number (e.g. `0.90` -> `0.9`) and quietly hiding what the wire actually
    // sent.
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
    [
      { name: "mixed", state: mixedState, questions: mixedQuestions },
      { name: "plain", state: plainState, questions: plainQuestions }
    ],
    ({ name, questions, state }) => record(name, state, questions),
    { concurrency: 1 }
  )
  for (const r of results) {
    console.log(`  recorded ${r.name.padEnd(6)} HTTP ${r.status}  ${r.bytes} bytes -> test/golden/${r.name}.json`)
  }
  console.log(`\nrecorded ${results.length} golden fixtures.`)
})

// Guarded so `test/golden.test.ts` can import the question sets and states
// above (to decode against exactly what produced these fixtures) without
// firing a live request on every test run — only running this file directly
// records.
if (import.meta.main) {
  await Effect.runPromise(program)
}
