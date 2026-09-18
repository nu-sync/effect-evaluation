# Classification using confidence

Replicates TypeSafe's [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence)
cookbook. Local summary: [`docs/classification_using_confidence.md`](../../docs/classification_using_confidence.md).

One `Choice` question offers every SIC major group at once. Above the confidence threshold
(`defaultThreshold`, 0.9), report the narrow group; below it, report the parent division instead — a
local lookup, no second call. The bet is that a correct broad label beats a wrong narrow one.

## Files

- **`classification.ts`** — the shared policy: the question, `read` (one request), `decide` (the pure
  threshold policy), and the offline replay layer. Imported by both `cli.ts` and `../web/server.ts`
  so they can never drift apart.
- **`cli.ts`** — runs all ten filings from `../data/filings.ts` and prints both policies (always name
  a group vs. fall back when unsure) side by side. `just cli` or `bun run examples/classification/cli.ts`.
- **`record.ts`** — regenerates `recorded.ts` from the live API. Needs `TYPESAFE_API_KEY`; refuses to
  run without one. `just record-classification`.
- **`recorded.ts`** — the frozen fixtures `cli.ts` and the web server replay against when no key is
  configured.

For the same policy with a slider on it instead of a table, see [`../web/`](../web/README.md).

No claim here is a measurement: ten filings is an illustration, and 0.9 is an example threshold, not
a recommendation.
