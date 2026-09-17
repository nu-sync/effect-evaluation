/**
 * An Effect-native client for TypeSafe AI System One models (Jev).
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Question, SystemOne } from "effect-systemone"
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
import * as Errors from "./Errors.js"
import * as Question from "./Question.js"
import * as SystemOne from "./SystemOne.js"
import * as Testing from "./Testing.js"

export { Answer, Errors, Question, SystemOne, Testing }
export * from "./Errors.js"
