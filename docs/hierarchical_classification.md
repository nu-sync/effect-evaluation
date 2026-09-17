# Hierarchical classification

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) · Read September 16, 2026.

## Purpose

Classify documents into deep taxonomies while retaining alternatives to recover from uncertain early decisions.

## Workflow

1. Represent each node's children as `Choice` options.
2. Start at the root and evaluate candidate branches.
3. Greedy search retains only the strongest child; beam search retains the best `K` paths.
4. Batch questions for retained paths into each request.
5. Continue to leaves and select the path with the highest length-normalized score.

## Path scoring

```text
path_score = product(edge_probabilities) ** (1 / decisions)
separation = best_path_score / second_best_path_score
```

The geometric mean permits comparison across path lengths. For deep trees, computing the mean of log probabilities avoids numerical precision problems. Separation describes ambiguity; it is not the pruning rule.

## Reported findings

On four examples spanning patents, Shopify products, MeSH subjects, and source files, beam search with `K=3` matched all expected leaves; greedy search matched two.

## Interpretation

The examples illustrate recovery from early mistakes, not broad benchmark accuracy. Tracking visited nodes and edges helps diagnose errors and assess taxonomy changes. MeSH's multiple-parent structure is expanded into tree-number paths.
