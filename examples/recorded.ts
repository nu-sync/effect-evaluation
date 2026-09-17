/**
 * Responses recorded from the live System One API, so the offline demo shows
 * what the model actually did rather than what someone assumed it would do.
 *
 * Recorded 2026-09-17 from jev-1.13.0. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/record.ts
 *
 * Options the model gave zero weight are omitted; the live API returns the full
 * distribution across every option offered. A single recording is one draw from
 * a distribution, not a measurement — the same filing does not always come back
 * with the same confidence.
 */
import type { GroupCode } from "./sic.js"

export interface Recorded {
  readonly probabilities: Partial<Record<GroupCode, number>>
  readonly confidence: number
}

export const recordedModel = "jev-1.13.0"

export const recorded: { readonly [id: string]: Recorded } = {
  "NOVAGRID": {
    probabilities: {
      "49": 1
    },
    confidence: 1
  },
  "HELIOTEX": {
    probabilities: {
      "28": 1
    },
    confidence: 1
  },
  "CLEARFIELD": {
    probabilities: {
      "60": 1
    },
    confidence: 1
  },
  "HARBORLIGHT": {
    probabilities: {
      "65": 0.6,
      "70": 0.4
    },
    confidence: 0.58
  },
  "MERIDIAN-GROUP": {
    probabilities: {
      "37": 0.64,
      "35": 0.34,
      "34": 0.02
    },
    confidence: 0.62
  },
  "CASCADE-MILLS": {
    probabilities: {
      "24": 0.92,
      "08": 0.06,
      "52": 0.02
    },
    confidence: 0.91
  },
  "ORCHARD-HOLDINGS": {
    probabilities: {
      "67": 1
    },
    confidence: 1
  },
  "VERITAS-LABS": {
    probabilities: {
      "28": 0.56,
      "87": 0.38,
      "38": 0.03,
      "80": 0.03
    },
    confidence: 0.54
  },
  "TIDEWATER-FOODS": {
    probabilities: {
      "20": 0.61,
      "01": 0.39
    },
    confidence: 0.6
  },
  "ARGENT-DIGITAL": {
    probabilities: {
      "73": 0.75,
      "64": 0.25
    },
    confidence: 0.73
  }
}
