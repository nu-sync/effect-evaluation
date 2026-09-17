/**
 * The guardrail policy is pure, so it can be tested without a client, a
 * network, or a browser. This is the file that would have caught the bug the
 * demo shipped with: severity escalating a review into a block on a reading the
 * model was 31% confident of.
 */
import { describe, expect, test } from "bun:test"
import { type Policy, policies, type Reading, route } from "../examples/guardrails/route.js"

const balanced = policies.find((p) => p.name === "balanced")!
const strict = policies.find((p) => p.name === "strict")!

const clean: Reading = {
  jailbreak: 0.02,
  harmful: 0.03,
  medical: 0.01,
  distress: 0.02,
  severity: 0.06,
  severityConfidence: 0.94,
  usage: { totalTokens: 0 },
  model: "test"
}

describe("routing", () => {
  test("an ordinary message crosses nothing", () => {
    const decision = route(clean, balanced)
    expect(decision.action).toBe("pass")
    expect(decision.reasons).toEqual([])
  })

  test("a clear hazard blocks, and says which one", () => {
    const decision = route({ ...clean, jailbreak: 0.99 }, balanced)
    expect(decision.action).toBe("block")
    expect(decision.reasons[0]).toContain("jailbreak")
  })

  test("crisis outranks hazards, so a person in distress is never merely refused", () => {
    const decision = route({ ...clean, distress: 0.94, harmful: 0.99, jailbreak: 0.99 }, balanced)
    expect(decision.action).toBe("support")
  })

  test("severity escalates a review into a block when the model is confident", () => {
    const decision = route(
      { ...clean, medical: 0.92, severity: 2.98, severityConfidence: 0.98 },
      balanced
    )
    expect(decision.action).toBe("block")
    expect(decision.reasons.some((r) => r.includes("severity"))).toBe(true)
  })

  test("the same severity does not escalate when the model is unsure of it", () => {
    const decision = route(
      { ...clean, medical: 0.92, severity: 2.98, severityConfidence: 0.31 },
      balanced
    )
    expect(decision.action).toBe("review")
    expect(decision.reasons.some((r) => r.includes("would escalate, but confidence"))).toBe(true)
  })

  test("the confidence bar is policy, not measurement", () => {
    const unsure: Reading = { ...clean, medical: 0.5, severity: 2.6, severityConfidence: 0.5 }
    // strict trusts a weaker severity signal than balanced does
    expect(strict.severityConfident).toBeLessThan(balanced.severityConfident)
    expect(route(unsure, strict).action).toBe("block")
    expect(route(unsure, balanced).action).toBe("review")
  })

  test("every preset carries a confidence bar, so none can escalate on a shrug", () => {
    for (const policy of policies satisfies ReadonlyArray<Policy>) {
      expect(policy.severityConfident).toBeGreaterThan(0)
      expect(route({ ...clean, medical: 0.99, severity: 3, severityConfidence: 0 }, policy).action)
        .toBe("review")
    }
  })
})
