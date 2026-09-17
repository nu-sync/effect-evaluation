/**
 * The guardrails page.
 *
 * The server screens each message once — four hazard nouls and a severity score
 * in one request — and returns the probabilities. Every threshold below is
 * applied here, so moving one re-routes all twelve messages instantly and the
 * request counter does not move.
 *
 * `route` is imported from the same file the server and the CLI use, so what
 * you see here is not a reimplementation of the policy.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { type Action, type Policy, policies, type Reading, route } from "../guardrails/route.js"

interface Message {
  readonly id: string
  readonly side: "input" | "reply"
  readonly expected: Action
  readonly note: string
  readonly text: string
}

interface Setup {
  readonly mode: "live" | "replay"
  readonly recordedModel: string
  readonly concurrency: number
  readonly messages: ReadonlyArray<Message>
  readonly policies: ReadonlyArray<Policy>
  readonly severityLevels: ReadonlyArray<{ readonly what: string } | string>
}

type Outcome =
  | { readonly ok: true; readonly reading: Reading & { readonly elapsedMillis: number } }
  | { readonly ok: false; readonly error: { readonly tag: string; readonly message: string } }

interface Line {
  readonly at: string
  readonly kind: "out" | "in" | "bad" | "meta"
  readonly text: string
  readonly meta?: string
}

const clock = () => new Date().toTimeString().slice(3, 8)
const pct = (value: number) => `${Math.round(value * 100)}%`

const hazards = [
  { key: "jailbreak", label: "jailbreak" },
  { key: "harmful", label: "harmful" },
  { key: "medical", label: "medical" },
  { key: "distress", label: "crisis" }
] as const

function App() {
  const [setup, setSetup] = useState<Setup | undefined>(undefined)
  const [policy, setPolicy] = useState<Policy | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [status, setStatus] = useState<Record<string, "idle" | "queued" | "running" | "done">>({})
  const [feed, setFeed] = useState<ReadonlyArray<Line>>([])
  const [inFlight, setInFlight] = useState(0)
  const [running, setRunning] = useState(false)
  const [calls, setCalls] = useState(0)
  const [tokens, setTokens] = useState(0)
  const routings = useRef(0)
  const feedEnd = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void fetch("/api/guardrails/setup").then((r) => r.json()).then((data: Setup) => {
      setSetup(data)
      setPolicy(data.policies.find((p) => p.name === "balanced") ?? data.policies[0])
      setSelected(data.messages[0]?.id)
    })
  }, [])

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [feed])

  const say = (line: Omit<Line, "at">) => setFeed((f) => [...f, { ...line, at: clock() }])

  const decide = useMemo(() => {
    if (policy === undefined) return undefined
    return (reading: Reading) => {
      routings.current += 1
      return route(reading, policy)
    }
  }, [policy])

  const screenAll = () => {
    if (setup === undefined || running) return
    setRunning(true)
    setOutcomes({})
    setFeed([])
    setStatus(Object.fromEntries(setup.messages.map((m) => [m.id, "queued" as const])))

    const source = new EventSource("/api/guardrails/stream")
    source.onmessage = (message) => {
      const event = JSON.parse(message.data)
      switch (event.type) {
        case "queued":
          say({ kind: "meta", text: `queued ${event.ids.length} messages`, meta: `concurrency ${event.concurrency}` })
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
            text: `← ${event.id}`,
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
            text: "done",
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

  if (setup === undefined || policy === undefined || decide === undefined) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>loading…</div>
  }

  const message = setup.messages.find((m) => m.id === selected)
  const outcome = selected === undefined ? undefined : outcomes[selected]

  const decided = setup.messages.flatMap((m) => {
    const o = outcomes[m.id]
    if (o === undefined || !o.ok) return []
    return [{ message: m, reading: o.reading, decision: decide(o.reading) }]
  })

  const counts = decided.reduce<Record<Action, number>>(
    (acc, d) => ({ ...acc, [d.decision.action]: acc[d.decision.action] + 1 }),
    { pass: 0, review: 0, block: 0, support: 0 }
  )
  const agreed = decided.filter((d) => d.decision.action === d.message.expected).length

  const preset = policies.find((p) =>
    p.support === policy.support &&
    p.block.harmful === policy.block.harmful &&
    p.block.jailbreak === policy.block.jailbreak &&
    p.review.harmful === policy.review.harmful &&
    p.review.medical === policy.review.medical &&
    p.severityEscalates === policy.severityEscalates &&
    p.severityConfident === policy.severityConfident
  )

  const knob = (
    label: string,
    value: number,
    max: number,
    step: number,
    set: (n: number) => Policy
  ) => (
    <div className="knob" key={label}>
      <label>
        {label} <b>{max === 3 ? value.toFixed(1) : pct(value)}</b>
      </label>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(event) => setPolicy(set(Number(event.target.value)))}
      />
    </div>
  )

  return (
    <>
      <header>
        <h1>Guardrails for LLMs</h1>
        <nav>
          <a href="/">Classification</a>
          <a href="/guardrails" aria-current="page">Guardrails</a>
        </nav>
        <span className="spacer" />
        <span className={setup.mode === "live" ? "badge" : "badge fixtures"}>
          {setup.mode === "live" ? "LIVE API" : `REPLAY ${setup.recordedModel}`}
        </span>
      </header>

      <main>
        <div className="sidebar">
          <h2>Messages</h2>
          {setup.messages.map((m) => {
            const o = outcomes[m.id]
            const state = status[m.id] ?? "idle"
            const chip = state === "running"
              ? <span className="chip running">···</span>
              : state === "queued"
              ? <span className="chip queued">queued</span>
              : o === undefined
              ? <span className="chip">—</span>
              : o.ok
              ? <span className={`act ${decide(o.reading).action}`}>{decide(o.reading).action}</span>
              : <span className="chip err">error</span>
            return (
              <button key={m.id} className="case" aria-current={m.id === selected} onClick={() => setSelected(m.id)}>
                <span className="id">{m.id}</span>
                {chip}
              </button>
            )
          })}
          <div className="row" style={{ padding: "8px 14px" }}>
            <button className="primary" onClick={screenAll} disabled={running}>
              {running ? `Screening… ${inFlight} in flight` : "Screen all"}
            </button>
          </div>
        </div>

        <div className="panel">
          {message !== undefined && (
            <>
              <h2>{message.side === "input" ? "User message" : "Assistant reply"}</h2>
              <div className="card" style={{ marginTop: 4 }}>{message.text}</div>
              <div className="why">{message.note}</div>

              {outcome !== undefined && !outcome.ok && (
                <div className="card error">
                  <b style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{outcome.error.tag}</b>
                  <div style={{ marginTop: 6 }}>{outcome.error.message}</div>
                </div>
              )}

              {outcome !== undefined && outcome.ok && (
                <Screening
                  reading={outcome.reading}
                  policy={policy}
                  decision={decide(outcome.reading)}
                  expected={message.expected}
                  levels={setup.severityLevels}
                />
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
            <span className="hint" style={{ marginLeft: 4 }}>{inFlight} / {setup.concurrency} in flight</span>
          </div>
          <div className="feed">
            {feed.length === 0 && <div className="hint">idle — press “Screen all”</div>}
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
        <div className="presets">
          <span className="hint">policy</span>
          {policies.map((p) => (
            <button key={p.name} className={preset?.name === p.name ? "on" : ""} onClick={() => setPolicy(p)}>
              {p.name}
            </button>
          ))}
          <span className="hint">{preset === undefined ? "custom" : preset.summary}</span>
        </div>

        <div className="policy">
          {knob("block · harmful", policy.block.harmful, 1, 0.01, (n) => ({
            ...policy, name: "custom", block: { ...policy.block, harmful: n }
          }))}
          {knob("block · jailbreak", policy.block.jailbreak, 1, 0.01, (n) => ({
            ...policy, name: "custom", block: { ...policy.block, jailbreak: n }
          }))}
          {knob("review · harmful", policy.review.harmful, 1, 0.01, (n) => ({
            ...policy, name: "custom", review: { ...policy.review, harmful: n }
          }))}
          {knob("review · medical", policy.review.medical, 1, 0.01, (n) => ({
            ...policy, name: "custom", review: { ...policy.review, medical: n }
          }))}
          {knob("support · crisis", policy.support, 1, 0.01, (n) => ({ ...policy, name: "custom", support: n }))}
          {knob("severity escalates", policy.severityEscalates, 3, 0.1, (n) => ({
            ...policy, name: "custom", severityEscalates: n
          }))}
          {knob("…if confidence ≥", policy.severityConfident, 1, 0.01, (n) => ({
            ...policy, name: "custom", severityConfident: n
          }))}
        </div>

        <div className="tallies">
          <span className="act pass">pass <b>{counts.pass}</b></span>
          <span className="act review">review <b>{counts.review}</b></span>
          <span className="act block">block <b>{counts.block}</b></span>
          <span className="act support">support <b>{counts.support}</b></span>
          <span>agrees with the human label <b>{decided.length === 0 ? "—" : `${agreed}/${decided.length}`}</b></span>
          <span>API calls <b>{calls}</b></span>
          <span>tokens <b>{tokens}</b></span>
          <span>routings <b>{routings.current}</b></span>
        </div>

        <div className="note">
          The request measures; the thresholds decide. Move any slider and all twelve messages
          re-route while “API calls” stays put. Severity only escalates a review into a block when
          the model is confident about it — escalating on a spread distribution would be acting on
          a shrug. Twelve messages is an illustration, not an evaluation: the thresholds are
          examples, and a battery that passes does not establish that a message is safe.
        </div>
      </footer>
    </>
  )
}

const levelName = (levels: Setup["severityLevels"], index: number) => {
  const level = levels[index]
  return level === undefined ? String(index) : typeof level === "string" ? level : level.what
}

function Screening(
  { decision, expected, levels, policy, reading }: {
    reading: Reading & { elapsedMillis: number }
    policy: Policy
    decision: { action: Action; reasons: ReadonlyArray<string> }
    expected: Action
    levels: Setup["severityLevels"]
  }
) {
  const top = levels.length - 1
  const nearest = Math.max(0, Math.min(top, Math.round(reading.severity)))
  const trusted = reading.severityConfidence >= policy.severityConfident
  return (
    <>
      <div className="card">
        <div className="hint">hazards · one request, five questions</div>
        <div className="hazards" style={{ marginTop: 8 }}>
          {hazards.map(({ key, label }) => {
            const value = reading[key]
            const blockAt = key === "harmful"
              ? policy.block.harmful
              : key === "jailbreak"
              ? policy.block.jailbreak
              : key === "distress"
              ? policy.support
              : undefined
            const reviewAt = key === "harmful"
              ? policy.review.harmful
              : key === "jailbreak"
              ? policy.review.jailbreak
              : key === "medical"
              ? policy.review.medical
              : undefined
            const heat = blockAt !== undefined && value >= blockAt
              ? "hot"
              : reviewAt !== undefined && value >= reviewAt
              ? "warm"
              : "cool"
            return (
              <Row key={key} label={label} value={value} heat={heat} reviewAt={reviewAt} blockAt={blockAt} />
            )
          })}
          <Row
            label="severity"
            value={reading.severity / top}
            // A score runs 0..3, not 0..1. Printing it bare beside four
            // probabilities was the fastest way to make 0.73 look alarming.
            display={`${reading.severity.toFixed(2)}/${top}`}
            heat={reading.severity >= policy.severityEscalates && trusted ? "hot" : "cool"}
            blockAt={policy.severityEscalates / top}
          />
        </div>
        <div className="hint" style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>
            nearest level <b style={{ color: "var(--ink)", fontWeight: 500 }}>{levelName(levels, nearest)}</b>
          </span>
          <span style={{ color: trusted ? undefined : "var(--warn)" }}>
            severity confidence {reading.severityConfidence.toFixed(2)}
            {trusted ? "" : ` — below ${policy.severityConfident.toFixed(2)}, cannot escalate`}
          </span>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          Ticks mark this policy's review and block lines. Hazard rows are probabilities; the
          severity row is a position on a {levels.length}-level scale.
        </div>
      </div>

      <div className="card">
        <div className="actions" style={{ alignItems: "baseline" }}>
          <span className={`act big ${decision.action}`}>{decision.action.toUpperCase()}</span>
          <span className="hint">
            {decision.action === expected
              ? "matches the human label"
              : `human label says ${expected}`}
          </span>
        </div>
        <div className="reasons">
          {decision.reasons.length === 0
            ? <div>no threshold crossed</div>
            : decision.reasons.map((reason) => <div key={reason}>· {reason}</div>)}
        </div>
      </div>

      <div className="card">
        <div className="tallies" style={{ marginTop: 0 }}>
          <span>model <b>{reading.model}</b></span>
          <span>tokens <b>{reading.usage.totalTokens}</b></span>
          <span>round trip <b>{reading.elapsedMillis} ms</b></span>
        </div>
      </div>
    </>
  )
}

function Row(
  { blockAt, display, heat, label, reviewAt, value }: {
    label: string
    value: number
    heat: string
    display?: string
    reviewAt?: number | undefined
    blockAt?: number | undefined
  }
) {
  return (
    <>
      <span className="name">{label}</span>
      <span className="gauge">
        <span className={`lvl ${heat}`} style={{ display: "block", width: `${Math.min(1, value) * 100}%` }} />
        {reviewAt !== undefined && <span className="tick review" style={{ left: `${reviewAt * 100}%` }} />}
        {blockAt !== undefined && <span className="tick block" style={{ left: `${blockAt * 100}%` }} />}
      </span>
      <span className="num">{display ?? value.toFixed(2)}</span>
    </>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
