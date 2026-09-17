# Skill suggestion

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/skill_suggestion) · Read September 16, 2026.

## Purpose

Help an agent select an appropriate skill from a large roster, including choosing no skill when none fits.

## Workflow

1. Rank 182 Hermes skills with a `Choice` question using their index descriptions.
2. In the same request, use three `Noul` questions to assess whether an action-oriented skill is needed.
3. Re-evaluate the top three using full descriptions and opening instructions.
4. Ask independent fit questions so the shortlist can be rejected entirely.
5. Add an optional suggestion to the agent's prompt while preserving its roster and discretion.

Both rejection gates use 0.30 in the example.

## Reported findings

Across 488 requests:

| Error | Agent alone | With suggestion |
| --- | --- | --- |
| Wrong skill on covered requests | 16.8% | 7.3% |
| Skill loaded when none applies | 9.8% | 4.0% |

## Limitations

Some suggestions overturn correct agent decisions. Shortlisting can retain only near-matches, and fit checks can still accept them. Covered benchmark requests were generated from skill instructions and may be easier than real requests. Replace the roster and evaluate both selection and abstention locally.
