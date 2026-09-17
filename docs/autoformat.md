# Structure recovery

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/autoformat) · Read September 16, 2026.

## Purpose

Recover Markdown structure from text that lost formatting, retaining the original wording instead of generating a rewrite.

## Workflow

1. Preserve blank lines and explicit markers using local code.
2. Ask parallel `Noul` questions about whether adjacent lines continue a split sentence.
3. Merge qualifying lines into blocks.
4. In a second request, classify each block with `Choice` and ask companion questions about heading level, list order, and callout type.
5. Render Markdown locally, using relevant companion answers only.

## Decisions in the example

| Previous line ending | Merge cutoff |
| --- | --- |
| No terminal punctuation | 0.20 |
| Terminal punctuation | 0.50 |

Consecutive list items become numbered when their mean step probability reaches 0.50.

## Lessons and results

Asking whether lines share a paragraph incorrectly merged unmarked lists; asking about sentence continuation preserved their boundaries. Low-confidence block classifications can be surfaced for review.

The example reports two requests, 10,211 tokens, 0.8 seconds, and $0.0015. These are published example measurements. Criteria and thresholds need checking against other document styles.
