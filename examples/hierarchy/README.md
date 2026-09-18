# Hierarchical classification

Replicates TypeSafe's [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification)
cookbook. Local summary: [`docs/hierarchical_classification.md`](../../docs/hierarchical_classification.md).

Walks the same SIC taxonomy as [`../classification/`](../classification/README.md), but division →
group across two levels instead of one flat 60-option `Choice`, and runs three strategies over
identical inputs: the flat baseline, greedy (top child at each level), and beam search (`K=3`,
scored by the cookbook's length-normalized geometric mean). Keeping the whole distribution — not
just the winner — is what makes beam search expressible at all.

Greedy and beam are computed from the *same two requests* per filing (one root, one batched
second-level request), not run separately, which is itself an example of
[`docs/parallel_questions.md`](../../docs/parallel_questions.md)'s batching point applied one level
further. The flat baseline costs nothing here — it's decoded from
[`../classification/recorded.ts`](../classification/recorded.ts), already made for the other demo.

## Files

- **`tree.ts`** — the taxonomy walk (division → group `Choice` questions) and the pure path-scoring
  math. No requests.
- **`search.ts`** — the two hierarchical requests (`readRaw`, `readFiling`), greedy and beam search,
  and the flat baseline reused from `classification/`.
- **`cli.ts`** — runs all three strategies over the ten filings and prints where they agreed,
  diverged, and — when the top pick missed — whether the right answer was still on the shortlist.
  `just cli-hierarchy`.
- **`record.ts`** / **`recorded.ts`** — regenerate / replay the fixtures. `just record-hierarchy`.

Ten filings is an illustration, not evidence about which strategy is better in general.
