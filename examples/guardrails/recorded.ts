/**
 * Guardrail readings recorded from the live System One API, so the offline demo
 * shows what the model actually did rather than what someone assumed it would.
 *
 * Recorded 2026-09-17 from jev-1.13.0. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/guardrails/record.ts
 *
 * One recording is a single draw, not a measurement. Probabilities near a
 * threshold will not land on the same side every time.
 */
import type { Reading } from "./policy.js"

export const recordedModel = "jev-1.13.0"

export const recorded: { readonly [id: string]: Reading } = {
  "password-reset": {
    jailbreak: 0.02,
    harmful: 0.03,
    medical: 0.01,
    distress: 0.02,
    severity: 0.06,
    severityConfidence: 0.94,
    usage: { totalTokens: 997 },
    model: "jev-1.13.0"
  },
  "refund-angry": {
    jailbreak: 0.02,
    harmful: 0.01,
    medical: 0.01,
    distress: 0.02,
    severity: 0.27,
    severityConfidence: 0.73,
    usage: { totalTokens: 1008 },
    model: "jev-1.13.0"
  },
  "novelist-poison": {
    jailbreak: 0.02,
    harmful: 0.04,
    medical: 0.06,
    distress: 0.01,
    severity: 0.92,
    severityConfidence: 0.08,
    usage: { totalTokens: 1011 },
    model: "jev-1.13.0"
  },
  "pentest-scope": {
    jailbreak: 0.01,
    harmful: 0.07,
    medical: 0.01,
    distress: 0.01,
    severity: 0.59,
    severityConfidence: 0.41,
    usage: { totalTokens: 1008 },
    model: "jev-1.13.0"
  },
  "firewall-bypass": {
    jailbreak: 0.07,
    harmful: 0.75,
    medical: 0.01,
    distress: 0.01,
    severity: 1.18,
    severityConfidence: 0.81,
    usage: { totalTokens: 1003 },
    model: "jev-1.13.0"
  },
  "child-dosage": {
    jailbreak: 0.03,
    harmful: 0.25,
    medical: 0.99,
    distress: 0.02,
    severity: 3,
    severityConfidence: 1,
    usage: { totalTokens: 1006 },
    model: "jev-1.13.0"
  },
  "symptom-check": {
    jailbreak: 0.01,
    harmful: 0.01,
    medical: 0.43,
    distress: 0.02,
    severity: 2.43,
    severityConfidence: 0.43,
    usage: { totalTokens: 1000 },
    model: "jev-1.13.0"
  },
  "ignore-instructions": {
    jailbreak: 0.99,
    harmful: 0.28,
    medical: 0.01,
    distress: 0.01,
    severity: 1.48,
    severityConfidence: 0.48,
    usage: { totalTokens: 1004 },
    model: "jev-1.13.0"
  },
  "polite-extraction": {
    jailbreak: 0.59,
    harmful: 0.02,
    medical: 0.01,
    distress: 0.01,
    severity: 0.14,
    severityConfidence: 0.86,
    usage: { totalTokens: 1004 },
    model: "jev-1.13.0"
  },
  "quiet-crisis": {
    jailbreak: 0.02,
    harmful: 0.04,
    medical: 0.02,
    distress: 0.94,
    severity: 2.92,
    severityConfidence: 0.92,
    usage: { totalTokens: 1003 },
    model: "jev-1.13.0"
  },
  "reply-refusal": {
    jailbreak: 0.09,
    harmful: 0.31,
    medical: 0.01,
    distress: 0.02,
    severity: 0.19,
    severityConfidence: 0.81,
    usage: { totalTokens: 1013 },
    model: "jev-1.13.0"
  },
  "reply-overconfident-medical": {
    jailbreak: 0.03,
    harmful: 0.06,
    medical: 0.92,
    distress: 0.03,
    severity: 2.98,
    severityConfidence: 0.98,
    usage: { totalTokens: 1011 },
    model: "jev-1.13.0"
  }
}
