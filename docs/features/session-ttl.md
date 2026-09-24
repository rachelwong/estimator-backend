# Feature — Session lifetime, cross-tab sync & hardening

Three independent changes:

1. **Session TTL** — the backend forgets a session a set time after the last
   thing that happened to it. Backend only.
2. **Cross-tab sync** — a second tab belonging to the same person updates live
   instead of holding a stale snapshot. Backend and both frontends.
3. **Operational hardening** — graceful shutdown, runtime validation of socket
   payloads, and the HTTP middleware the service is missing. Backend only.

**Decisions already taken** (settled in a `/grilling` session; don't
re-litigate while implementing):

- Storage stays in memory. No Redis, no database, for now.
- Ended sessions live 1 hour; open sessions 1.5 hours after the last activity.
- Opening a session counts as activity, not just voting.
- No cap on participants per session, no rate limit on session creation.
- No frontend cache of the reveal (see *Considered and dropped*).
- An expired session is indistinguishable from one that never existed.
- Cross-tab sync is done server-side, not with browser-to-browser messaging.

---

## The socket protocol in plain English

Every message this app sends over the socket, what it means, and who receives
it. Two are new or changed in part 2; the rest are unchanged and listed so the
protocol reads as one piece.

### The browser sends

| Event | In plain English |
| ----- | ---------------- |
| `join` | "I'm joining this session, and my name is X." Sent once, right after connecting. |
| `admin-auth` | "I'm the admin of this session, and here's my token to prove it." The admin's tab sends this instead of `join`. |
| `select-square` | "I'm clicking this square." Clicking the square you already have is how you clear your vote — the browser doesn't say which it means, it just reports the click. |
| `end-session` | "I'm the admin and I'm ending the session — reveal everything." Carries the token again, which the server re-checks every time. |

### The server sends

| Event | In plain English |
| ----- | ---------------- |
| `session-info` | "This session exists, here's its grid, and here's whether it has already ended." Sent to a tab the moment it connects, before it has identified itself. |
| `joined` | "You're in. Here's the name you actually got" — which may have a number added if someone already had it. Sent only to the tab that joined. |
| `admin-acknowledged` | "You're confirmed as the admin, and here's the square you currently have" — so a refreshed or second admin tab doesn't start blank. Sent only to the tab that authenticated. |
| `selection-acknowledged` | *(today, removed at the end of part 2)* "Here's the square you clicked." Sent only to the tab that clicked it. That tab then works out for itself whether the click selected or cleared — which is exactly the guesswork part 2 removes. |
| `selection-changed` | *(new in part 2)* "Your selection is now this square" — or "you now have no selection." Sent to **every** tab belonging to that one person, so a second tab stays in step. Nothing is inferred: the server has already worked out what the click meant. |
| `session-ended` | "The session is over — here's everyone's vote." The only message that goes to everybody in the session, and the only moment anyone learns what anyone else picked. |
| `error` | "That didn't work, and here's the code and message saying why." Sent only to the tab that caused it. |

The rule that shapes all of this: until `session-ended`, no message ever tells
one person anything about another. Part 2 keeps that intact — `selection-changed`
goes to one person's own tabs, never to the session at large.

---

## Where the frontend changes land

One backend, two live frontends, built from two branches of one repo:

- **`master` → `estimator-frontend-ashen.vercel.app`** — the prototype.
  **Frontend work happens here first**, verified, then on the other branch.
- **`release/design` → `fold-and-flip.vercel.app`** — the live product, and the
  branch that is ahead (52 commits, against 2 the other way). This plan's file
  and line references describe it.
- **Other branches** (`redesign/openjev`, `redesign/two-mode-visual-world`, the
  riso-two-mode worktree) — anything long-lived that will be deployed later
  needs part 2's frontend change merged or rebased in before it ships, or its
  second tab keeps guessing at a message the server no longer sends.

Functionally the two branches are the same; the difference is visual. The only
divergence that touches this work is in files part 2 doesn't need, so its change
should be the same edit on both branches — but each gets its own test run.

---

# Part 0 — The session explainer (`docs/features/sessions-explained.md`)

These three parts change the business rules around a session — how long it
lives, what keeps it alive, what a second tab sees — and those rules currently
exist only as decisions scattered through `estimator-plan.md`, `CLAUDE.md` and
this file, all written for whoever is editing the code.

So this work also produces a standing explainer, written for anyone who uses or
inherits the tool rather than for an implementer: what a session is, how one
starts and ends in a real meeting, how long it lasts, where it is kept, how much
traffic it can take, what the word "session" means in each place it appears, and
what happens in the awkward cases. Plain English and diagrams, no code walkthrough
— a snippet only where one makes something clearer.

- Drafted **now**, describing the behaviour these three parts produce, with
  anything not yet shipped marked as such.
- Every unmarked statement re-checked at the end of the rollout, when the marks
  come off.
- It is the document to update first whenever a session rule changes; the
  decision records stay where they are, and it links to them.

---

# Part 1 — Session TTL ✅ Built (not yet deployed)

## The problem

`sessionStore.ts` keeps every session in a module-level `Map` and never deletes
one. `endSession` only flips `ended`/`endedAt`; the entry, with every name and
vote, stays readable through `GET /sessions/:id` until the process restarts.

That restart used to happen nightly by accident, when the keep-alive ping paused
between 02:00 and 06:00 Sydney time and Render spun the free service down.
**That pause no longer exists** — the cron-job.org ping runs every 13 minutes,
24/7, staying under Render's 15-minute idle timeout, so the process never spins
down on its own. Deploys are the only restarts left. Every name and vote from
every session therefore stays in memory indefinitely, which turns the old
"a restart clears it eventually" assumption into no bound at all.

This was an explicit choice (`estimator-plan.md` decision #14: "Session TTL:
none"), taken when nightly spin-downs made it self-correcting, so this feature
**supersedes #14**.

## Rules

| Session state | Backend deletes it                                       |
| ------------- | -------------------------------------------------------- |
| Ended         | 1 hour after `endedAt`                                   |
| Open          | 1.5 hours after its last activity (`lastActivityAt`)     |

- **Activity** is anything a person actually did: creating the session, joining
  it, voting, **and opening it** — a socket connecting to the session resets the
  clock. That last one matters: in a real meeting everyone votes in the first
  ten minutes and then talks, so a vote-only definition would delete the session
  out from under a discussion. A refresh, a latecomer, or a second tab all keep
  it alive; a genuinely abandoned session still dies on schedule.
- **A pure read never extends it.** `GET /sessions/:id`, `getSession` and
  `validateAdminToken` leave the clock alone, so a monitor or a crawler can't
  keep a dead session alive.
- **An ended session's clock runs from `endedAt`**, never `lastActivityAt`, so
  ending a session restarts the countdown rather than inheriting the last vote's.
- **Boundary**: exactly at the TTL is kept; TTL + 1 ms is deleted (strict `>`).
- Each session's clock is its own — a busy session never keeps an abandoned one
  alive.
- An expired session is **deleted outright**, not tombstoned — indistinguishable
  from one that never existed: `404 UNKNOWN_SESSION` over REST,
  `UNKNOWN_SESSION` over WS. No new `ErrorCode`; an "expired" marker would mean
  remembering the id, which defeats the point.
- Each TTL is one constant, so tuning either is a one-line change.

## Design

Two mechanisms, so the TTL is exact without a tight timer:

1. **Lazy expiry on read** (exactness). Every lookup checks expiry first and
   deletes + treats as missing if expired. A session is never served past its
   TTL, however far away the next sweep is.
2. **Periodic sweep** (memory). Every minute, delete everything expired, so
   sessions nobody looks at again still leave memory. It also disconnects any
   sockets still sitting in an expired session's room.

Domain purity holds: `sessionStore.ts` owns the rule and returns deleted ids; it
never imports Socket.IO. The timer and the socket disconnects live in the WS
layer, started from `server.ts`.

## 1.1 `src/types.ts`

- Add `lastActivityAt: Date` to `SessionState`.

## 1.2 `src/sessionStore.ts`

- Constants (a domain rule, so here rather than `config.ts`; no env override):
  - `ENDED_SESSION_TTL_MS = 60 * 60 * 1000`
  - `OPEN_SESSION_TTL_MS = 90 * 60 * 1000`
  - `SESSION_SWEEP_INTERVAL_MS = 60 * 1000`
- `isExpired(session, now)` — ended: `now - endedAt > ENDED_SESSION_TTL_MS`;
  open: `now - lastActivityAt > OPEN_SESSION_TTL_MS`.
- `createSession`: set `lastActivityAt` to the same `Date` as `createdAt`.
- `getSessionOrThrow` and `getSession`: if the entry is expired,
  `sessions.delete(id)` and behave as if it was never there (throw
  `UNKNOWN_SESSION` / return `undefined`). Every other export already goes
  through one of these, so expiry is enforced everywhere with no per-call checks.
- `addParticipant`, `selectSquare`: after all validation passes, set
  `session.lastActivityAt = new Date()`. A rejected action (bad name, invalid
  square, ended session) does not count as activity.
- New export `touchSession(sessionId): void` — resets the clock for an open
  session, ignored for an ended one (its clock is `endedAt`). Called by the WS
  layer when a socket connects. It is the one deliberate write on an otherwise
  read-shaped path, so give it a name that says so rather than hiding it in
  `getSession`.
- New export `sweepExpiredSessions(now = new Date()): string[]` — delete every
  expired entry, return their ids.
- Time comes from `new Date()`, not an injected clock; tests control it with
  `vi.useFakeTimers()` + `vi.setSystemTime()`, so no existing signature changes.

## 1.3 `src/ws/handlers.ts`

- In the `connection` handler, after the session is found and before
  `session-info` is emitted, call `touchSession(session.id)`.
- Nothing else. Handlers capture the `session` object at connect but pass
  `session.id` into the store, so a socket acting on an expired session (in the
  up-to-one-minute window before the sweep disconnects it) already gets
  `UNKNOWN_SESSION` through `withErrorHandling`.

## 1.4 `src/ws/sessionSweeper.ts` (new)

```ts
export function startSessionSweeper(io: AppServer, intervalMs = SESSION_SWEEP_INTERVAL_MS): () => void
```

- `setInterval` → `sweepExpiredSessions()` → for each id,
  `io.in(id).disconnectSockets(true)`.
- `.unref()` the timer so it never keeps the process (or a test run) alive.
- Returns a `stop()` that clears the interval — part 3's shutdown calls it.
- Log one line per sweep that deleted anything (`console.log`, count only — no
  ids or names).

## 1.5 `src/server.ts`

- `startSessionSweeper(io)` after `registerSocketHandlers(io)`, keeping its
  `stop()` for part 3. Still the only file that starts anything.

## 1.6 Tests

Follow `test-conventions`: assert the specific `ErrorCode`, pair each boundary.

- `tests/sessionStore.test.ts`, with `vi.useFakeTimers()`:
  - ended session: `getSession` at `endedAt + 1 h` → still there; at
    `+1 h +1 ms` → `undefined`
  - ended session past its TTL: `addParticipant`/`selectSquare` throw
    `UNKNOWN_SESSION`, not `SESSION_ENDED`
  - open session, untouched: boundary pair at `createdAt + 1.5 h`
  - activity extends it — isolate each source (`addParticipant` alone,
    `selectSquare` alone, `touchSession` alone): act at 1 h, alive at 2 h 30 min,
    gone at 2 h 30 min + 1 ms
  - a **rejected** action does not extend it (invalid square at 1 h → gone at
    1 h 30 min + 1 ms)
  - pure reads do not extend it (`getSession`/`validateAdminToken` at 1 h →
    gone at 1 h 30 min + 1 ms)
  - `touchSession` on an ended session does **not** postpone its deletion
  - an ended session uses its own TTL from `endedAt` (vote at 0, end at 30 min
    → alive at 1 h 20 min, gone at 1 h 30 min + 1 ms)
  - two sessions with different clocks: expiring one leaves the other intact
  - `sweepExpiredSessions` returns exactly the expired ids and leaves the rest
- `tests/sessions.test.ts`: `GET /sessions/:id` for an expired session → `404`
  `{ error: 'UNKNOWN_SESSION' }`
- `tests/handlers.test.ts`: connecting to an open session resets its clock (via
  the store, not a timer)
- `tests/sessionSweeper.test.ts` (new; real `io`): a connected client in an
  expired session is disconnected by a sweep; a client in a live session is not.
  This is the wiring test `verify-before-assuming` asks for, since `server.ts`
  itself stays untested.
  **Fake timers here need care**: Socket.IO runs its own ping and timeout
  intervals, and freezing every global timer under a live server tends to hang.
  Use `vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })`
  so `setTimeout` and the socket's own scheduling keep running, or age the
  session with `setSystemTime` and invoke the sweep directly.

## 1.7 Docs

- `estimator-plan.md`: rewrite decision #14; adjust the "no rate limiting" note
  (Render restarts bounding junk → the TTL bounds it) and the manual test list.
- `CLAUDE.md`, "State is in-memory": sessions are deleted 1 hour after ending or
  1.5 hours idle, on top of being wiped by restarts.
- `README.md` / `DEPLOYMENT.md`: one line wherever session lifetime is described.

---

# Part 2 — Cross-tab sync

## The problem

A second tab on the same session already enters correctly: the admin token is in
`localStorage`, so the loader redirects to `/start`, the socket sends
`admin-auth`, and its reply carries the current selection (decision #19). That
snapshot is taken once. After it, a vote in tab 1 never reaches tab 2 — both
write the same `participant.selection`, last write wins, and the other tab shows
something stale. That's decision #20, accepted then, **superseded here**.

Today this affects the admin only: a participant's identity isn't persisted, so
their second tab joins as a new participant. The fix is built per participant
anyway, so it covers participants for free if identity is ever persisted
(decision #7).

## Why server-side rather than browser-to-browser

Browsers can message between tabs directly, which would need no backend change.
It was rejected: the server stays the single source of truth, the select/clear
rule is computed in exactly one place, and nothing depends on two tabs sharing a
browser or a device. Any future client gets correct behaviour without
reimplementing anything.

## Design

Each socket joins a room of its own participant, and a selection is sent to that
room rather than acked to the one calling socket. The hidden-votes invariant
holds: the room contains exactly one participant's sockets, so no other
participant learns anything, and `session-ended` remains the only message that
crosses participants.

The server also becomes the only place the select/clear rule is computed. Today
it reports the square that was clicked and each tab infers the meaning — fine
when only the clicking tab hears it, wrong the moment a second tab does, since
the two would infer from different starting points. So the new message reports
the outcome instead.

**The changeover uses a new event name rather than a changed payload.** A normal
selection looks identical in both formats — they differ only when a vote is
cleared — so a tab cannot tell which format it is holding. With a new name there
is nothing to detect: old frontends ignore an event they have never heard of and
carry on exactly as today, so the backend can ship first and break nothing.

## 2.1 Backend, step 1 — add the new event

### `src/sessionStore.ts`

- `selectSquare` returns the resulting `Selection | null` instead of `void`. The
  rule itself doesn't change.
- Revise the comment describing two admin tabs as last-write-wins with no live
  sync: the overwrite stays, the silence doesn't.

### `src/ws/events.ts`

- Add `SelectionChanged: 'selection-changed'` to `WsEvent`, with payload
  `Selection | null` in `ServerToClientEvents`.
- Leave `selection-acknowledged` exactly as it is for now.

### `src/ws/handlers.ts`

- `participantRoom(sessionId, participantId)` — one helper, named once.
  **Namespace it with the session id** (`` `${sessionId}:${participantId}` ``):
  Socket.IO has one flat room namespace per server, already holding a room per
  session id, and with many sessions live nothing else keeps the two kinds of
  name apart. It also makes rooms readable in logs.
- `handleJoin` and `handleAdminAuth`: after setting `socket.data.participantId`,
  `socket.join(participantRoom(...))`.
- `handleSelectSquare`: emit `selection-changed` to that room with what
  `selectSquare` returned, **and** keep emitting `selection-acknowledged` to the
  calling socket exactly as today.

### Tests (`tests/handlers.test.ts`)

- Two sockets authenticated with the same admin token: a selection on one
  produces `selection-changed` on both.
- A participant socket in the same session receives nothing — the invariant
  test, and the one that would catch a mis-scoped room.
- Two sessions live at once: a selection in session A never reaches session B,
  including when both have a participant with the same name.
- Clearing a vote (same square twice) sends `selection-changed` with `null`.
- `selection-acknowledged` still fires for the clicking socket (it is still the
  live protocol until step 4).

## 2.2 Frontend, step 2 — `master` (prototype), then step 3 — `release/design`

Same edit on both branches; separate test runs.

- `src/types/protocol.ts`: add `selection-changed` with payload
  `Selection | null`. Leave the old event's type until step 5.
- `src/lib/sessionConnectionRegistry.ts`: listen to `selection-changed` and
  dispatch `SELECTION_ACKED` with the payload; stop listening to
  `selection-acknowledged`.
- `src/lib/sessionConnectionReducer.ts`: `SELECTION_ACKED` stores the payload
  as-is. The `toggleSelection` helper and its comment ("The ack echoes the
  requested Square, not the result…") are deleted — the server owns it now.
- Nothing else: the loaders, the store and the components already re-render from
  state.
- Tests: the reducer applies `null` as a cleared selection and a square as-is,
  without consulting previous state; two simulated tabs converge.

## 2.3 Backend, step 4 — remove the old event

A separate commit, once both frontends are verified on `selection-changed`:

- Delete the `selection-acknowledged` emit, its `WsEvent` entry and its
  `ServerToClientEvents` type.
- Delete the frontend's now-unused type in the same round.
- Check no redesign branch is still listening for it before this ships — this is
  the one step in the whole plan that can break a client.

## 2.4 Docs

- `CLAUDE.md`, the "No cross-tab admin sync" bullet: replace with the
  room-per-participant behaviour, keeping the note that admin tabs still share
  one `adminParticipantId`.
- `estimator-plan.md`: decision #20 and the manual-test line "two admin tabs →
  tab 2 does not live-update" both invert.

---

# Part 3 — Operational hardening

Backend only. No protocol change, no frontend work, no coordination — every item
here can ship on its own.

The architecture is sound: typed Socket.IO generics, identity held in
`socket.data` and never read from a payload, an error boundary around every
handler, one shared `http.Server`, CORS as an allowlist validated at boot. What
is missing is the operational layer, and it matters more now that deploys are
the only restarts this service gets.

## 3.1 Graceful shutdown (`src/server.ts`)

Render sends `SIGTERM` on every deploy. Nothing listens for it, so sockets are
severed mid-frame and in-flight requests are dropped.

- On `SIGTERM` and `SIGINT`: stop the sweeper (part 1's `stop()`), `io.close()`
  to disconnect clients cleanly, then `httpServer.close()`, then exit 0.
- A force-exit timer (10 s, `.unref()`) so a stuck socket can't hang the deploy.
- Guard against a second signal re-entering the handler.
- Add `httpServer.on('error', …)` — a port conflict currently crashes with a raw
  stack trace instead of a readable message.

A clean `io.close()` makes clients see a real disconnect, so the frontend shows
its connection-lost state instead of stalling until a ping timeout.

## 3.2 Validate socket payloads (`src/ws/schemas.ts`, new)

REST bodies go through zod; socket payloads are trusted because TypeScript says
so — but types are erased at runtime and a socket client can send anything.
Today a `join` carrying an object instead of a string reaches `name.trim()`,
throws a TypeError, and is reported to the client as `INTERNAL_ERROR`: nothing
crashes, but the protocol misreports a bad request as a server bug.

- Schemas mirroring `ClientToServerEvents`: `join`, `admin-auth` and
  `end-session` (string), `select-square`
  (`z.object({ time: z.number(), resource: z.number() }).strict()`).
- Parse at the top of each handler, inside `withErrorHandling`.
- `withErrorHandling` gains a `ZodError` branch emitting `INVALID_REQUEST` — the
  mapping `middleware/errorHandler.ts` already does for REST, so both transports
  report the same thing the same way.
- Tests: a garbage payload on each event gets `INVALID_REQUEST`, not
  `INTERNAL_ERROR`, and never mutates the session.

## 3.3 HTTP and socket limits (`src/app.ts`, `src/ws/ioServer.ts`)

- `helmet()` before the routes (also drops `x-powered-by`).
- `express.json({ limit: '8kb' })` — the default 100kb is generous for a body
  this small.
- `maxHttpBufferSize` on the Socket.IO server, well below its 1MB default.

## 3.4 Readable validation errors (`src/middleware/errorHandler.ts`)

The `ZodError` branch returns `err.message`, a JSON blob of issues. Format the
issues into a sentence — the frontend puts this string straight into its error
banner.

## 3.5 Noted, not done

- **`withErrorHandling` is sync-only** (`fn: () => void`), so a rejected promise
  would escape it. Fine while everything is synchronous. It is the first thing
  to fix if the store ever moves to Redis — and the easiest to forget, because
  nothing fails until a handler becomes async.
- **No participant cap, no rate limit on `POST /sessions`** — decided against.
  Part 1's TTL is what bounds memory; revisit only if this is ever exposed
  somewhere less trusted than a shared team link.
- **Structured logging** (`pino` over `console.*`) — not worth the dependency at
  this size; the `/healthz` heartbeat is the log contract
  (`docs/features/healthz-heartbeat.md`).

---

# Shipping order

Parts 1 and 3 are single backend deploys that need no frontend coordination.
Part 2 is four deploys, and **none of them can break a live site** — the only
risky step is the last, which is why it comes after verification.

1. **Part 1, backend TTL** → deploy. Sessions now expire; nothing else changes.
2. **Part 3, hardening** → deploy (any time; graceful shutdown improves every
   deploy after it, and it calls part 1's sweeper `stop()`, so it follows step 1).
3. **Part 2 step 1, backend** sends `selection-changed` alongside the old event
   → deploy. Invisible: no frontend is listening yet.
4. **Part 2 step 2, `master`** switches to the new event → test → deploy →
   verify on the prototype with two tabs, including clearing a vote.
5. **Part 2 step 3, `release/design`** → test → deploy → verify the same way on
   fold-and-flip.
6. **Part 2 step 4, backend** removes `selection-acknowledged` → deploy. Check
   first that no other branch still listens for it.

Each backend deploy restarts the service and wipes every live session at once —
with several teams estimating simultaneously, that interrupts all of them. Ship
when nobody is mid-session.

# What this means for Render

Nothing here requires a Render setting to change, and two of the three parts fit
the platform better than what they replace.

**Memory — the strongest platform-specific argument for part 1.** The keep-alive
ping holds the process up around the clock, so nothing clears memory any more
except a deploy. Without a TTL, sessions accumulate indefinitely on a free
instance with a few hundred MB of RAM: slowly, but with no ceiling, and the
ending is an out-of-memory kill rather than a clean restart. Part 1 turns
unbounded growth into "whatever was touched in the last 1.5 hours".

**Deploys — part 3.1 aligns with how Render stops a service.** Render sends
`SIGTERM` and kills the process shortly after if it hasn't exited. Today nothing
listens, so sockets are cut mid-frame; the graceful shutdown closes them within
its 10-second cap, comfortably inside that window, and tabs show connection-lost
instead of hanging. Sessions are still lost on every deploy — no instance swap
carries memory across — but the failure becomes visible rather than silent.

**Unchanged:**

- The keep-alive cron is still required. Spin-down is judged on inbound HTTP
  traffic, so the sweeper's internal timer is invisible to Render, and the
  `/healthz` health check is not a substitute.
- Health check path, build filters and env vars are untouched. The `**/*.md`
  ignored-paths rule means doc commits (including this plan) don't trigger a
  deploy, so writing them can't interrupt a live session.
- Log volume barely moves: the sweeper logs only when it deletes something.

**Worth knowing:**

- **The instance-hours margin is easier to buy back.** 24/7 pinging is ~744 of
  the 750 free hours a month. If that ever gets tight, reinstating a nightly
  pause is safer than it was: memory hygiene no longer depends on that restart,
  so the only cost is a cold start for a 2–6am session, which doesn't happen.
- **The single-process assumption gets one notch stronger.** Part 2's rooms live
  inside one process, exactly like the session store. Running more than one
  instance would need sticky routing plus a Socket.IO Redis adapter, on top of
  moving the sessions themselves. That was already true; it is now true in two
  places instead of one.
- If persistence is ever wanted, Render's own Key Value (Redis) offering keeps
  this a single-vendor setup — the same async rewrite of the store either way.

## Free-tier policy check

Checked against Render's own documentation
([Deploy for Free](https://render.com/docs/free)) and its
[Acceptable Use Policy](https://render.com/acceptable-use). **None of the three
parts introduces anything the free tier disallows**, and two of them lower
resource use:

- The sweeper generates **no traffic** — it's a one-minute in-process timer that
  deletes map entries. Nothing outbound, nothing billed against bandwidth.
- The TTL **reduces** memory held, and graceful shutdown makes the process exit
  promptly on `SIGTERM` instead of being killed. Both cut consumption rather
  than raise it.
- Part 2 adds one extra socket message per click, to one person's own tabs.
  Immaterial.
- No background jobs, no scheduled work inside the service, no scraping, no
  mining, no second free service in the workspace.

Two details worth recording, neither caused by this work:

- **Instance hours are the enforced limit.** 750 per workspace per calendar
  month; exceed them and every free web service is suspended until the month
  resets. Pinging 24/7 uses ~744. Part 1 is what makes reinstating a nightly
  pause safe if that margin ever needs widening.
- **The keep-alive ping is the only grey area, and it predates this work.**
  Render's docs describe spin-down as product behaviour and say nothing against
  pinging, while the AUP prohibits circumventing usage restrictions; hours are
  the mechanism that actually meters free usage, and the ping stays well inside
  them. Nothing here changes the ping's frequency or purpose, so the risk is
  exactly what it was. Judgement, not a guarantee — enforcement is at Render's
  discretion.

**What the ping is for.** Render counts **WebSocket messages on existing
connections** as inbound traffic for the 15-minute spin-down timer, not just HTTP
requests — so a session with tabs open keeps the service awake on its own. The
cron ping exists for the other case: the app sitting unused between meetings,
where a spin-down would cost the next person a cold start of about a minute
before they can even create a session. It is a heartbeat for idle periods, not a
way to squeeze more out of the free tier — during actual use the app keeps
itself awake without it.

# Breaking changes

- **Nothing breaks during steps 1–5.** A new event name means old clients ignore
  what they don't know, so the backend leads and the frontends follow at their
  own pace.
- **Step 6 is the only breaking step.** Any client still listening for
  `selection-acknowledged` stops showing its own vote at that moment. It ships
  only after both frontends are verified, and only after checking the redesign
  branches.
- **Part 1 breaks no protocol** — an expired session is the `404` /
  `UNKNOWN_SESSION` that already exists — but the behaviour change is real: a
  link stops working 1 hour after the reveal, or 1.5 hours after a session goes
  quiet.
- **Part 3's only client-visible change** is that a malformed socket payload
  comes back as `INVALID_REQUEST` instead of `INTERNAL_ERROR` — an existing code,
  for a case no real client produces.
- **Not breaking, but adjacent:** moving the store to Redis later would make
  every `sessionStore` function async and touch every call site. Redis would also
  replace the sweeper with per-key expiry, and is the prerequisite (with the
  Socket.IO Redis adapter) for ever running more than one instance.

# Verify

The tests carry the timing. For a manual pass, run the backend locally with the
TTL constants and sweep interval temporarily set to seconds:

- End a session, then reload its link before and after the ended TTL → reveal,
  then `/not-found`.
- Leave a joined tab idle past the open TTL → connection lost.
- Reload a session's page during that idle window → the clock resets and it
  survives past where it would otherwise have expired.
- Two admin tabs on one session → a click in either moves the highlight in both,
  including clearing a vote.
- Two admin tabs on **different** sessions in the same browser → clicks stay in
  their own session.
- A participant tab open alongside → sees nothing until the session ends.
- After step 6, repeat the two-tab check on both frontends.

# Considered and dropped

- **Caching the reveal in the browser.** Every tab connected at the end already
  receives the full reveal, so it could be saved to `sessionStorage` and shown
  after the backend forgot the session. It earned its place when ended sessions
  were to be deleted after 10 minutes; at 1 hour it only helps someone still
  looking at a reveal an hour later, which didn't justify a new storage module
  and a cache-first path through the loaders on two branches. Revisit if the
  ended TTL is ever shortened.
- **A distinct "expired" response.** Keeping a list of expired ids would let
  `/not-found` say "this session has expired" rather than "no such session". It
  means remembering ids after deleting their data, for a copy improvement.
  Dropped: deleted means deleted.
- **Browser-to-browser tab messaging** for part 2 — see *Why server-side*.

# Side effects and trade-offs

- **An open session dies 1.5 hours after the last person opens or uses it.**
  Opening counts, so a meeting only loses its session if nobody touches any tab
  for that long.
- **A shared link stops working** an hour after the reveal. That is the privacy
  goal working, but someone who opens the link late sees `/not-found` with no
  explanation that it once existed.
- **Cross-tab sync covers one person's own tabs**, admin or participant, on any
  device — but a participant still has no persisted identity, so in practice it
  is the admin who has two tabs.
- **Rooms grow with participants, not sessions** — one extra room per
  participant, holding one or two sockets. Negligible next to the socket each
  already costs.
- **Restarts still wipe everything earlier.** TTLs are a maximum lifetime, not a
  guarantee.
- **Memory is bounded** by the sessions touched in the last 1.5 hours, however
  long the process stays up.
