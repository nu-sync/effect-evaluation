/**
 * Splits the frozen `SPEC.md` snapshot into windows and line clauses.
 *
 * Replicates the cookbook's setup step: attach a stable id to every candidate
 * line so it can be offered as a `Choice` option later. The corpus here is
 * `SPEC.md` itself (see `spec-snapshot.ts`) rather than a downloaded document,
 * so the example is self-contained.
 *
 * Two levels, because SPEC.md has more candidate lines (see
 * `clauses.length` below) than the API's 255-option `Choice` ceiling
 * (`Question.choiceOptionBounds.max`) allows in one question:
 *
 * - A **window** is one `##`-level section (`## Status`, `## Layer 1 —
 *   ...`, and so on). There are few enough of these to offer directly as
 *   `Choice` options — that is the first-pass question in `search.ts`.
 * - A **clause** is one non-blank source line within a window, id'd by its
 *   line number (`L047`). Every window here has far fewer clauses than the
 *   255-option cap even though the whole document does not, which is what
 *   makes the two-stage approach work: rank windows first, then rank lines
 *   only within whichever window(s) survive that pass.
 *
 * Both id schemes are stable across re-runs of this module (they are a pure
 * function of line position in the frozen snapshot), which is what lets
 * `recorded.ts` key a fixture by clause/window id and have it still mean the
 * same line the next time this module runs.
 */
import { specSnapshot } from "./spec-snapshot.js"

/**
 * One `##`-level section of the document.
 */
export interface Window {
  readonly id: string
  readonly title: string
  readonly startLine: number
  readonly endLine: number
  /** A short excerpt used as the option's `Choice` criterion — the section's own text, not a hand-written summary. */
  readonly excerpt: string
  readonly clauseIds: ReadonlyArray<string>
}

/**
 * One non-blank source line, with the stable id it is offered under.
 */
export interface Clause {
  readonly id: string
  readonly line: number
  readonly windowId: string
  readonly text: string
}

const excerptLength = 320

const lines = specSnapshot.split("\n")

const windowsBuilding: Array<{ id: string; title: string; startLine: number; endLine: number; clauseIds: Array<string> }> = []
const clausesBuilding: Array<Clause> = []

let inFence = false
let currentWindowIndex = -1

// A window covers every line from its own `##` heading up to (but not
// including) the next one. Lines before the first `##` heading (the document
// title) are folded into the first window rather than orphaned.
lines.forEach((raw, i) => {
  const lineNumber = i + 1
  const heading = /^## (.+)$/.exec(raw)
  if (heading) {
    if (currentWindowIndex >= 0) {
      windowsBuilding[currentWindowIndex]!.endLine = lineNumber - 1
    }
    windowsBuilding.push({
      id: `W${String(windowsBuilding.length + 1).padStart(2, "0")}`,
      title: heading[1]!,
      startLine: currentWindowIndex < 0 ? 1 : lineNumber,
      endLine: lineNumber,
      clauseIds: []
    })
    currentWindowIndex++
  }

  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    inFence = !inFence
    return
  }
  if (inFence || trimmed === "") return
  if (currentWindowIndex < 0) return // nothing before the very first heading in this document

  const id = `L${String(lineNumber).padStart(3, "0")}`
  clausesBuilding.push({ id, line: lineNumber, windowId: windowsBuilding[currentWindowIndex]!.id, text: trimmed })
  windowsBuilding[currentWindowIndex]!.clauseIds.push(id)
})
if (currentWindowIndex >= 0) {
  windowsBuilding[currentWindowIndex]!.endLine = lines.length
}

/** Every `##`-level window in the document, in document order. */
export const windows: ReadonlyArray<Window> = windowsBuilding.map((w) => ({
  ...w,
  excerpt: clausesBuilding
    .filter((c) => c.windowId === w.id)
    .map((c) => c.text)
    .join(" ")
    .slice(0, excerptLength)
}))

/** Every candidate line in the document, in document order. */
export const clauses: ReadonlyArray<Clause> = clausesBuilding

/** Looks up a window by id. */
export const windowById: ReadonlyMap<string, Window> = new Map(windows.map((w) => [w.id, w]))

/** Looks up a clause by id. */
export const clauseById: ReadonlyMap<string, Clause> = new Map(clauses.map((c) => [c.id, c]))
