# Line-by-line semantic search

Replicates TypeSafe's [Line-by-line semantic search](https://docs.typesafe.ai/cookbooks/semantic_find)
cookbook. Local summary: [`docs/semantic_find.md`](../../docs/semantic_find.md).

Ranks the lines of this repo's own `SPEC.md` against a query with a `Choice` over line ids, and asks
a companion `noul` in the same request whether the document answers the query **at all**. `Choice`
probabilities sum to 1, so some line always "wins" — the companion `noul` is the only thing that can
say "nothing here". Asked about per-token pricing, which `SPEC.md` never discusses, a line still
takes the majority of the mass; the `noul` reads near zero.

`SPEC.md` splits into more candidate lines than the API's 255-option `Choice` ceiling
(`Question.choiceOptionBounds.max`) allows in one request, so this demo implements the documented
two-pass workaround: a coarse `Choice` over `##`-level sections first, then a fine-grained `Choice`
over lines within only the section(s) that survive.

## Files

- **`corpus.ts`** — splits the frozen `SPEC.md` snapshot into sections (`windows`) and line
  `clauses`, each with a stable id.
- **`spec-snapshot.ts`** — freezes `SPEC.md`'s text on purpose, so this demo's clause ids and
  recordings don't drift every time `SPEC.md` itself is edited. Not kept in sync automatically.
- **`search.ts`** — the two-pass search (`selectWindows`, then the line `Choice`) and `classify`, the
  pure zero-cost policy over the result.
- **`queries.ts`** — the five queries this demo runs.
- **`cli.ts`** — runs every query and prints both passes plus the existence check. `just cli-find`.
- **`record.ts`** / **`recorded.ts`** — regenerate / replay the fixtures. `just record-find`.

Five queries over one document is an illustration, not an evaluation.
