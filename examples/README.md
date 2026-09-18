# Examples

Five cookbook replications, each a self-contained folder: TypeSafe's published recipe reproduced
against this repo's own `SystemOne` client, run offline by default against fixtures recorded from
the live model, or live when `TYPESAFE_API_KEY` is set. See the root [README](../README.md#demos)
for the fuller narrative and [`docs.md`](../docs.md) for the full cookbook index this repo has
summarized locally.

| Folder | Cookbook | Run it |
| --- | --- | --- |
| [`classification/`](classification/README.md) | [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence) | `just cli` · `just web` |
| [`guardrails/`](guardrails/README.md) | [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails) | `just cli-guardrails` · `just guardrails` |
| [`hierarchy/`](hierarchy/README.md) | [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) | `just cli-hierarchy` |
| [`semantic-find/`](semantic-find/README.md) | [Line-by-line semantic search](https://docs.typesafe.ai/cookbooks/semantic_find) | `just cli-find` |
| [`web/`](web/README.md) | hosts `classification/` and `guardrails/` in the browser | `just web` · `just guardrails` |

`data/` holds the two fixtures shared across demos (SEC filing text, the SIC taxonomy) — it is not
a demo itself. Each demo folder has its own `record.ts` (spends real API calls, regenerates
`recorded.ts`) and `recorded.ts` (the frozen fixtures actually shipped); `just record` lists what
each recorder costs without spending anything itself.

No demo here measures anything — see [Framing](../CLAUDE.md#framing) in this repo's own contributor
notes, and each demo's own README, for what that means concretely.
