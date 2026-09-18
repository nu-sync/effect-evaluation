import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import packageJson from "../package.json" with { type: "json" }

// Regression guard: package.json's exports map is hand-maintained, and Provider.ts
// shipped in dist/ for one release with no subpath entry, silently breaking
// `import "@nu-sync/effect-evaluation/Provider"` even though the file existed.
// Every top-level module except the barrel (index.ts) must have a matching
// "./ModuleName" entry pointing at its built .js/.d.ts pair.
describe("package.json exports", () => {
  const modules = readdirSync(new URL("../src", import.meta.url))
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((name) => name.replace(/\.ts$/, ""))

  test("every src module has a subpath export", () => {
    expect(modules.length).toBeGreaterThan(0)
    for (const name of modules) {
      const entry = (packageJson.exports as Record<string, unknown>)[`./${name}`]
      expect(entry, `missing exports["./${name}"] for src/${name}.ts`).toBeDefined()
      expect(entry).toEqual({
        types: `./dist/${name}.d.ts`,
        import: `./dist/${name}.js`
      })
    }
  })
})
