# Guardrails for LLMs

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/llm_guardrails) · Read September 17, 2026.

## Purpose

Screen both the user's input and the model's reply for hazards in a single request, then
route on severity rather than blocking everything that trips a flag.

The cookbook's framing of the alternatives: safety training draws the line in a place each
lab chooses; system prompts are vulnerable to jailbreaks; and a second LLM acting as
gatekeeper adds latency and cost while remaining exploitable in the same ways.

## Workflow

1. Ask a battery of questions against one message — several `Noul` hazard detectors plus one
   `Score` for severity — in one request.
2. Apply a policy: thresholds per question, and a severity level that can escalate an outcome.
3. Route to one of four actions: **pass**, **review**, **block**, or **support**.

Hazard questions cover jailbreak attempts, harmful or illegal requests, medical advice such
as diagnosis or dosage, and indications of self-harm. Severity is scored 0-3, from no harm
to serious physical harm.

## Reported findings

Tested over 10 prompts and 5 replies. The battery separated ordinary requests from those
needing human review and from genuine violations. A prompt described as `novelist_poison`
passed despite violent subject matter, because it was not a request to cause harm.

The cookbook notes one row where the severity `Score` rather than a `Noul` decides the
outcome — an input asking for dosage information, where severity escalates a review into a
block.

## Interpretation

The same probabilities produce different routing under a strict policy and a permissive one.
Detection and policy are separate concerns: the request measures, the thresholds decide.

## Notes from building this locally

Two things surfaced that the cookbook does not spell out.

**Ask about the message, not about a hypothetical answer to it.** A severity question phrased as
"how much harm could follow if this were fully answered" makes the model grade an answer that does
not exist. Probability spreads across levels, and because a `Score` is a weighted mean, benign
messages drift toward the middle of the scale: a password-reset request scored 0.72 of 3 at
confidence 0.28. Rephrased to ask about the harm at stake in the message itself, with levels ordered
purely by degree and reversibility, the same message scored 0.06 at confidence 0.94.

**A `Score` that escalates an action needs its confidence checked.** The escalation rule the cookbook
describes — severity turning a review into a block — reads on a spread distribution as a
middling score with low confidence, which is exactly the shape that trips a threshold while carrying
no information. Gating the escalation on the severity answer's own confidence is one extra
comparison, and without it the policy acts on the model's shrug.

## Limitations

Fifteen messages is an illustration, not an evaluation. The thresholds shown are examples,
not recommended settings, and the right values depend on the domain and on what the
downstream action costs when it is wrong. Nothing here establishes that a passing battery
means a message is safe.
