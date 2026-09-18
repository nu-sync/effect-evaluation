# Shared fixtures

Not a demo. Two data files reused by more than one demo, factored out so `classification/`,
`hierarchy/`, and `web/` all classify the same ten filings against the same taxonomy instead of each
keeping its own drifting copy.

- **`filings.ts`** — ten stand-in "Item 1 — Business" excerpts, written for this repo rather than
  extracted from real filings. The first three are unambiguous; the rest are deliberately hard in the
  ways [`docs/classification_using_confidence.md`](../../docs/classification_using_confidence.md)
  names as its low-confidence cases.
- **`sic.ts`** — the SIC major-group taxonomy (division → group) these demos classify filings into.

See [`classification/README.md`](../classification/README.md) and
[`hierarchy/README.md`](../hierarchy/README.md) for the demos that read these.
