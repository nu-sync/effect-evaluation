/**
 * Semantic-find readings recorded from the live System One API, keyed by
 * query id — see `queries.ts`. Sparse: only probabilities at or above
 * 0.005 are named; `search.ts`'s `respond` reconstructs the rest as
 * zero before replaying, which is what lets a strict `Choice` reconcile
 * (every offered option must have a probability entry) still pass offline.
 *
 * Recorded 2026-09-17 from jev-1.13.0 against the
 * frozen `spec-snapshot.ts`. Regenerate with:
 *
 *   TYPESAFE_API_KEY=... bun run examples/semantic-find/record.ts
 *
 * One recording is a single draw from a distribution, not a measurement —
 * probabilities near a threshold will not land on the same side every time.
 */
import type { Recording } from "./search.js"

export const recorded: { readonly [queryId: string]: Recording } = {
  "reconcile-mismatch": {
    model: "jev-1.13.0",
    windowProbabilities: {"W08":0.79,"W07":0.01,"W03":0.18,"W05":0.01,"W04":0.01},
    windowConfidence: 0.76,
    windowUsage: { inputTokens: 1414, outputTokens: 109 },
    lineProbabilities: {"L352":0.01,"L353":0.98,"L354":0.01},
    lineConfidence: 0.98,
    existence: 0.7,
    lineUsage: { inputTokens: 1311, outputTokens: 189 }
  },
  "auto-retry": {
    model: "jev-1.13.0",
    windowProbabilities: {"W08":0.08,"W07":0.91,"W03":0.01},
    windowConfidence: 0.89,
    windowUsage: { inputTokens: 1398, outputTokens: 109 },
    lineProbabilities: {"L332":0.12,"L333":0.88},
    lineConfidence: 0.87,
    existence: 0.69,
    lineUsage: { inputTokens: 1174, outputTokens: 179 }
  },
  "phase1-complete": {
    model: "jev-1.13.0",
    windowProbabilities: {"W07":0.53,"W08":0.47},
    windowConfidence: 0.46,
    windowUsage: { inputTokens: 1409, outputTokens: 109 },
    lineProbabilities: {"L360":0.03,"L358":0.97},
    lineConfidence: 0.97,
    existence: 0.98,
    lineUsage: { inputTokens: 2022, outputTokens: 329 }
  },
  "judge-bias": {
    model: "jev-1.13.0",
    windowProbabilities: {"W06":0.03,"W05":0.05,"W02":0.01,"W04":0.89,"W09":0.01,"W07":0.01},
    windowConfidence: 0.87,
    windowUsage: { inputTokens: 1402, outputTokens: 109 },
    lineProbabilities: {"L248":0.01,"L246":0.67,"L249":0.3,"L247":0.01,"L244":0.01},
    lineConfidence: 0.66,
    existence: 0.95,
    lineUsage: { inputTokens: 4572, outputTokens: 839 }
  },
  "token-pricing": {
    model: "jev-1.13.0",
    windowProbabilities: {"W06":0.08,"W09":0.13,"W10":0.02,"W08":0.01,"W01":0.05,"W05":0.02,"W07":0.02,"W04":0.02,"W03":0.65},
    windowConfidence: 0.62,
    windowUsage: { inputTokens: 1404, outputTokens: 109 },
    lineProbabilities: {"L124":0.08,"L123":0.01,"L052":0.86,"L051":0.01,"L161":0.04},
    lineConfidence: 0.85,
    existence: 0.02,
    lineUsage: { inputTokens: 5456, outputTokens: 899 }
  }
}
