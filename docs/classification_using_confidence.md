# Classification using confidence

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/classification_using_confidence) · Read September 16, 2026.

## Purpose

Adjust a classification's specificity using confidence from the same response, without another model call.

## Workflow

1. Build 75 SIC industry groups and their ten parent divisions from SEC taxonomy data.
2. Read the business-description section of each annual report.
3. Ask one `Choice` question across industry groups.
4. At confidence of at least 0.90, return the selected group.
5. Otherwise, return that group's broader division using a local lookup.

## Reported findings

The 60-filing example divided evenly at the confidence cutoff:

| Subset | Group accuracy | Broader division accuracy |
| --- | --- | --- |
| Higher confidence | 90% | Not the selected policy |
| Lower confidence | 40% | 70% |

## Interpretation

The recipe uses the API's `confidence`, which reflects distribution concentration, rather than simply the winning option's probability.

The filings were filtered to cases whose text supports their self-reported SIC labels. Results therefore concern that curated sample. Broader labels sacrifice specificity; when they are insufficient for downstream action, uncertain cases can instead go to human review.
