# Self-consistency: nouls

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) · Read September 16, 2026.

## Purpose

Measure how repeated probability estimates affect insurance-claim routing. A `Noul` expresses the estimated probability that a yes/no statement is true.

## Workflow

1. Represent a borderline auto-insurance claim as structured state.
2. Ask 14 questions covering coverage, exclusions, documentation, payment, and review.
3. Repeat each model configuration 15 times, comparing probabilities and hard yes/no answers.
4. Inspect variation, latency, estimated cost, and parsing failures.
5. Route probabilities from 0.30 through 0.70 to human review; preserve the original probabilities.

## Reported findings

TypeSafe's mean per-question standard deviation was 0.0102. Coverage estimates ranged from 0.43 to 0.53, enough to cross a simple 0.5 cutoff despite relatively small variation.

## Limitations and setup

Each repeat changes an irrelevant identifier, so the experiment mixes request sensitivity with repeat variation. Historical cost assumptions are not current pricing. Stability alone does not establish correctness.

The comparison requires TypeSafe, OpenAI, and Anthropic credentials. Included cached responses support replay without new calls.
