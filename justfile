# effect-systemone — an Effect client for TypeSafe AI System One models (Jev)

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

# Re-record both demos' fixtures from the live API. Needs a key; spends tokens.
[group('demo')]
record: install
    bun run examples/record.ts
    bun run examples/guardrails/record.ts

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
        echo "  Nothing reaches TypeSafe without one. Every answer you see comes from"
        echo "  hand-written fixtures — they exercise the policy and measure nothing"
        echo "  about the model."
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
