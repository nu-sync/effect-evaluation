/**
 * Hierarchical classification — CLI.
 *
 * A replication of TypeSafe's cookbook of the same name:
 * https://docs.typesafe.ai/cookbooks/hierarchical_classification
 *
 * `examples/classification.ts` offers all 60 SIC groups flat, in one Choice.
 * This walks the same taxonomy division → group instead, two ways:
 *
 *   - greedy takes the top child at each level.
 *   - beam search keeps the best `K` paths (default 3), batching the group
 *     question for every retained division into one request per level.
 *
 * Same taxonomy, same filings, three strategies read side by side — which is
 * the only way to see what keeping more than the single best guess buys you
 * (or doesn't): a distribution that beam search reads and the flat and greedy
 * strategies both discard the moment they pick a winner.
 *
 * Runs offline against fixtures by default. Set TYPESAFE_API_KEY to run the
 * hierarchical requests against the live service (the flat baseline is always
 * replayed from `examples/recorded.ts` — see `search.ts`'s module doc for why
 * re-requesting it would just repeat a request the other demo already made):
 *
 *   bun run examples/hierarchy/cli.ts
 */
import { Console, Effect } from "effect"
import { type Filing, filings } from "../filings.js"
import { divisionOf, divisions, type GroupCode, groupName } from "../sic.js"
import { recordedModel } from "./recorded.js"
import {
  beamPaths,
  clientLayer,
  defaultBeamWidth,
  type FilingReading,
  flatReading,
  greedyPath,
  isLive,
  readFiling
} from "./search.js"
import { type CandidatePath, isCorrect, separation } from "./tree.js"

const pad = (value: string, width: number) => value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width)
const pct = (value: number) => `${(value * 100).toFixed(0)}%`

const pathLabel = (path: CandidatePath) => `${path.divisionCode}→${path.groupCode}`

const mark = (correct: boolean) => correct ? "✓" : "✕"

interface Row {
  readonly filing: Filing
  readonly model: string
  readonly flatGroup: GroupCode
  readonly flatConfidence: number
  readonly reading: FilingReading
  readonly greedy: CandidatePath
  readonly beam: ReadonlyArray<CandidatePath>
}

const run = (filing: Filing) =>
  Effect.gen(function*() {
    const flat = yield* flatReading(filing)
    const reading = yield* readFiling(filing, defaultBeamWidth)
    const greedy = greedyPath(reading)
    const beam = beamPaths(reading, defaultBeamWidth)
    const row: Row = {
      filing,
      model: reading.model,
      flatGroup: flat.choice,
      flatConfidence: flat.confidence,
      reading,
      greedy,
      beam
    }
    return row
  })

const report = (rows: ReadonlyArray<Row>) =>
  Effect.gen(function*() {
    yield* Console.log("")
    yield* Console.log(
      pad("FILING", 17) + pad("FLAT", 22) + pad("GREEDY", 26) + pad("BEAM BEST", 26) + "SEPARATION"
    )
    yield* Console.log("-".repeat(108))
    for (const row of rows) {
      const best = row.beam[0]!
      const sep = separation(row.beam)
      yield* Console.log(
        pad(row.filing.id, 17) +
          pad(`${row.flatGroup} ${mark(row.flatGroup === row.filing.expected)} ${pct(row.flatConfidence)}`, 22) +
          pad(`${pathLabel(row.greedy)} ${mark(isCorrect(row.greedy, row.filing.expected))}`, 26) +
          pad(`${pathLabel(best)} ${mark(isCorrect(best, row.filing.expected))}`, 26) +
          (sep === undefined ? "n/a" : sep.toFixed(2))
      )
    }

    yield* Console.log("")
    yield* Console.log(`Expected label, for reference: ${rows.map((r) => `${r.filing.id}=${r.filing.expected}`).join("  ")}`)

    const agree = (strategy: (row: Row) => boolean) => rows.filter(strategy).length
    yield* Console.log("")
    yield* Console.log(
      `Matches the human label — flat ${agree((r) => r.flatGroup === r.filing.expected)}/${rows.length}` +
        `, greedy ${agree((r) => isCorrect(r.greedy, r.filing.expected))}/${rows.length}` +
        `, beam ${agree((r) => isCorrect(r.beam[0]!, r.filing.expected))}/${rows.length}`
    )
    yield* Console.log(
      `${rows.length} filings is an illustration, not a benchmark — this is not evidence beam search is better in`
    )
    yield* Console.log(
      "general. The cookbook's own four examples illustrate recovery from an early mistake, not accuracy at scale."
    )

    const diverged = rows.filter((r) => pathLabel(r.greedy) !== pathLabel(r.beam[0]!))
    yield* Console.log("")
    if (diverged.length === 0) {
      yield* Console.log(
        "Greedy and beam search picked the same leaf on every one of these filings — there is no recovery case"
      )
      yield* Console.log(
        "to show here. That is a property of this small, recorded set of filings, not a claim that beam search"
      )
      yield* Console.log("never diverges from greedy elsewhere.")
    } else {
      yield* Console.log(`Where greedy and beam disagreed (${diverged.length} of ${rows.length}):`)
      for (const row of diverged) {
        yield* Console.log("")
        yield* Console.log(`  ${row.filing.id} — expected ${row.filing.expected} (${row.filing.note})`)
        yield* Console.log(
          `    root: ${row.reading.divisions.map(([code, p]) => `${code} ${pct(p)}`).join("  ")}`
        )
        const describe = (label: string, path: CandidatePath) =>
          Console.log(
            `    ${label}: ${divisions[path.divisionCode]} (${pct(path.edges[0].probability)}) → ` +
              `${groupName(path.groupCode)} (${pct(path.edges[1].probability)})` +
              ` — score ${path.score.toFixed(3)} ${mark(isCorrect(path, row.filing.expected))}`
          )
        yield* describe("greedy", row.greedy)
        yield* describe("beam  ", row.beam[0]!)
        // Greedy commits to the root's single strongest division and never
        // looks at any other division's groups. Beam search asked about every
        // retained division's groups in the batch, so it can surface a path
        // through a division the root ranked lower — recovering from an early
        // guess exactly where the taxonomy asks a company to choose one
        // division when its filing describes operations that span several
        // (see filings.ts's own notes on HARBORLIGHT, MERIDIAN-GROUP,
        // CASCADE-MILLS, and TIDEWATER-FOODS — the cases built to have this
        // property).
        if (row.greedy.divisionCode !== row.beam[0]!.divisionCode) {
          yield* Console.log(
            `    beam recovered through a different division (${divisionOf(row.beam[0]!.groupCode)}) than the root's top pick (${row.reading.divisions[0]![0]})`
          )
        }
      }
    }

    // Greedy and beam agreeing on a final pick is not the only place the
    // extra candidates matter: when that shared pick is wrong, beam search
    // still asked about every retained division's groups, so the expected
    // label may be sitting right there in `candidates` — outranked, but not
    // discarded the way greedy's single path would have discarded it. This is
    // the more general form of the claim docs/hierarchical_classification.md
    // makes: keeping candidates is what makes an early miss *diagnosable*,
    // whether or not this particular search recovers from it automatically.
    const wrong = rows.filter((r) => !isCorrect(r.beam[0]!, r.filing.expected))
    yield* Console.log("")
    if (wrong.length === 0) {
      yield* Console.log("Every filing's top beam pick matched the expected label, so there is nothing to recover here either.")
    } else {
      yield* Console.log(`Where the top pick missed (${wrong.length} of ${rows.length}) — was the expected label still among the candidates considered?`)
      for (const row of wrong) {
        const ranked = beamPaths(row.reading, row.reading.candidates.length)
        const rank = ranked.findIndex((c) => isCorrect(c, row.filing.expected))
        if (rank === -1) {
          yield* Console.log(
            `  ${pad(row.filing.id, 17)} ${row.filing.expected} was not among the candidates — its division wasn't one of the top ${defaultBeamWidth} the root retained`
          )
        } else {
          const found = ranked[rank]!
          yield* Console.log(
            `  ${pad(row.filing.id, 17)} ${row.filing.expected} ranked #${
              rank + 1
            } of ${ranked.length} candidates (score ${found.score.toFixed(3)} vs winner ${ranked[0]!.score.toFixed(3)}) — ` +
              "present, but outranked, not absent"
          )
        }
      }
      yield* Console.log(
        "Being outranked, not absent, is what a wider K or a human reviewing the shortlist could act on — this demo"
      )
      yield* Console.log("does not act on it automatically, and doing so is not shown to help in general.")
    }

    const tokens = rows.reduce((total, r) => total + r.reading.usage.totalTokens, 0)
    yield* Console.log("")
    yield* Console.log(
      `${rows.length} filings × 2 hierarchical requests (root + batched level-${defaultBeamWidth} group) · ` +
        `${tokens} tokens · answered by ${rows[0]?.model ?? recordedModel}.`
    )
    yield* Console.log(
      "The flat baseline cost nothing here — it is decoded from examples/recorded.ts, made for the other demo."
    )
    yield* Console.log(
      "Re-scoring any of this — greedy, beam, or a different K — costs nothing either: the distributions are already in hand."
    )
  })

const main = Effect.gen(function*() {
  const live = yield* isLive
  yield* Console.log(live ? "LIVE — requesting from the TypeSafe API" : "REPLAY — no TYPESAFE_API_KEY configured, replaying recorded responses")
  const rows = yield* Effect.forEach(filings, run, { concurrency: 4 })
  yield* report(rows)
})

Effect.runPromise(main.pipe(Effect.provide(clientLayer))).catch((error) => {
  console.error(error)
  process.exit(1)
})
