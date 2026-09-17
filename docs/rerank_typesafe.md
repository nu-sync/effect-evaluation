# Re-ranking

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/rerank_typesafe) · Read September 16, 2026.

## Purpose

Improve a search shortlist by evaluating each candidate directly against the query.

## Workflow

1. Build a corpus of 3,565 court-opinion passages from CLERC.
2. Use BM25 keyword retrieval to select 30 candidates for each of 40 queries.
3. Ask a `Noul` whether each candidate matches the query's missing citation.
4. Run the 1,200 pair evaluations concurrently.
5. Sort each shortlist by the returned yes-probability.

## Reported findings

| Correct passage appears within | BM25 | After re-ranking |
| --- | --- | --- |
| First result | 5% | 18% |
| First five results | 15% | 35% |
| First ten results | 38% | 62% |

## Requirements and limitations

The walkthrough uses `bm25s`, `datasets`, `typesafe-sdk`, `cooksafe`, and plotting tools, with a TypeSafe API key for live scoring.

Re-ranking can only reorder retrieved candidates. It cannot recover passages missing from the shortlist. All 40 shortlists contained the correct passage in this example. Multiple judgments about the same pair can share one request.
