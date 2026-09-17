/**
 * An Effect-native client for TypeSafe AI System One models (Jev).
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Question, SystemOne } from "effect-evaluation"
 *
 * const program = SystemOne.evaluate({
 *   state: "The export button crashes the settings page in Safari.",
 *   questions: {
 *     severity: Question.score({
 *       instructions: "How severe is the reported issue?",
 *       criteria: ["Cosmetic", "Workaround exists", "Blocking"]
 *     })
 *   }
 * }).pipe(Effect.provide(SystemOne.layerFetch()))
 * ```
 *
 * @since 0.1.0
 */
import * as Answer from "./Answer.js"
import * as Question from "./Question.js"
import * as SystemOne from "./SystemOne.js"
import * as Testing from "./Testing.js"

export { Answer, Question, SystemOne, Testing }

// Errors gets exactly one public path: the flat names (`AuthError`,
// `ResponseError`, `isTransient`, ...), not also an `Errors` namespace. The
// other modules are namespaced because each groups several related exports
// under one imported name (`Question.choice`, `SystemOne.evaluate`); `Errors`
// is instead a flat set of sibling classes with no shared verb to hang a
// namespace off of, examples and the demo server already import them flat
// (`import { ResponseError } from "effect-evaluation"`), and a class imported
// through a namespace still prints as `Errors.AuthError` in a stack trace
// either way — so the namespace would only be a second, redundant path to the
// same symbols. Two public paths to one symbol is twice the surface this
// package has to keep stable across versions; this keeps it to one.
export * from "./Errors.js"
