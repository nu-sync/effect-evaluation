# Autoresearch feature discovery

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) · Read September 16, 2026.

## Purpose

Discover interpretable numeric features from text through repeated question proposal and supervised-model feedback.

## Workflow

1. Split 2,000 wine reviews into 1,200 development and 800 held-out examples.
2. Have an LLM propose questions about tasting notes.
3. Use TypeSafe to answer them per review: `Score` yields mean and spread features; `Noul` yields one probability.
4. Train CatBoost and inspect cross-validated errors and feature importance.
5. Propose additions, revisions, and deletions across five rounds. Accept revisions or deletions only when development error improves.
6. Evaluate saved question sets on untouched held-out data.

## Reported findings

| Approach | Held-out RMSE |
| --- | --- |
| Training-score mean | 3.09 |
| CatBoost word counts | 2.47 |
| Direct TypeSafe score | 2.15 |
| Initial 18 questions | 1.87 |
| Final 38 questions | 1.77 |

RMSE measures prediction error; lower is better.

## Adaptation and limits

Change the task brief and labeled text. Calls scale with rows and rounds; revisions require new answers. Keep discovery separate from final evaluation, respect rate limits, and check stability across splits. Results represent one dataset and run.
