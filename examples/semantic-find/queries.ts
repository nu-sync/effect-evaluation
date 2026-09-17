/**
 * Queries run against the `SPEC.md` corpus, chosen to show the full range the
 * cookbook is about: something the document states plainly, something raised
 * in a different section entirely, something it only partially addresses, and
 * something it does not address at all.
 *
 * `note` records what we expect and why *before* looking at a live answer —
 * so a reader can tell a genuine reading from a story fitted to it afterward.
 */
export interface Query {
  readonly id: string
  readonly text: string
  readonly note: string
}

export const queries: ReadonlyArray<Query> = [
  {
    id: "reconcile-mismatch",
    text: "What happens when a response doesn't match the questions that were asked?",
    note: "Stated plainly, in Layer 1's decisions: a mismatch fails as a typed ResponseError rather than being coerced."
  },
  {
    id: "auto-retry",
    text: "Does the client retry failed requests automatically?",
    note: "Stated plainly, in Layer 1's decisions: nothing retries unless the caller opts in."
  },
  {
    id: "phase1-complete",
    text: "What must be true for phase 1 to be considered complete?",
    note: "A numbered list, but in a different section than the two questions above — tests that windowing isn't just finding the same section every time."
  },
  {
    id: "judge-bias",
    text: "How does the evaluation framework correct for judge bias?",
    note:
      "The document is confident and specific here — but specific about only two controls (position-swapping, same-model flagging), for a framework layer 2 says outright is still a plan. Existence answers \"is this addressed\", not \"is this a complete answer\"; those are different questions."
  },
  {
    id: "token-pricing",
    text: "What is the pricing per token for using System One?",
    note: "Not addressed anywhere in this document. The document discusses token *usage* and *counts*, never *cost* — a plausible trap for a naive line match."
  }
]
