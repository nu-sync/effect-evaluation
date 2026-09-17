# Function calling

Source: [TypeSafe cookbook](https://docs.typesafe.ai/cookbooks/function_calling) · Read September 16, 2026.

## Purpose

Translate natural-language requests into calls to typed functions with fixed argument choices and inspectable confidence.

## Workflow

1. Inspect function signatures for supported closed sets.
2. Describe function purposes and argument meanings in `spec.json`.
3. Build questions for function selection and every function's arguments.
4. Ask all questions in one request, then read only the selected function's answers.
5. Dispatch the call using validated option values.

| Argument shape | Treatment |
| --- | --- |
| `Literal[...]` | One choice among allowed values |
| `list[Literal[...]]` | Membership questions |
| `bool` | Binary judgment |
| Open-ended values | Retain function defaults |

## Handling omitted arguments

A separate `stated` question checks whether the user specified an optional argument. When absent, the dispatcher leaves it out so the function's default applies.

## Confidence and scope

Call confidence is the least certain constituent judgment, highlighting a single weak argument. The example covers ten trading-assistant functions and fourteen commands. It does not extract arbitrary numbers, dates, or free text; those remain outside this closed-set recipe.
