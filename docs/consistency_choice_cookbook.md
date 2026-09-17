# Self-consistency: choices

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook) · Read September 16, 2026.

## Purpose

Examine whether repeated moderation decisions choose consistent labels, and how abstaining affects automatic routing.

## Workflow

1. Supply one ambiguous user post and eight fixed-option `Choice` questions.
2. Run each configuration 15 times, comparing label selections and probability distributions.
3. Send decisions to human review when the highest option probability is below 0.60.
4. Track raw agreement, agreement after abstention, automatic decisions, and parsing failures.

## Reported findings

| TypeSafe measure | Result |
| --- | --- |
| Raw label agreement | 90.8% |
| Agreement including uncertain outcomes | 99.2% |
| Automatic decisions | 74.2% |
| Questions with raw label changes | 2 of 8 |

Haiku at temperature zero achieved 100% agreement without abstention in this example.

## Limitations

Agreement measures repeatability, not accuracy. The cutoff uses the winning probability, not the separate API `confidence` field. Abstention does not make outputs deterministic; decisions can still cross the cutoff. A changing identifier also prevents isolating identical-request variation. Production thresholds need labeled examples and explicit review costs.
