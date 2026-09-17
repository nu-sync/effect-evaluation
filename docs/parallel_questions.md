# Parallel questions

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions) · Read September 16, 2026.

## Purpose

Compare asking many questions about one document together against sending each question separately.

## Workflow

1. Load a pinned GDPR Wikipedia revision of roughly 54,000 characters.
2. Define eight `Noul`, two `Choice`, and three `Score` questions.
3. Repeat batched and individual requests five times each.
4. Compare each answer's mean and standard deviation, plus request costs and latency.

The tracked values are yes-probability for nouls, winning probability for choices, and normalized scores.

## Reported findings

The published example reports 12.2× lower cost and 10.0× faster execution with batching. Most tracked answers were identical across repeats; two nouls showed small variation comparable between strategies.

## Practical implications

Batch questions that share state so the document is transmitted once. Independent questions do not require separate round trips.

The speed comparison sums sequential single-request latencies. Running those requests concurrently would reduce the latency advantage, while repeated document tokens still increase cost. These results describe this workload rather than a universal speed guarantee.
