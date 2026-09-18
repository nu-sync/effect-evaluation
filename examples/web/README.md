# Web demos

Hosts [`../classification/`](../classification/README.md) and [`../guardrails/`](../guardrails/README.md)
in the browser, sharing one Effect HTTP server and one `SystemOne` service. Cookbooks:
[Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence),
[Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails). Local summaries:
[`docs/classification_using_confidence.md`](../../docs/classification_using_confidence.md),
[`docs/llm_guardrails.md`](../../docs/llm_guardrails.md).

`HttpRouter.toWebHandler` becomes a `fetch` handler for `Bun.serve` — no platform package. Two things
here are deliberate and easy to break if you're extending this:

- **The request measures; the policy decides.** Endpoints return distributions and confidence, never
  a label or an action. Thresholds are applied in the browser (`classification.decide`,
  `guardrails/route.ts`), so dragging a slider re-decides every case with no request and no spend.
- **Batch endpoints are SSE streams built from the stream itself**, not a forked fiber. `GET
  /api/stream` and `/api/guardrails/stream` narrate `queued` → `requesting`/`answered` (with the live
  in-flight count) → `done`, and closing the tab interrupts the in-flight requests.

## Files

- **`server.ts`** — the Effect HTTP router: `/api/setup`, `/api/classify`, `/api/stream`,
  `/api/guardrails/*`. `makeHandler` is exported so `test/web.test.ts` can drive it without opening a
  port.
- **`client.ts`** — the one `SystemOne` service both pages share; the replay layer asks each demo's
  `respond` in turn, relying on disjoint ids.
- **`app.tsx`** / **`guardrails.html`**+`.tsx` — the two pages. `styles.css` is shared.

`just web` serves and opens the classification page; `just guardrails` opens the guardrails page;
`just serve` runs the server without opening a browser.
