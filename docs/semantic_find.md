# Line-by-line semantic search

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/semantic_find) · Read September 16, 2026.

## Purpose

Locate relevant source lines while distinguishing an actual answer from merely similar text.

## Workflow

1. Split GitHub's Terms of Service into 218 clauses and attach stable line identifiers.
2. Use those identifiers as `Choice` options to rank lines against a query.
3. Ask a companion `Noul` whether the document answers the query at all.
4. Submit both questions in one `system_one` request.
5. Return ordered relevance scores and classify answer availability as present, partial, or missing.

## Why the second question matters

Choice probabilities sum to one, so some line always wins. In the arbitration example, the highest-ranked line scored 0.86, but the answer-existence probability was only 0.14. A parental-permission query was only partially addressed.

## Adaptation

Replace the input document and tune answer-availability thresholds on representative queries. The page documents a 255-option limit; longer documents need a first pass selecting a window, followed by line ranking within it.

Cached responses allow replay; live calls require `TYPESAFE_API_KEY`.
