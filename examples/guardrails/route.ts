/**
 * The policy half of the guardrail demo: types, preset policies, and the
 * routing function.
 *
 * Deliberately free of Effect and of any I/O, because both the server and the
 * browser import it. That is not a packaging convenience — it is the point the
 * demo makes. The request measures; this file decides; only the first one
 * costs anything.
 */

/**
 * What one request tells us about one message, before any policy is applied.
 */
export interface Reading {
  readonly jailbreak: number
  readonly harmful: number
  readonly medical: number
  readonly distress: number
  readonly severity: number
  /**
   * How concentrated the severity distribution was. A `Score` spread across
   * levels produces a weighted mean in the middle that looks like a reading and
   * is not one, so this decides whether the score is worth acting on.
   */
  readonly severityConfidence: number
  readonly usage: { readonly totalTokens: number }
  readonly model: string
}

/**
 * Where the lines are drawn. Everything here is policy, not measurement.
 */
export interface Policy {
  readonly name: string
  readonly summary: string
  /** At or above this `distress`, route to support before considering anything else. */
  readonly support: number
  /** At or above these, block outright. */
  readonly block: { readonly jailbreak: number; readonly harmful: number }
  /** At or above these, send to a human. */
  readonly review: { readonly jailbreak: number; readonly harmful: number; readonly medical: number }
  /** A reviewable message with severity at or above this is blocked instead. */
  readonly severityEscalates: number
  /**
   * …but only when the severity answer is at least this confident.
   *
   * Without this the policy escalates on the model's own shrug. The severity
   * score is a weighted mean over four levels, and an even spread lands near
   * the middle of the scale while carrying almost no information — which is
   * precisely the shape that would otherwise turn a review into a block.
   */
  readonly severityConfident: number
}

export const policies: ReadonlyArray<Policy> = [
  {
    name: "strict",
    summary: "Low tolerance. Escalates on weak signals and lets severity turn a review into a block.",
    support: 0.4,
    block: { jailbreak: 0.6, harmful: 0.5 },
    review: { jailbreak: 0.25, harmful: 0.2, medical: 0.3 },
    severityEscalates: 2,
    severityConfident: 0.45
  },
  {
    name: "balanced",
    summary: "Blocks clear cases, sends genuine ambiguity to a human, lets ordinary requests through.",
    support: 0.5,
    block: { jailbreak: 0.8, harmful: 0.75 },
    review: { jailbreak: 0.4, harmful: 0.35, medical: 0.5 },
    severityEscalates: 2.5,
    severityConfident: 0.6
  },
  {
    name: "permissive",
    summary: "Only near-certain hazards are stopped. Fiction and research are expected to pass.",
    support: 0.6,
    block: { jailbreak: 0.92, harmful: 0.9 },
    review: { jailbreak: 0.65, harmful: 0.6, medical: 0.75 },
    severityEscalates: 2.9,
    severityConfident: 0.75
  }
]

export type Action = "pass" | "review" | "block" | "support"

export interface Decision {
  readonly action: Action
  /** Which measurement drove the outcome, in the policy's own terms. */
  readonly reasons: ReadonlyArray<string>
}

const pct = (value: number) => `${Math.round(value * 100)}%`

/**
 * Applies a policy to a reading. Pure: no request, no clock, no randomness.
 *
 * Order matters. Distress is checked first because a person in crisis who also
 * trips a hazard flag needs support, not a refusal.
 */
export const route = (reading: Reading, policy: Policy): Decision => {
  if (reading.distress >= policy.support) {
    return {
      action: "support",
      reasons: [`distress ${pct(reading.distress)} ≥ ${pct(policy.support)}`]
    }
  }

  const blocking: Array<string> = []
  if (reading.jailbreak >= policy.block.jailbreak) {
    blocking.push(`jailbreak ${pct(reading.jailbreak)} ≥ ${pct(policy.block.jailbreak)}`)
  }
  if (reading.harmful >= policy.block.harmful) {
    blocking.push(`harmful ${pct(reading.harmful)} ≥ ${pct(policy.block.harmful)}`)
  }
  if (blocking.length > 0) return { action: "block", reasons: blocking }

  const reviewing: Array<string> = []
  if (reading.jailbreak >= policy.review.jailbreak) {
    reviewing.push(`jailbreak ${pct(reading.jailbreak)} ≥ ${pct(policy.review.jailbreak)}`)
  }
  if (reading.harmful >= policy.review.harmful) {
    reviewing.push(`harmful ${pct(reading.harmful)} ≥ ${pct(policy.review.harmful)}`)
  }
  if (reading.medical >= policy.review.medical) {
    reviewing.push(`medical ${pct(reading.medical)} ≥ ${pct(policy.review.medical)}`)
  }

  if (reviewing.length > 0) {
    // The one place the Score, rather than a Noul, decides the outcome — and
    // the one place a confidence gates an action. Escalating a review into a
    // block on a severity the model is unsure of is exactly the mistake this
    // demo is meant to warn about.
    if (reading.severity >= policy.severityEscalates) {
      if (reading.severityConfidence >= policy.severityConfident) {
        return {
          action: "block",
          reasons: [
            ...reviewing,
            `severity ${reading.severity.toFixed(2)} ≥ ${policy.severityEscalates} at confidence ${
              reading.severityConfidence.toFixed(2)
            }`
          ]
        }
      }
      return {
        action: "review",
        reasons: [
          ...reviewing,
          `severity ${reading.severity.toFixed(2)} would escalate, but confidence ${
            reading.severityConfidence.toFixed(2)
          } < ${policy.severityConfident}`
        ]
      }
    }
    return { action: "review", reasons: reviewing }
  }

  return { action: "pass", reasons: [] }
}

