/**
 * The browser half of the demo.
 *
 * Two ideas drive the layout.
 *
 * The server streams events while it works, so the middle of a run is visible:
 * which cases are in flight (never more than the concurrency limit), when each
 * lands, what it cost. That is the activity rail on the right.
 *
 * The server sends readings, never labels. Everything below the "reported as"
 * line is derived here, so moving the threshold re-labels every finished case
 * without touching the network. The footer counters exist to make that
 * difference legible.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"

interface Filing {
  readonly id: string
  readonly expected: string
  readonly note: string
  readonly text: string
}

interface Reading {
  readonly group: string
  readonly confidence: number
  readonly probabilities: Record<string, number>
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens: number }
  readonly model: string
  readonly elapsedMillis: number
}

interface Setup {
  readonly mode: "live" | "replay"
  readonly recordedModel: string
  readonly concurrency: number
  readonly defaultThreshold: number
  readonly filings: ReadonlyArray<Filing>
  readonly groups: Record<string, { readonly name: string; readonly division: string }>
  readonly divisions: Record<string, string>
}

type Outcome =
  | { readonly ok: true; readonly reading: Reading }
  | { readonly ok: false; readonly error: { readonly tag: string; readonly message: string } }

type Status = "idle" | "queued" | "running" | "done"

interface Line {
  readonly at: string
  readonly kind: "out" | "in" | "bad" | "meta"
  readonly text: string
  readonly meta?: string
}

const clock = () => new Date().toTimeString().slice(3, 8)

function App() {
  const [setup, setSetup] = useState<Setup | undefined>(undefined)
  const [threshold, setThreshold] = useState(0.9)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [feed, setFeed] = useState<ReadonlyArray<Line>>([])
  const [inFlight, setInFlight] = useState(0)
  const [running, setRunning] = useState(false)
  const [calls, setCalls] = useState(0)
  const [tokens, setTokens] = useState(0)
  const derivations = useRef(0)
  const feedEnd = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void fetch("/api/setup").then((r) => r.json()).then((data: Setup) => {
      setSetup(data)
      setThreshold(data.defaultThreshold)
      setSelected(data.filings[0]?.id)
      setDrafts(Object.fromEntries(data.filings.map((f) => [f.id, f.text])))
    })
  }, [])

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [feed])

  const say = (line: Omit<Line, "at">) => setFeed((f) => [...f, { ...line, at: clock() }])

  // The policy. Pure, local, and the only thing a threshold change re-runs.
  const decide = useMemo(() => {
    if (setup === undefined) return undefined
    return (reading: Reading) => {
      derivations.current += 1
      const division = setup.groups[reading.group]?.division ?? "?"
      return reading.confidence >= threshold
        ? { level: "group" as const, label: setup.groups[reading.group]?.name ?? reading.group, code: reading.group }
        : { level: "division" as const, label: setup.divisions[division] ?? division, code: division }
    }
  }, [setup, threshold])

  const streamAll = () => {
    if (setup === undefined || running) return
    setRunning(true)
    setOutcomes({})
    setFeed([])
    setStatus(Object.fromEntries(setup.filings.map((f) => [f.id, "queued" as Status])))

    const source = new EventSource("/api/stream")
    source.onmessage = (message) => {
      const event = JSON.parse(message.data)
      switch (event.type) {
        case "queued":
          say({ kind: "meta", text: `queued ${event.ids.length} filings`, meta: `concurrency ${event.concurrency}` })
          break
        case "requesting":
          setStatus((s) => ({ ...s, [event.id]: "running" }))
          setInFlight(event.inFlight)
          say({ kind: "out", text: `→ ${event.id}`, meta: `${event.inFlight} in flight` })
          break
        case "answered":
          setStatus((s) => ({ ...s, [event.id]: "done" }))
          setOutcomes((o) => ({ ...o, [event.id]: { ok: true, reading: event.reading } }))
          setInFlight(event.inFlight)
          setCalls((n) => n + 1)
          say({
            kind: "in",
            text: `← ${event.id} ${event.reading.confidence.toFixed(2)}`,
            meta: `${event.reading.elapsedMillis}ms · ${event.reading.usage.totalTokens}t`
          })
          break
        case "failed":
          setStatus((s) => ({ ...s, [event.id]: "done" }))
          setOutcomes((o) => ({ ...o, [event.id]: { ok: false, error: event.error } }))
          setInFlight(event.inFlight)
          say({ kind: "bad", text: `✗ ${event.id}`, meta: event.error.tag.replace("SystemOne/", "") })
          break
        case "done":
          setRunning(false)
          setInFlight(0)
          setTokens((t) => t + event.totalTokens)
          say({
            kind: "meta",
            text: `done`,
            meta: `${(event.elapsedMillis / 1000).toFixed(1)}s · ${event.totalTokens} tokens`
          })
          source.close()
          break
      }
    }
    source.onerror = () => {
      setRunning(false)
      say({ kind: "bad", text: "stream disconnected" })
      source.close()
    }
  }

  const classifyOne = async (filing: Filing) => {
    setStatus((s) => ({ ...s, [filing.id]: "running" }))
    setInFlight((n) => n + 1)
    say({ kind: "out", text: `→ ${filing.id}`, meta: "single" })
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: filing.id, business: drafts[filing.id] ?? filing.text })
    })
    const outcome = await response.json() as Outcome
    setInFlight((n) => Math.max(0, n - 1))
    setCalls((n) => n + 1)
    setStatus((s) => ({ ...s, [filing.id]: "done" }))
    setOutcomes((o) => ({ ...o, [filing.id]: outcome }))
    if (outcome.ok) {
      setTokens((t) => t + outcome.reading.usage.totalTokens)
      say({
        kind: "in",
        text: `← ${filing.id} ${outcome.reading.confidence.toFixed(2)}`,
        meta: `${outcome.reading.elapsedMillis}ms · ${outcome.reading.usage.totalTokens}t`
      })
    } else {
      say({ kind: "bad", text: `✗ ${filing.id}`, meta: outcome.error.tag.replace("SystemOne/", "") })
    }
  }

  if (setup === undefined || decide === undefined) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>loading…</div>
  }

  const filing = setup.filings.find((f) => f.id === selected)
  const outcome = selected === undefined ? undefined : outcomes[selected]

  const scored = setup.filings.flatMap((f) => {
    const o = outcomes[f.id]
    if (o === undefined || !o.ok) return []
    const decision = decide(o.reading)
    return [{
      decision,
      groupWasRight: o.reading.group === f.expected,
      correct: decision.level === "group"
        ? o.reading.group === f.expected
        : setup.groups[o.reading.group]?.division === setup.groups[f.expected]?.division
    }]
  })

  const rate = (hits: number, total: number) =>
    total === 0 ? "—" : `${hits}/${total} (${Math.round((100 * hits) / total)}%)`

  return (
    <>
      <header>
        <h1>Classification using confidence</h1>
        <nav>
          <a href="/" aria-current="page">Classification</a>
          <a href="/guardrails">Guardrails</a>
        </nav>
        <span className="spacer" />
        <span className={setup.mode === "live" ? "badge" : "badge fixtures"}>
          {setup.mode === "live" ? "LIVE API" : `REPLAY ${setup.recordedModel}`}
        </span>
      </header>

      <main>
        <div className="sidebar">
          <h2>Filings</h2>
          {setup.filings.map((f) => {
            const o = outcomes[f.id]
            const state = status[f.id] ?? "idle"
            const chip = state === "running"
              ? { className: "chip running", text: "···" }
              : state === "queued"
              ? { className: "chip queued", text: "queued" }
              : o === undefined
              ? { className: "chip", text: "—" }
              : o.ok
              ? { className: `chip ${decide(o.reading).level}`, text: decide(o.reading).level }
              : { className: "chip err", text: "error" }
            return (
              <button key={f.id} className="case" aria-current={f.id === selected} onClick={() => setSelected(f.id)}>
                <span className="id">{f.id}</span>
                <span className={chip.className}>{chip.text}</span>
              </button>
            )
          })}
          <div className="row" style={{ padding: "8px 14px" }}>
            <button className="primary" onClick={streamAll} disabled={running}>
              {running ? `Running… ${inFlight} in flight` : "Classify all"}
            </button>
          </div>
        </div>

        <div className="panel">
          {filing !== undefined && (
            <>
              <h2>Item 1 — Business</h2>
              <textarea
                value={drafts[filing.id] ?? filing.text}
                onChange={(event) => setDrafts((d) => ({ ...d, [filing.id]: event.target.value }))}
              />
              <div className="why">{filing.note}</div>
              <div className="row">
                <button className="primary" onClick={() => void classifyOne(filing)} disabled={running}>
                  Classify this one
                </button>
                <span className="hint">
                  human label: <code>{filing.expected}</code> {setup.groups[filing.expected]?.name}
                </span>
              </div>
              {setup.mode === "replay" && (
                <div className="hint" style={{ marginTop: 6 }}>
                  Replaying responses recorded from <code>{setup.recordedModel}</code>, keyed by filing
                  id. Edit the text and the recording still answers — a filing with no recording fails,
                  which is what a typed <code>ResponseError</code> looks like from here. Set{" "}
                  <code>TYPESAFE_API_KEY</code> to classify anything you like.
                </div>
              )}

              {outcome !== undefined && !outcome.ok && (
                <div className="card error">
                  <b style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{outcome.error.tag}</b>
                  <div style={{ marginTop: 6 }}>{outcome.error.message}</div>
                </div>
              )}

              {outcome !== undefined && outcome.ok && (
                <Result reading={outcome.reading} threshold={threshold} setup={setup} decide={decide} filing={filing} />
              )}
            </>
          )}
        </div>

        <div className="activity">
          <h2>Activity</h2>
          <div className="inflight">
            {Array.from({ length: setup.concurrency }, (_, i) => (
              <span key={i} className={i < inFlight ? "dot on" : "dot"} />
            ))}
            <span className="hint" style={{ marginLeft: 4 }}>
              {inFlight} / {setup.concurrency} in flight
            </span>
          </div>
          <div className="feed">
            {feed.length === 0 && <div className="hint">idle — press “Classify all”</div>}
            {feed.map((line, i) => (
              <div key={i}>
                <span className="t">{line.at}</span>
                <span className={line.kind}>{line.text}</span>
                {line.meta !== undefined && <span className="meta">{line.meta}</span>}
              </div>
            ))}
            <div ref={feedEnd} />
          </div>
        </div>
      </main>

      <footer>
        <div className="slider">
          <label htmlFor="t" className="hint">confidence threshold</label>
          <input
            id="t"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <span className="value">{threshold.toFixed(2)}</span>
        </div>
        <div className="tallies">
          <span>always name a group <b>{rate(scored.filter((s) => s.groupWasRight).length, scored.length)}</b></span>
          <span>fall back when unsure <b>{rate(scored.filter((s) => s.correct).length, scored.length)}</b></span>
          <span>as groups <b>{scored.filter((s) => s.decision.level === "group").length}</b></span>
          <span>as divisions <b>{scored.filter((s) => s.decision.level === "division").length}</b></span>
          <span>API calls <b>{calls}</b></span>
          <span>tokens <b>{tokens}</b></span>
          <span>labels re-derived <b>{derivations.current}</b></span>
        </div>
        <div className="note">
          Dragging the threshold spends nothing: the server sent distributions, and the label is a
          local decision over them — API calls stay put while “re-derived” climbs.{" "}
          {scored.length} cases is far too few to measure anything; watch which way the two tallies
          move against each other instead.
        </div>
      </footer>
    </>
  )
}

function Result({ decide, filing, reading, setup, threshold }: {
  reading: Reading
  threshold: number
  setup: Setup
  filing: Filing
  decide: (reading: Reading) => { level: "group" | "division"; label: string; code: string }
}) {
  const decision = decide(reading)
  const top = Object.entries(reading.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .filter(([, p]) => p > 0.0005)
  const max = top[0]?.[1] ?? 1
  const right = decision.level === "group"
    ? reading.group === filing.expected
    : setup.groups[reading.group]?.division === setup.groups[filing.expected]?.division

  return (
    <>
      <div className="card">
        <div className="hint" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>confidence</span>
          <span style={{ fontFamily: "var(--mono)" }}>{reading.confidence.toFixed(3)}</span>
        </div>
        <div className={reading.confidence >= threshold ? "meter" : "meter below"} style={{ marginTop: 6 }}>
          <div className="fill" style={{ width: `${reading.confidence * 100}%` }} />
          <div className="marker" style={{ left: `calc(${threshold * 100}% - 1px)` }} />
        </div>
        <div className="verdict">
          <span className={decision.level === "group" ? "level" : "level division"}>
            {decision.level === "group" ? "GROUP" : "DIVISION"}
          </span>
          <span className="label">{decision.label}</span>
          <span className="hint">
            <code>{decision.code}</code> · model picked <code>{reading.group}</code> ·{" "}
            {right ? "matches the human label" : "differs from the human label"}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="hint">distribution over {Object.keys(reading.probabilities).length} options</div>
        <div className="dist">
          {top.map(([code, p], index) => (
            <Bar key={code} code={code} p={p} max={max} top={index === 0} name={setup.groups[code]?.name} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="tallies" style={{ marginTop: 0 }}>
          <span>model <b>{reading.model}</b></span>
          <span>tokens in <b>{reading.usage.inputTokens}</b></span>
          <span>tokens out <b>{reading.usage.outputTokens}</b></span>
          <span>round trip <b>{reading.elapsedMillis} ms</b></span>
        </div>
      </div>
    </>
  )
}

function Bar(
  { code, max, name, p, top }: { code: string; p: number; max: number; top: boolean; name?: string | undefined }
) {
  return (
    <>
      <span className="code">{code}</span>
      <span className="track">
        <div className={top ? "top" : ""} style={{ width: `${(p / max) * 100}%` }} />
      </span>
      <span className="val">{p.toFixed(3)}</span>
      {name !== undefined && <span className="name">{name}</span>}
    </>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
