---
name: typesafe-docs
description: Find and use this project's TypeSafe AI cookbook documentation. Use when locating a TypeSafe recipe, explaining its documented approach, or selecting references for an implementation.
---

# TypeSafe documentation index

Read the project [documentation index](../../../docs.md), then open only the cookbook summaries relevant to the request. Links inside that index resolve from the project root; the index itself resolves relative to this skill directory.

The index covers the three API primitives and their exact request and answer shapes, plus cookbooks on probability and label consistency, question batching, retrieval and re-ranking, formatting recovery, function dispatch, skill selection, entity matching, confidence-based classification, feature discovery, hierarchy traversal, and LLM guardrails. Keep the index as the single catalog rather than duplicating it here.

For anything touching how a request is built or a response is decoded, read
[the primitives note](../../../docs/primitives.md) before the cookbooks. It records the entry-type
rule that governs `instructions` and every `criteria` value, and the fact that a `Score` answer's
`legend` echoes those entries back rather than always being strings.

## Using the references

- Local files in `docs/` are concise summaries, not complete API documentation or runnable notebooks. Use them to choose an approach and locate the original source.
- For implementation details, missing examples, or current SDK behavior, follow the selected summary's source link. The cookbook URL with `.md` appended provides Markdown; the broader official index is available at `https://docs.typesafe.ai/llms.txt` when the local catalog does not cover the question.
- Distinguish the API's `confidence` field from an option's probability. Preserve that distinction when explaining thresholds or adapting recipes.
- Describe benchmark numbers as the cookbook's reported results. Preserve relevant limitations and avoid presenting example thresholds, model versions, prices, or timings as universal or current guarantees.
- Cite the local note for repository navigation and the original source for externally verified details. If a source cannot be accessed, identify the gap instead of filling it with assumed API behavior.

When asked to update this documentation, maintain the source link and read date in the affected summary and keep `docs.md` synchronized with any added, renamed, or removed files.
