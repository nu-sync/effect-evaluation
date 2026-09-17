# effect-evaluation — an Effect client for TypeSafe AI System One models (Jev)

port := "3000"
url := "http://localhost:" + port
open := if os() == "macos" { "open" } else if os() == "windows" { "start" } else { "xdg-open" }

# List the available recipes.
default:
    @just --list --unsorted

# Install dependencies.
install:
    bun install

# Serve the demos and open the classification page. Ctrl+C stops it.
[group('demo')]
web: (open-at "/")

# Serve the demos and open the guardrails page. Ctrl+C stops it.
[group('demo')]
guardrails: (open-at "/guardrails")

[private]
open-at path: install
    #!/usr/bin/env bash
    set -euo pipefail
    PORT={{ port }} bun run examples/web/server.ts &
    server=$!
    trap 'kill $server 2>/dev/null || true' EXIT
    until curl -sf {{ url }}/api/setup >/dev/null 2>&1; do sleep 0.2; done
    echo "  opening {{ url }}{{ path }}"
    {{ open }} {{ url }}{{ path }} >/dev/null 2>&1 || echo "  (open {{ url }}{{ path }} yourself)"
    wait $server

# Serve without opening a browser.
[group('demo')]
serve: install
    PORT={{ port }} bun run examples/web/server.ts

# Classification, from the terminal.
[group('demo')]
cli: install
    bun run examples/classification-using-confidence.ts

# Guardrails, from the terminal — every message under all three policies.
[group('demo')]
cli-guardrails: install
    bun run examples/guardrails/cli.ts

# Semantic find over SPEC.md — ranked lines beside the question "is it in here at all?".
[group('demo')]
cli-find: install
    bun run examples/semantic-find/cli.ts

# Hierarchical classification — flat, greedy and beam search over the same taxonomy.
[group('demo')]
cli-hierarchy: install
    bun run examples/hierarchy/cli.ts

# What can be re-recorded, and what each one costs. Spends nothing itself.
[group('record')]
record:
    @echo "  Each recorder makes live requests and spends tokens. Run one at a time:"
    @echo
    @echo "    just record-classification   10 requests — examples/recorded.ts"
    @echo "    just record-guardrails       12 requests — examples/guardrails/recorded.ts"
    @echo "    just record-find             10 requests — examples/semantic-find/recorded.ts"
    @echo "    just record-hierarchy        20 requests — examples/hierarchy/recorded.ts"
    @echo "    just record-golden            2 requests — test/golden/*.json"
    @echo
    @echo "  A recording is one draw from a distribution, not a measurement, so the"
    @echo "  numbers a re-record produces will not match the ones it replaces."

# Re-record the classification demo's fixtures. Needs a key; spends tokens.
[group('record')]
record-classification: install
    bun run examples/record.ts

# Re-record the guardrails demo's fixtures. Needs a key; spends tokens.
[group('record')]
record-guardrails: install
    bun run examples/guardrails/record.ts

# Re-record the semantic-find demo's fixtures. Needs a key; spends tokens.
[group('record')]
record-find: install
    bun run examples/semantic-find/record.ts

# Re-record the hierarchy demo's fixtures. Needs a key; spends tokens.
[group('record')]
record-hierarchy: install
    bun run examples/hierarchy/record.ts

# Re-record the golden wire-shape fixtures. Needs a key; spends tokens.
[group('record')]
record-golden: install
    bun run test/golden/record.ts

# Say whether a live API key is configured, and where it was found.
[group('demo')]
key:
    #!/usr/bin/env bash
    if [ -f .env ] && grep -qE '^TYPESAFE(_AI)?_API_KEY=[^[:space:]]' .env; then
        echo "  live: key found in .env"
    elif [ -n "${TYPESAFE_API_KEY:-}${TYPESAFE_AI_API_KEY:-}" ]; then
        echo "  live: key found in the environment"
    else
        echo "  fixtures: no key set."
        echo
        echo "  Nothing reaches TypeSafe without one. Every answer you see is replayed"
        echo "  from a response actually recorded from the live model — not invented —"
        echo "  and a recording is one draw from a distribution, not a measurement."
        echo
        if [ -f .env ]; then
            echo "  To go live: paste your key after TYPESAFE_API_KEY= in .env"
            echo "  (Bun loads it automatically; .env is gitignored.)"
        else
            echo "  To go live: cp .env.example .env, then paste your key into it."
        fi
    fi

# Typecheck, test, and build.
check: install
    bun run typecheck
    bun test
    bun run build

# Run the test suite (no network, no API key).
test: install
    bun test

# Watch the tests.
test-watch: install
    bun test --watch

# Typecheck only.
typecheck: install
    bun run typecheck

# Build the package to dist/.
build: install
    bun run build

# Show what would be published to npm.
pack: build
    bun pm pack --dry-run

# Remove build output and installed packages.
clean:
    rm -rf dist node_modules *.tgz
