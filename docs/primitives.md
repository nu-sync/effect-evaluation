# Primitives: noul, choice, score

Sources: [Overview](https://docs.typesafe.ai/primitives) · [Noul](https://docs.typesafe.ai/primitives/noul) · [Choice](https://docs.typesafe.ai/primitives/choice) · [Score](https://docs.typesafe.ai/primitives/score) · [Advanced structures](https://docs.typesafe.ai/primitives/advanced) · Read September 17, 2026.

These are the only three question types. There is no nesting, no multi-select, no
conditional branching, and no array-valued question. The documentation's advice for a deep
hierarchy is sequential `Choice` questions handled in code, not a nested question.

## Entry types

`instructions`, every `Choice` criteria value, every `Score` criteria entry, and both
`Noul` `criteria.true` and `criteria.false` are the same kind of field. Each accepts a
string, an object, an array, or `null`.

This is what lets a rubric be data rather than prose:

- `Choice` option — `{ "what": ..., "not_for": [...], "examples": [...] }`
- `Score` level — `{ "summary": ..., "signals": [...] }`, or `{ "what": ..., "examples": [...] }`
- `Noul` side — `{ "what": ..., "examples": [...] }`
- `instructions` — a `field` object carrying name, type, description and unit alongside the question

Field names should stay consistent across the options or levels of one question so they
compare cleanly.

Note a conflict between pages: the Noul page shows `criteria.true` and `criteria.false`
only as strings, while the Advanced page states they are entry types and shows objects with
`what` and `examples`. The Advanced page is the more general statement.

## Noul

The probability that a yes/no statement about the state is true. `criteria` is optional.

```json
{ "type": "noul", "instructions": "Is the customer asking for a human agent?",
  "criteria": { "true": "Description of yes", "false": "Description of no" } }
```

```json
{ "type": "noul", "noul": 0.99 }
```

**A noul answer carries no `confidence` field.** The number is the distribution. A value near
0.5 means the two outcomes are comparably likely — not "medium", and not low skill; the
meaning depends entirely on how the question was phrased.

## Choice

One option from a named set.

```json
{ "type": "choice", "instructions": "Which team should handle this?",
  "criteria": { "returns": "Exchanges, refunds…", "shipping": "Delivery status…" } }
```

```json
{ "type": "choice", "choice": "returns", "confidence": 1.0,
  "probabilities": { "shipping": 0.0, "returns": 1.0, "billing": 0.0 } }
```

`choice` is the highest-probability option. `probabilities` covers every option offered and
sums to 1.

## Score

An ordinal judgment across 2 to 10 ordered levels, lowest first.

```json
{ "type": "score", "instructions": "How severe is the reported issue?",
  "criteria": ["Cosmetic; no impact", "Workaround exists", "Blocking; no workaround"] }
```

```json
{ "type": "score", "score": 1.3, "confidence": 0.54,
  "legend": { "0": "Cosmetic; no impact", "1": "Workaround exists", "2": "Blocking; no workaround" },
  "probabilities": { "0": 0.0, "1": 0.7, "2": 0.3 } }
```

`score` is each level number multiplied by its probability, summed — so it is continuous and
lands between levels. Rounding it to an integer discards the part worth having.

**`legend` maps level numbers back to the original criteria entries**, so a level supplied as
an object comes back as that object. A client that assumes the legend is a map of strings
will reject any response to a structured score question.

## Confidence

Returned by `Choice` and `Score` only. It is a statistic computed from the distribution the
answer already carries — concentrated means confident, spread out means uncertain — and is
not the same as the winning option's probability.

The documentation's illustrative tiers, which it says depend on the domain: below 0.5 route
to a human; 0.5 to 0.9 proceed with verification depending on stakes; above 0.9 proceed,
with confirmation where stakes are high. Start conservative and adjust against observed
performance.

## Writing a good Score question

Two failure modes, both observed in this repository while building the guardrails demo:

- **A counterfactual question spreads the distribution.** Asking about a hypothetical answer rather
  than about the text in front of the model leaves nothing concrete to judge. Because the score is a
  weighted mean, spread mass lands mid-scale — a reading that looks like a measurement and is not.
  Confidence is the tell: the same benign message went from 0.72 at confidence 0.28 to 0.06 at 0.94
  when the question was rephrased to ask about the text itself.
- **Levels must order on one dimension.** Mixing kind of harm ("financial, legal, or psychological")
  with degree gives the model nothing to sort by. Order the levels by a single axis and say what it
  is.

Where a score drives an action, check its `confidence` before acting: a spread distribution produces
a mid-scale score that will cross a threshold while carrying almost no information.

## Implementation notes for this repository

`src/Question.ts` models all of the above as one exported `Entry` type. `src/Answer.ts`
decodes `legend` as arbitrary JSON rather than as strings, for the reason given above; the
package is strict about what it sends and liberal about what it accepts back.
