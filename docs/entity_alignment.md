# Knowledge graph entity alignment

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/entity_alignment) · Read September 16, 2026.

## Purpose

Decide whether records from different catalogs describe the same product, with an explicit curator-review outcome for ambiguity.

## Workflow

1. Start with 450 candidate beer-record pairs from the Magellan benchmark.
2. Send both entities as one state.
3. Ask a three-level `Score` question describing distinct products, ambiguous relationships, and identical products.
4. Add `Noul` questions comparing name, brewery, and style in the same request.
5. Route by score; show field-level evidence to a curator when needed.

| Score region | Action | Published count |
| --- | --- | --- |
| Below 0.5 | Leave unlinked | 360 |
| Between cut points | Curator review | 50 |
| Above 1.5 | Assert identity | 40 |

## Design considerations

The cut points derive from the three ordered levels rather than fitted thresholds. The middle level's wording determines which ambiguities receive review. Numeric alcohol-content comparison belongs in ordinary code.

This recipe assumes candidate generation already happened. Request volume follows candidate-pair count. Routing counts do not themselves establish merge accuracy.
