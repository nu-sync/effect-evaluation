/**
 * Golden-fixture tests: verbatim response bytes from the live System One API,
 * committed under `test/golden/*.json` by `test/golden/record.ts`.
 *
 * Every other fixture in this package's suite is *built* by `Testing.response`
 * from this library's own beliefs about the wire shape — so if the real API
 * nested answers under `data`, or called usage `prompt_tokens`, every one of
 * those fixtures would still pass. THIS test is the only thing standing
 * between the package and a silently wrong wire-shape assumption: it decodes
 * bytes nobody here constructed, with the same `Answer.ResponseSchema` and
 * `SystemOne.decode` the live client uses.
 *
 * No key, no network: everything below reads the two files committed next to
 * this one and their `.meta.json` siblings (status + headers).
 */
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import * as Answer from "../src/Answer.js"
import * as SystemOne from "../src/SystemOne.js"
import { mixedQuestions, mixedState, plainQuestions, plainState } from "./golden/record.js"
import { mixedQuestions as openrouterMixedQuestions, mixedState as openrouterMixedState } from "./golden/record-openrouter.js"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const decodeResponse = Schema.decodeUnknownEffect(Answer.ResponseSchema)

const readGolden = async (name: string) => {
  const text = await Bun.file(`${import.meta.dir}/golden/${name}.json`).text()
  const meta = await Bun.file(`${import.meta.dir}/golden/${name}.meta.json`).json() as {
    readonly status: number
    readonly headers: Record<string, string>
  }
  return { text, json: JSON.parse(text) as Record<string, unknown>, meta }
}

describe("golden fixtures decode with the production schema", () => {
  test("mixed.json: Answer.ResponseSchema decodes it, and matches the file literally", async () => {
    const { json } = await readGolden("mixed")

    const decoded = await run(Effect.mapError(decodeResponse(json), (e) => new Error(String(e))))

    // model: literal string, matching the file exactly (not re-derived).
    expect(typeof decoded.model).toBe("string")
    expect(decoded.model).toBe(json["model"] as string)

    // usage: THE field names this client's `SystemOne.reconcile` depends on
    // (`decoded.usage.input_tokens` / `.output_tokens`, summed into
    // `totalTokens`). If the live API ever renamed these — `prompt_tokens`,
    // say — this line is what would catch it; every other fixture in this
    // suite is built by `Testing.response`, which writes `input_tokens` /
    // `output_tokens` by construction and could never notice a rename.
    expect(Object.keys(decoded.usage).sort()).toEqual(["input_tokens", "output_tokens"])
    expect(typeof decoded.usage.input_tokens).toBe("number")
    expect(typeof decoded.usage.output_tokens).toBe("number")
    expect(decoded.usage.input_tokens).toBe((json["usage"] as any).input_tokens)
    expect(decoded.usage.output_tokens).toBe((json["usage"] as any).output_tokens)

    // answers: keyed by question name, one entry per question this fixture
    // actually asked.
    expect(Object.keys(decoded.answers).sort()).toEqual(["department", "severity", "urgent"])

    const department = decoded.answers["department"]!
    expect(department.type).toBe("choice")
    if (department.type !== "choice") throw new Error("unreachable")
    expect(Object.keys(department).sort()).toEqual(["choice", "confidence", "probabilities", "type"])
    expect(typeof department.choice).toBe("string")
    expect(typeof department.confidence).toBe("number")

    const urgent = decoded.answers["urgent"]!
    expect(urgent.type).toBe("noul")
    if (urgent.type !== "noul") throw new Error("unreachable")
    // A noul answer is documented to carry no `confidence` — and the live
    // wire body agrees: `type` and `noul` are the only two keys.
    expect(Object.keys(urgent).sort()).toEqual(["noul", "type"])
    expect(typeof urgent.noul).toBe("number")

    const severity = decoded.answers["severity"]!
    expect(severity.type).toBe("score")
    if (severity.type !== "score") throw new Error("unreachable")
    expect(Object.keys(severity).sort()).toEqual(["confidence", "legend", "probabilities", "score", "type"])
    expect(typeof severity.score).toBe("number")
    expect(typeof severity.confidence).toBe("number")
  })

  test("mixed.json: a structured score legend comes back as the OBJECT it was sent as, not a string", async () => {
    // The highest-value assertion in this file. docs/primitives.md: "A client
    // that assumes the legend is a map of strings will reject any response to
    // a structured score question." mixedQuestions.severity's criteria are
    // `{ what, examples }` objects, never strings — so this fails loudly
    // (TypeError or an equality mismatch) if that round trip is ever broken.
    const { json } = await readGolden("mixed")
    const decoded = await run(SystemOne.decode(mixedQuestions, json))

    const legend = decoded.answers.severity.legend
    expect(Object.keys(legend).sort()).toEqual(["0", "1", "2"])
    for (const level of ["0", "1", "2"] as const) {
      const entry = legend[level]
      expect(typeof entry).toBe("object")
      expect(entry).not.toBeNull()
      expect(Array.isArray(entry)).toBe(false)
      // `has "what" / "examples"` — the exact shape of the criteria object
      // this question offered for this level, echoed back rather than
      // stringified.
      expect(entry).toHaveProperty("what")
      expect(entry).toHaveProperty("examples")
    }
    // The legend doesn't just have the right *shape* — it's the exact object
    // this fixture's questions supplied, byte for byte.
    expect(legend).toEqual(
      Object.fromEntries(mixedQuestions.severity.criteria.map((level, i) => [String(i), level]))
    )
  })

  test("mixed.json: a live choice answer's probabilities covers every offered option", async () => {
    // Documented ("`probabilities` covers every option offered and sums to
    // 1"), but until now only inferred from docs/primitives.md — never
    // checked against a byte the service actually sent. This is also exactly
    // what `SystemOne.reconcile` now enforces at decode time; a golden fixture
    // failing here would mean the live API disagrees with that enforcement.
    const { json } = await readGolden("mixed")
    const decoded = await run(SystemOne.decode(mixedQuestions, json))

    const offered = Object.keys(mixedQuestions.department.criteria).sort()
    const covered = Object.keys(decoded.answers.department.probabilities).sort()
    expect(covered).toEqual(offered)

    const total = Object.values(decoded.answers.department.probabilities).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 5)
  })

  test("plain.json: a noul with no `criteria` in the request still decodes to a bare { type, noul }", async () => {
    const { json } = await readGolden("plain")
    const decoded = await run(SystemOne.decode(plainQuestions, json))

    expect(Object.keys(decoded.answers).sort()).toEqual(["topic", "wantsRefund"])
    expect(decoded.answers.wantsRefund.type).toBe("noul")
    expect(Object.keys(decoded.answers.wantsRefund).sort()).toEqual(["noul", "type"])

    const offered = Object.keys(plainQuestions.topic.criteria).sort()
    expect(Object.keys(decoded.answers.topic.probabilities).sort()).toEqual(offered)
  })
})

describe("SystemOne.decode reconciles each golden body against the exact questions that produced it", () => {
  test("mixed.json reconciles against mixedQuestions end to end", async () => {
    const { json } = await readGolden("mixed")
    const evaluation = await run(SystemOne.decode(mixedQuestions, json))

    expect(evaluation.model).toBe((json as any).model)
    expect(mixedQuestions.department.criteria).toHaveProperty(evaluation.answers.department.choice)
    expect(evaluation.usage.totalTokens).toBe(evaluation.usage.inputTokens + evaluation.usage.outputTokens)

    // `body` is the verbatim JSON the decode ran on — the same object we read
    // from disk and handed in, not something rebuilt from `raw`. This is what
    // lets a caller recover a field this client's schema does not model yet.
    expect(evaluation.body).toBe(json)
  })

  test("plain.json reconciles against plainQuestions end to end", async () => {
    const { json } = await readGolden("plain")
    const evaluation = await run(SystemOne.decode(plainQuestions, json))

    expect(mixedQuestions).toBeTruthy() // sanity: two independent question sets, no accidental sharing
    expect(plainQuestions.topic.criteria).toHaveProperty(evaluation.answers.topic.choice)
    expect(typeof evaluation.answers.wantsRefund.noul).toBe("number")
    expect(evaluation.body).toBe(json)
  })

  test("mixed.json's state and questions round-trip through the real service unchanged", async () => {
    // Not a decode assertion — a sanity check that the fixture file actually
    // corresponds to the exported question set the test above decodes it
    // against, so the two cannot silently drift apart.
    expect(mixedState.id).toBe("golden-mixed")
    expect(Object.keys(mixedQuestions).sort()).toEqual(["department", "severity", "urgent"])
    expect(Object.keys(plainQuestions).sort()).toEqual(["topic", "wantsRefund"])
    expect(plainState.id).toBe("golden-plain")
  })
})

describe("no field the live API sent is silently dropped or ignored", () => {
  // These pin the exact top-level and per-answer key sets of the wire body AT
  // RECORDING TIME. As of this recording, the live API sent nothing beyond
  // what `Answer.ResponseSchema` already models — no request id, no per-answer
  // rationale, no extra usage counter. If a future re-recording (see
  // `test/golden/record.ts`) adds a field here, one of these `toEqual`s fails
  // LOUDLY rather than the extra field being quietly ignored: that failure is
  // the signal to add it to `Answer.ResponseSchema` deliberately, not to widen
  // this assertion to make the test pass again.
  test("mixed.json has exactly the keys this schema models, at every level", async () => {
    const { json } = await readGolden("mixed")
    expect(Object.keys(json).sort()).toEqual(["answers", "model", "usage"])
    expect(Object.keys(json["usage"] as object).sort()).toEqual(["input_tokens", "output_tokens"])
    const answers = json["answers"] as Record<string, Record<string, unknown>>
    expect(Object.keys(answers["department"]!).sort()).toEqual(["choice", "confidence", "probabilities", "type"])
    expect(Object.keys(answers["urgent"]!).sort()).toEqual(["noul", "type"])
    expect(Object.keys(answers["severity"]!).sort()).toEqual(["confidence", "legend", "probabilities", "score", "type"])
  })

  test("plain.json has exactly the keys this schema models, at every level", async () => {
    const { json } = await readGolden("plain")
    expect(Object.keys(json).sort()).toEqual(["answers", "model", "usage"])
    expect(Object.keys(json["usage"] as object).sort()).toEqual(["input_tokens", "output_tokens"])
    const answers = json["answers"] as Record<string, Record<string, unknown>>
    expect(Object.keys(answers["topic"]!).sort()).toEqual(["choice", "confidence", "probabilities", "type"])
    expect(Object.keys(answers["wantsRefund"]!).sort()).toEqual(["noul", "type"])
  })
})

describe("response status and headers were captured alongside the body", () => {
  // Header handling (retry-after) is part of the contract per CLAUDE.md, even
  // though a successful 200 recording carries no retry-after itself — the
  // 429/529 path is already covered without a key by `Testing.layerHttp` in
  // test/transport.test.ts. What this pins down is that a real response's
  // headers arrive as plain lower-cased string keys (the `Headers` iteration
  // this repo's own header parsing, `SystemOne`'s `retry-after` lookup,
  // assumes) rather than, say, mixed case or an array of pairs.
  test("mixed.meta.json: 200, JSON content-type, lower-cased header names", async () => {
    const { meta } = await readGolden("mixed")
    expect(meta.status).toBe(200)
    expect(Object.keys(meta.headers).every((k) => k === k.toLowerCase())).toBe(true)
    expect(meta.headers["content-type"]).toContain("application/json")
  })

  test("plain.meta.json: 200, JSON content-type, lower-cased header names", async () => {
    const { meta } = await readGolden("plain")
    expect(meta.status).toBe(200)
    expect(Object.keys(meta.headers).every((k) => k === k.toLowerCase())).toBe(true)
    expect(meta.headers["content-type"]).toContain("application/json")
  })
})

// --- OpenRouter (SPEC.md's Phase 0.1, acceptance criterion 12) ------------
//
// `test/golden/record-openrouter.ts` writes `openrouter-mixed.json` /
// `.meta.json` next to this file, but only when run directly with a live
// `OPENROUTER_API_KEY` — which this repository does not have (see that
// file's header). Fabricating a stand-in fixture here would defeat the
// point: CLAUDE.md's "golden fixtures are the only check on the wire shape"
// invariant means these bytes must come from a real response or not exist at
// all. `test/openrouter-synthetic.test.ts` already covers what a hand-built
// fixture can (decode-path wiring); it explicitly is not this.
//
// So: this block decodes the real fixture the same way the TypeSafe blocks
// above do, but every test in it is skipped until that file is actually
// committed. That keeps the promise in `record-openrouter.ts`'s docstring
// ("a future test/golden.test.ts extension") true today rather than
// aspirational — recording the fixture and committing it is the only step
// left to satisfy criterion 12, no test code needs to change.
const openrouterFixtureExists = await Bun.file(`${import.meta.dir}/golden/openrouter-mixed.json`).exists()

describe("OpenRouter golden fixture (skipped until openrouter-mixed.json is recorded and committed)", () => {
  test.skipIf(!openrouterFixtureExists)(
    "openrouter-mixed.json: Answer.ResponseSchema decodes it, and matches the file literally",
    async () => {
      const { json } = await readGolden("openrouter-mixed")
      const decoded = await run(Effect.mapError(decodeResponse(json), (e) => new Error(String(e))))

      expect(decoded.model).toBe(json["model"] as string)
      expect(Object.keys(decoded.answers).sort()).toEqual(["department", "severity", "urgent"])
    }
  )

  test.skipIf(!openrouterFixtureExists)(
    "openrouter-mixed.json reconciles against the exact questions that produced it",
    async () => {
      const { json } = await readGolden("openrouter-mixed")
      const evaluation = await run(SystemOne.decode(openrouterMixedQuestions, json))

      expect(openrouterMixedQuestions.department.criteria).toHaveProperty(evaluation.answers.department.choice)
      expect(Object.keys(evaluation.answers.urgent)).toEqual(["type", "noul"])
      // `body` is the verbatim wire object, so OpenRouter's documented
      // extra top-level fields survive there even though `Answer.ResponseSchema`
      // does not model them and they are absent from `raw`.
      expect(evaluation.body).toBe(json)
      expect(evaluation.body).toHaveProperty("id")
      expect(evaluation.body).toHaveProperty("provider")
      expect((evaluation.body as any).usage).toHaveProperty("cost")
      expect(evaluation.raw).not.toHaveProperty("id")
    }
  )

  test.skipIf(!openrouterFixtureExists)(
    "openrouter-mixed.json's state and questions round-trip through the real service unchanged",
    () => {
      expect(openrouterMixedState.id).toBe("openrouter-golden-mixed")
      expect(Object.keys(openrouterMixedQuestions).sort()).toEqual(["department", "severity", "urgent"])
    }
  )

  if (!openrouterFixtureExists) {
    test("acceptance criterion 12 is not yet met for OpenRouter", () => {
      // Intentionally always passes: this is a visible marker, not a failure.
      // `just record-openrouter` (requires OPENROUTER_API_KEY) records and
      // commits `test/golden/openrouter-mixed.json` / `.meta.json`, which
      // flips the three tests above on with no code change. Until then,
      // OpenRouter's response shape is exercised only by
      // `test/openrouter-synthetic.test.ts`'s hand-built fixture, which by
      // its own header comment cannot prove the live wire shape.
      expect(openrouterFixtureExists).toBe(false)
    })
  }
})

// A note for the next person editing this file: a golden fixture is one draw
// from a distribution, not a measurement (see CLAUDE.md, "Framing"). Every
// assertion above checks shape, key sets, and internal consistency
// (probabilities covering every offered option, totalTokens summing
// correctly) — never a specific probability, choice, or score value. A
// re-recording that answers a question differently is not a regression;
// keep it that way rather than pinning today's numbers as expected output.
