# Guardrails for LLMs

Replicates TypeSafe's [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails)
cookbook. Local summary: [`docs/llm_guardrails.md`](../../docs/llm_guardrails.md).

One request carries a battery of five questions against a single message: four hazard `noul`s
(jailbreak, harmful, medical, crisis) plus a severity `Score`. A policy turns those probabilities
into pass / review / block / support, with severity able to escalate a review into a block. Nothing
here is a recommended safety configuration — the thresholds are illustrative and a battery that
passes does not establish that a message is safe.

## Files

- **`policy.ts`** — the question battery (`questions`), `screen` (one request per message), and the
  offline replay layer.
- **`route.ts`** — the pure policy: probabilities in, an `Action` (`pass` / `review` / `block` /
  `support`) out. Three preset policies live here.
- **`messages.ts`** — twelve messages chosen to separate cases that *sound* alarming from cases that
  *are*: fiction and defensive research sit next to genuine hazards, on purpose.
- **`cli.ts`** — screens every message under all three policies and prints the routing table. `just
  cli-guardrails`.
- **`record.ts`** / **`recorded.ts`** — regenerate / replay the fixtures. `just record-guardrails`.

For the same policy with six live thresholds instead of three presets, see
[`../web/`](../web/README.md).
