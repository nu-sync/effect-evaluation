/**
 * Drives the example web app end to end — Effect routes, the event stream, the
 * bundled browser code, and the policy the browser applies — without opening a
 * port or making a network call.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { makeHandler } from "../examples/web/server.js"
import { replayLayer } from "../examples/web/client.js"

let handler: (request: Request) => Promise<Response>

const get = (path: string) => handler(new Request(`http://test${path}`))

const post = (path: string, body: unknown) =>
  handler(
    new Request(`http://test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  )

/** Reads an SSE response into the events it carried, in order. */
const drain = async (response: Response): Promise<Array<any>> => {
  const events: Array<any> = []
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary = buffer.indexOf("\n\n")
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (frame.startsWith("data: ")) events.push(JSON.parse(frame.slice(6)))
      boundary = buffer.indexOf("\n\n")
    }
  }
  return events
}

beforeAll(async () => {
  // Pinned to the recorded layer so the suite behaves the same with or without
  // an API key on the machine running it.
  handler = await makeHandler({
    disableLogger: true,
    client: { layer: replayLayer, mode: "replay" }
  })
})

describe("routes", () => {
  test("serves the page and the bundled app", async () => {
    const page = await get("/")
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toContain("text/html")
    expect(await page.text()).toContain(`src="/app.js"`)

    const app = await get("/app.js")
    expect(app.status).toBe(200)
    expect(app.headers.get("content-type")).toContain("javascript")
    expect((await app.text()).length).toBeGreaterThan(1000)
  })

  test("setup carries the taxonomy the browser needs to apply the policy", async () => {
    const setup = await (await get("/api/setup")).json()
    expect(setup.mode).toBe("replay")
    expect(setup.defaultThreshold).toBe(0.9)
    expect(setup.concurrency).toBe(4)
    expect(setup.filings).toHaveLength(10)
    expect(setup.groups["49"].division).toBe("E")
    expect(setup.divisions.E).toContain("Transportation")
  })

  test("classify returns a distribution, never a label", async () => {
    const body = await (await post("/api/classify", { id: "NOVAGRID", business: "utility" })).json()
    expect(body.ok).toBe(true)
    expect(body.reading.group).toBe("49")
    expect(body.reading.confidence).toBe(1)
    // The policy is the browser's job; the server must not pre-empt it.
    expect(body.reading).not.toHaveProperty("level")
    expect(body.reading).not.toHaveProperty("label")
  })

  test("a typed failure reaches the client with its tag intact", async () => {
    const body = await (await post("/api/classify", { id: "NOT-A-FILING", business: "x" })).json()
    expect(body.ok).toBe(false)
    expect(body.error.tag).toBe("SystemOne/ResponseError")
    expect(body.error.message).toContain("no recorded response")
  })

  test("a malformed body is rejected before the client is touched", async () => {
    const response = await post("/api/classify", { nope: true })
    expect(response.status).toBe(400)
    expect((await response.json()).error.tag).toBe("BadRequest")
  })
})

describe("the event stream", () => {
  test("narrates every case and never exceeds the concurrency limit", async () => {
    const response = await get("/api/stream")
    expect(response.headers.get("content-type")).toContain("text/event-stream")

    const events = await drain(response)
    const queued = events[0]
    expect(queued.type).toBe("queued")
    expect(queued.ids).toHaveLength(10)
    expect(queued.concurrency).toBe(4)

    const answered = events.filter((event) => event.type === "answered")
    expect(answered).toHaveLength(10)
    expect(answered.every((event) => typeof event.reading.confidence === "number")).toBe(true)

    // The limiter is the point: four go in flight, and the fifth waits.
    const peak = Math.max(...events.filter((e) => e.inFlight !== undefined).map((e) => e.inFlight))
    expect(peak).toBe(4)

    const done = events.at(-1)
    expect(done.type).toBe("done")
    expect(done.totalTokens).toBeGreaterThan(0)

    // Every case is announced before it is answered.
    for (const id of queued.ids) {
      const started = events.findIndex((e) => e.type === "requesting" && e.id === id)
      const landed = events.findIndex((e) => e.type === "answered" && e.id === id)
      expect(started).toBeGreaterThanOrEqual(0)
      expect(landed).toBeGreaterThan(started)
    }
  })
})

describe("the browser app", () => {
  const mount = async (script = "/app.js") => {
    const window = new Window({ url: "http://test" })
    // happy-dom's console has no timeStamp, which React 19's dev build calls.
    window.console.timeStamp = () => {}
    const errors: Array<string> = []
    window.console.error = (...args: Array<unknown>) => errors.push(args.map(String).join(" "))
    window.document.body.innerHTML = `<div id="root"></div>`

    // @ts-expect-error a minimal fetch that routes straight into the Effect handler
    window.fetch = async (input: string, init?: RequestInit) => {
      const path = new URL(String(input), "http://test").pathname
      const response = await handler(new Request(`http://test${path}`, init))
      return { json: async () => await response.json() }
    }

    // happy-dom has no EventSource; this one reads the real stream out of the
    // real handler, so the app's parsing is exercised rather than stubbed.
    // @ts-expect-error installing a stand-in
    window.EventSource = class {
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      private closed = false
      constructor(url: string) {
        void (async () => {
          const events = await drain(await get(url))
          for (const event of events) {
            if (this.closed) return
            this.onmessage?.({ data: JSON.stringify(event) })
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        })()
      }
      close() {
        this.closed = true
      }
    }

    window.eval(await (await get(script)).text())
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { errors, window }
  }

  const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

  const click = (window: Window, label: string) => {
    const button = [...window.document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim().startsWith(label))
    button?.click()
  }

  // React tracks the input's value internally, so the native setter has to be
  // used before dispatching, or the change is swallowed as a no-op.
  const setThreshold = (window: Window, value: string) => {
    const slider = window.document.querySelector("input[type=range]") as unknown as {
      dispatchEvent: (event: unknown) => void
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    setter?.call(slider, value)
    slider.dispatchEvent(new window.Event("input", { bubbles: true }))
  }

  const number = (window: Window, label: string) =>
    Number((window.document.body.textContent ?? "").match(new RegExp(`${label}\\s*(\\d+)`))?.[1])

  test("renders the filings and the controls", async () => {
    const { errors, window } = await mount()
    const text = window.document.body.textContent ?? ""
    expect(text).toContain("Classification using confidence")
    expect(text).toContain("REPLAY")
    expect(text).toContain("NOVAGRID")
    expect(text).toContain("HARBORLIGHT")
    expect(text).toContain("in flight")
    expect(window.document.querySelectorAll("input[type=range]")).toHaveLength(1)
    expect(errors).toEqual([])
  })

  test("classifying one filing shows its decision and distribution", async () => {
    const { window } = await mount()
    click(window, "Classify this one")
    await settle()
    const text = window.document.body.textContent ?? ""
    expect(text).toContain("GROUP")
    expect(text).toContain("Electric, gas, and sanitary services")
    expect(text).toContain("distribution over")
  })

  test("the run narrates itself into the activity feed", async () => {
    const { window } = await mount()
    click(window, "Classify all")
    await settle(1200)
    const text = window.document.body.textContent ?? ""
    expect(text).toContain("queued 10 filings")
    expect(text).toContain("→ NOVAGRID")
    expect(text).toContain("← NOVAGRID")
    expect(text).toContain("done")
  })

  test("moving the threshold re-labels every case without another request", async () => {
    const { window } = await mount()
    click(window, "Classify all")
    await settle(1200)

    expect(number(window, "API calls")).toBe(10)
    expect(number(window, "as groups")).toBe(5)
    expect(number(window, "as divisions")).toBe(5)

    setThreshold(window, "0.40")
    await settle()
    expect(number(window, "as groups")).toBe(10)
    expect(number(window, "as divisions")).toBe(0)

    // Four of the recorded answers came back at exactly 1.0, so they stay
    // groups no matter how high the threshold goes. That is the data, not a bug.
    setThreshold(window, "0.99")
    await settle()
    expect(number(window, "as groups")).toBe(4)
    expect(number(window, "as divisions")).toBe(6)

    // The whole point: the policy is local, so dragging costs nothing.
    expect(number(window, "API calls")).toBe(10)
  })
})

describe("guardrails", () => {
  test("serves its own page and bundle", async () => {
    const page = await get("/guardrails")
    expect(page.status).toBe(200)
    expect(await page.text()).toContain(`src="/guardrails.js"`)
    expect((await get("/styles.css")).headers.get("content-type")).toContain("text/css")
  })

  test("setup carries the messages and the preset policies", async () => {
    const setup = await (await get("/api/guardrails/setup")).json()
    expect(setup.mode).toBe("replay")
    expect(setup.messages).toHaveLength(12)
    expect(setup.policies.map((p: any) => p.name)).toEqual(["strict", "balanced", "permissive"])
    // The battery is measured; the thresholds live in the policy, not the answer.
    expect(setup.policies[0].block.harmful).toBeLessThan(setup.policies[2].block.harmful)
  })

  test("the stream screens every message with all five questions", async () => {
    const events = await drain(await get("/api/guardrails/stream"))
    const answered = events.filter((event) => event.type === "answered")
    expect(answered).toHaveLength(12)
    for (const event of answered) {
      for (const key of ["jailbreak", "harmful", "medical", "distress", "severity"]) {
        expect(typeof event.reading[key]).toBe("number")
      }
    }
    expect(Math.max(...events.filter((e) => e.inFlight !== undefined).map((e) => e.inFlight))).toBe(4)
  })
})

describe("the guardrails page", () => {
  const mountGuardrails = async () => {
    const window = new Window({ url: "http://test/guardrails" })
    window.console.timeStamp = () => {}
    const errors: Array<string> = []
    window.console.error = (...args: Array<unknown>) => errors.push(args.map(String).join(" "))
    window.document.body.innerHTML = `<div id="root"></div>`

    // @ts-expect-error minimal fetch into the Effect handler
    window.fetch = async (input: string, init?: RequestInit) => {
      const path = new URL(String(input), "http://test").pathname
      const response = await handler(new Request(`http://test${path}`, init))
      return { json: async () => await response.json() }
    }
    // @ts-expect-error minimal EventSource reading the real stream
    window.EventSource = class {
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      private closed = false
      constructor(url: string) {
        void (async () => {
          for (const event of await drain(await get(url))) {
            if (this.closed) return
            this.onmessage?.({ data: JSON.stringify(event) })
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
        })()
      }
      close() {
        this.closed = true
      }
    }

    window.eval(await (await get("/guardrails.js")).text())
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { errors, window }
  }

  const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

  const press = (window: Window, label: string) =>
    [...window.document.querySelectorAll("button")]
      .find((b) => b.textContent?.trim().startsWith(label))
      ?.click()

  // Query the footer tallies directly: the word "pass" also appears on every
  // sidebar chip, so matching on text alone finds the wrong number.
  const routed = (window: Window, action: string) =>
    Number(window.document.querySelector(`footer .act.${action} b`)?.textContent)

  const footerNumber = (window: Window, label: string) =>
    Number((window.document.querySelector("footer")?.textContent ?? "")
      .match(new RegExp(`${label}\\s*(\\d+)`))?.[1])

  test("renders the battery and the policy controls", async () => {
    const { errors, window } = await mountGuardrails()
    const text = window.document.body.textContent ?? ""
    expect(text).toContain("Guardrails for LLMs")
    expect(text).toContain("quiet-crisis")
    expect(text).toContain("severity escalates")
    expect(window.document.querySelectorAll("input[type=range]").length).toBeGreaterThanOrEqual(6)
    expect(errors).toEqual([])
  })

  test("a policy change re-routes every message without another request", async () => {
    const { window } = await mountGuardrails()
    press(window, "Screen all")
    await settle(1400)

    // Defaults to the balanced preset.
    expect(footerNumber(window, "API calls")).toBe(12)
    expect(routed(window, "pass")).toBe(6)
    expect(routed(window, "review")).toBe(1)
    expect(routed(window, "block")).toBe(4)
    expect(routed(window, "support")).toBe(1)

    // Strict blocks less than it used to: two of its escalations were riding on
    // a severity score the model was not confident about.
    press(window, "strict")
    await settle()
    expect(routed(window, "pass")).toBe(4)
    expect(routed(window, "review")).toBe(3)
    expect(routed(window, "block")).toBe(4)

    press(window, "permissive")
    await settle()
    expect(routed(window, "pass")).toBe(7)
    expect(routed(window, "block")).toBe(3)

    // A person in crisis routes to support under every policy, and never to a
    // bare refusal.
    expect(routed(window, "support")).toBe(1)

    // The measurement was paid for once.
    expect(footerNumber(window, "API calls")).toBe(12)
  })
})
