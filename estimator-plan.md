# Estimator — Sprint Planning Poker App

## Context

The user wants a fullstack sprint-estimation app ("planning poker" with a 2D twist: a time × resources grid instead of a single point value), specified in a Notion doc (`Estimator`) plus a linked Miro board of wireframes (now reviewed via the Miro MCP server — see below). The app has two roles (admin/participant), no accounts, and needs realtime sync via WebSockets so a group can vote simultaneously during a sprint-planning session and reveal results together.

This is a greenfield build. Per the user's ask, it will live as **two separate top-level folders** under `/Users/rachelwong/Projects/` — `estimator-frontend/` and `estimator-backend/` — matching this workspace's existing convention (no monorepo; see `folio-2026`, `folio21` as siblings, each its own top-level project). TypeScript is used throughout, matching the newest sibling project (`folio-2026`).

**Original specification sources**:
- Notion spec: https://app.notion.com/p/rachelwong/Estimator-3bb375d34b3480548d26edd98dcc8a11
- Miro wireframes: https://miro.com/app/board/uXjVH-RcLGw=/ — now reviewed via the Miro MCP server. 113 items, forming 3 static screen mockups: admin session-creation view, non-admin join view, and a shared ended-session reveal view (no flow diagrams/arrows — just screen layouts, no additional sequencing logic beyond the Notion spec). Findings and how they were reconciled with the Notion spec are in "Miro wireframe review" below.

## Resolved product decisions (confirmed with user)

1. **Persistence**: in-memory only on the backend, no database. Restarting the server loses all sessions — accepted tradeoff.
2. **Admin auth**: the browser that creates a session is remembered as admin via a real secret `adminToken` (not just a client-side flag) stored in `localStorage`, and the server re-validates that token before honoring admin actions.

   *Why `localStorage`, not `sessionStorage`*: `sessionStorage` is scoped per-tab — a new tab to the same session link would get an empty `sessionStorage` and fall through to the non-admin name-entry flow instead of being recognized as admin, which is the opposite of the multi-tab behavior decisions #19–20 rely on (the admin's second tab authenticating as the same participant, current selection included). `sessionStorage` also clears the instant a tab closes, not just when explicitly cleared — an admin accidentally closing one tab (not the whole browser) mid-session would permanently lose admin control with no recovery, a much easier accident than the already-accepted "clearing storage or switching devices loses control" tradeoff below. Security is identical either way (both are equally readable by same-origin JS), so there's no offsetting benefit.
3. **Fibonacci scale**: fixed sequence `[0, 1, 2, 3, 5, 8, 13, 21, 34, 55]`. The admin's slider (0–64) picks a ceiling; grid axis values are the prefix of this sequence `<= ` that ceiling (so 55 is the practical max; 64 is just the slider's outer bound).
4. **Numerical scale**: every integer from 0 to the admin's chosen slider value (slider range 0–20).
5. **Task context**: out of scope — no task title/description field.
6. **Vote visibility**: hidden during the session (classic reveal-at-end poker semantics) — no participant sees others' selections, or even that others have selected, until the admin ends the session.
7. **Reconnect identity**: no persistence — a refresh/reopen always re-prompts for a name while in progress (duplicate-name suffixing handles repeats, e.g. `Jim`, `Jim-1`, `Jim-2`).
8. **Language**: TypeScript, both repos.
9. **Deployment**: concrete services chosen now — **Vercel** (frontend, free tier) and **Render** (backend, free tier "Web Service," supports long-lived WebSockets without a credit card).
10. **Vote changing**: confirmed by the spec's own text ("they can change that selection by clicking on another square") — a participant can click a different square any time before reveal to move their vote. Clicking the *currently-selected* square again clears it back to no selection (voluntary un-vote, not otherwise specified but symmetric with "abstained = no selection at reveal"). Server-side this is just reassigning (or nulling) `participant.selection` — no new backend concept, just needed calling out explicitly since the plan's component/handler text didn't previously say changing/clearing was intentional rather than unhandled.
11. **Orphaned votes on refresh**: accepted as a known risk, not engineered around. A refresh creates a new participant record (per decision #7); the prior record's vote, if any, is **not** removed and still counts in the final reveal under the old, now-orphaned name. If that person votes again under their new (possibly suffixed) name, they can end up counted twice. This is a direct consequence of decision #7 (no reconnect identity) — fixing it would mean tracking identity across reconnects, which contradicts that decision, so it's left as-is and documented rather than hidden in a Verification-section aside.
12. **Abstained scope**: "Abstained" means "joined at some point and had no selection recorded by reveal time" — there's no server-side tracking of live-vs-disconnected sockets for this purpose. A participant who joined and closed their tab without voting still appears in Abstained, indistinguishable from someone who stayed connected and chose not to vote.
13. **WS error UX**: a custom lightweight dismissible banner component (not a shadcn `toast`/`sonner` primitive) renders on any `error` WS event the client receives — covers both adversarial cases (forged admin token) and legitimate races (a stale `select-square` arriving just after the admin ends the session).
14. **Session TTL**: none. Sessions live in the in-memory Map indefinitely; only a server restart (Render's free-tier spin-down, or a manual redeploy) clears them — consistent with the already-accepted in-memory/no-persistence tradeoffs.
15. **Presence indicator**: deliberately out of scope. The spec only ever describes participant names becoming visible at reveal; no "N people joined" count or live participant list is shown during an active session.
16. **Mobile/responsive support**: out of scope. Desktop-only, matching the 3 reviewed wireframes; no responsive breakpoints planned for `EstimationGrid` or any other layout.
17. **CI/test gating**: none. Render and Vercel deploy directly on push; `npm test` is run locally before pushing, no GitHub Actions workflow gates either deploy.
18. **Grid accessibility**: click/tap only. `EstimationGrid` gets no keyboard navigation (no `tabIndex`, arrow-key handling, or ARIA roles) — matches the wireframes' click-based interaction and the plan's stated reason for hand-building the grid in the first place (minimal extra scope beyond what a shadcn primitive would give for free).
19. **Admin state on reconnect**: `admin-auth`'s server response (`admin-acknowledged`) includes the admin participant's current `selection`, not just their id/name — a correctness fix, not just a two-tab nicety. Without it, *any* admin reconnect (a second tab, or simply refreshing their own tab after already voting) would render a blank grid even though the vote survived server-side, since `GET /sessions/:id` deliberately omits participant data for in-progress sessions.
20. **Cross-tab live sync (admin)**: not implemented. Because the adminToken is the one identity that persists across reconnects (unlike non-admin participants, who always get a fresh identity per decision #7), opening the same session link in two tabs authenticates both as the same admin participant — but selecting a square in one tab does not push a live update to the other. Last write wins server-side; the other tab only catches up on its own next reconnect. Accepted as consistent with the project's minimal-scope posture elsewhere — using two tabs as the same admin is a rare, self-inflicted scenario, not one worth new per-participant multi-socket bookkeeping.
21. **Double `end-session`**: idempotent. A second `end-session` call on an already-ended session (two tabs, or a double-click race on the confirm dialog) is a silent no-op, not surfaced via `ErrorBanner` — it's a harmless redundant call, not a real failure.

## Miro wireframe review

Reviewed via the Miro MCP server (113 items across 3 static screen mockups: admin session-creation view, non-admin join view, and a shared ended-session reveal view — no flow diagrams/arrows, so no sequencing logic beyond what the Notion spec already describes).

**Confirms existing plan decisions**:
- The admin's view shows its own interactive grid (same Time/Resources axes as the non-admin view) with an "End session" button in its header — visually confirms the design assumption that the admin is a normal participant who also votes, with an added end-session capability.
- The ended-session view shows names placed inside the squares they selected (example names: James, Mary, John, Jim) and a separate line below the grid ("Abstained: Henry") — matches the planned reveal payload shape and `AbstainedList` component.

**Reviewed against the wireframe's literal wording, deliberately kept as-is (confirmed with user)**:
- Fibonacci sequence stays `[0,1,2,3,5,8,13,21,34,55]`, despite the wireframe's dropdown option text reading "fibonacci sequence (from 2 onwards)" (which read literally would drop the leading 1).
- Max-value control stays a graphical Slider (shadcn), despite the wireframe's box being labeled "input text field" — the Notion spec's explicit "range slider" wording takes precedence.
- Point-system selector stays a RadioGroup, despite the wireframe's box being labeled "dropdown list" — 2 mutually-exclusive options are better served visible-at-once than behind a dropdown.

**New findings, added to the plan below**:
- The ended-session reveal view includes a "Create new" action, not previously specified — added to `SessionPage`'s ended-view rendering as a button navigating back to `/` (no state carried over, consistent with "always fresh join").
- Confirmed button copy: the admin's session-launch button reads "Start Session"; the non-admin join button reads "Enter Session" — used as the actual button labels below rather than placeholders.
- Section headings from the wireframe — "Create a new session" (admin/root flow) and "Join a session" (non-admin flow) — used as page headings on `CreateSessionPage` and `NameEntryGate` respectively.

## Architecture

**Backend**: Node.js + TypeScript + Express (small REST surface: create/read session) + **Socket.IO** for the realtime layer. Render's free tier exposes a single port, so REST and Socket.IO share one `http.Server` (`new SocketIOServer(httpServer, { cors: {...} })` attaches the same way raw `ws` would, so the single-port constraint is satisfied either way).

**Why Socket.IO over raw `ws` (reversing the original draft's choice):**
- **Rooms map directly onto sessions.** Each socket does `socket.join(sessionId)` on connect; ending a session is one call, `io.to(sessionId).emit('session-ended', reveal)`, instead of hand-maintaining a `Map<sessionId, Set<WebSocket>>` and iterating it to broadcast.
- **Built-in, declarative CORS.** `new SocketIOServer(httpServer, { cors: { origin: allowlist } })` covers the realtime layer the same way Express's `cors()` middleware covers REST. Raw `ws` has no equivalent — the `upgrade` event handler would need a hand-rolled `req.headers.origin` check living in a completely different code path from the Express CORS config, which is easy to forget and easy to get out of sync. This was flagged as a risk in the original draft; Socket.IO removes it.
- **Graceful degradation.** If a participant is on a network that blocks raw WebSocket upgrades (corporate proxy, some VPNs — plausible for a work sprint-planning tool), Socket.IO transparently falls back to HTTP long-polling. Raw `ws` has no fallback; that participant simply can't connect.
- **Tradeoff accepted**: Socket.IO's client auto-reconnects by default, which would fight the "always fresh join" decision (a network blip should not silently resume a session). This plan explicitly sets `{ reconnection: false }` on the client to keep that behavior intentional rather than accidental — see Frontend section below.
- **Cost accepted**: a slightly heavier client bundle and Socket.IO's own event-framing on top of the WebSocket transport — irrelevant at this app's scale (a handful of message types, small ad-hoc sessions).

**Hybrid REST + WS model**: `GET /sessions/:id` gives an instant read of session status before opening a socket. For an **ended** session, the frontend never opens a WebSocket at all — the REST response already contains the full reveal payload (grid + abstained list), since nothing about an ended session can change. WS is reserved for the truly realtime parts: joining, selecting a square, and push-ending a session to everyone's open tab.

**Frontend**: Vite + React 19 + TypeScript + React Router. Two routes: `/` (create-session form) and `/:sessionId` (join/vote/reveal — branches on session state + presence of a stored admin token). UI components come from **shadcn/ui** (Tailwind CSS + Radix primitives, installed via the `shadcn` CLI, which copies component source into the repo rather than pulling an opaque npm dependency) for every standard control — buttons, form fields, slider, confirm dialog. The bespoke `EstimationGrid` (whose column/row count is runtime data) is hand-built with Tailwind utility classes + inline `style` for the dynamic `grid-template-columns/rows`, since no shadcn primitive models a data-driven NxN grid. Tailwind itself is a project-wide dependency either way (shadcn's components are Tailwind-styled under the hood), so the grid can freely use Tailwind utilities alongside its dynamic inline sizing rather than a separate CSS Modules file.

**Design assumption (flagging for visibility, not re-asking)**: the admin is created as a participant record at session-creation time (using their name), so `adminToken` simply grants an *additional* capability (ending the session) on top of normal participant behavior — they can vote and can end up in "Abstained" like anyone else. This avoids special-casing the admin throughout the data model and matches the spec's "all admin and non-admin users ... make a selection" language.

**Invariant to enforce everywhere**: no participant's name, selection, or existence is ever sent to another non-owning client before the session ends. Only a client's own join/selection acknowledgements are sent.

## Backend (`estimator-backend/`)

**Data model** (`src/types.ts`): `SessionState` holds `id`, `adminToken`, `adminParticipantId`, `pointSystem: { type, sliderMax, axisValues }`, `participants: Map<id, Participant>`, `ended`, timestamps. `Participant` holds `id`, `name`, `selection: {time, resource} | null`, `isAdmin`. Sessions live in a module-level `Map<string, SessionState>` (`sessionStore.ts`) — no DB.

**Session ID generation** (`utils/id.ts`): `sessionId` uses `nanoid/non-secure` (the `Math.random()`-backed variant of `nanoid`, not `crypto.getRandomValues`) with a custom alphanumeric alphabet (`a-zA-Z0-9`, matching the spec's own link example — no dashes), length 16 (~95 bits of ID space). This is a deliberate choice, not an oversight: a session ID is not a secret — it's a link meant to be shared with a whole team — so its only real requirement is practical uniqueness, not cryptographic unpredictability. `crypto` isn't "saved" as a dependency either way (Node's `crypto` module is a zero-cost built-in), so this is purely about using the right tool for a non-sensitive identifier rather than reflexively reaching for crypto-grade randomness everywhere. `adminToken` is the one identifier in this system that genuinely must resist guessing (it grants control over someone else's session), so it stays on `crypto.randomBytes(32)`. As a cheap defense-in-depth measure independent of which RNG is used, `sessionStore.createSession` regenerates on collision — `while (sessions.has(id)) id = generateSessionId()` — before inserting, so a freak collision can never silently clobber an existing session.

**Point scale** (`src/pointSystems.ts`): `computeAxisValues(type, sliderMax)` — fibonacci filters the fixed sequence `<= sliderMax`; numerical builds `0..sliderMax`. `validateSliderMax` enforces the 20/64 ceilings server-side (never trust client-only validation).

**REST** (`src/routes/sessions.ts`):
- `POST /sessions` — `{ adminName, pointSystem, sliderMax }` → `201 { sessionId, adminToken, adminParticipantId, adminName, pointSystem }`. Server-side validates name (`/^[A-Za-z0-9]{1,20}$/`) and scale bounds.
- `GET /sessions/:id` — public, no auth. In-progress response omits participant data entirely; ended response includes `reveal: { squares: [{time, resource, names}], abstained: [names] }`. `404` if unknown (never existed or lost to a restart).
- `GET /healthz` — for Render health checks.

**Realtime (Socket.IO)** (`src/ws/`): client connects to the default namespace with `sessionId` passed as a handshake query param (`io(url, { query: { sessionId } })`) — simpler than a dynamic per-session namespace. On `connection`, the server validates the session exists and calls `socket.join(sessionId)` so later broadcasts are a single `io.to(sessionId).emit(...)` call.

Client→server **events**: `join` (name), `admin-auth` (adminToken), `select-square` (time, resource — **server-validated against the session's own `axisValues` before being accepted**, same "never trust client-only validation" principle applied to `validateSliderMax` and admin-token checks elsewhere; an out-of-range or malformed `{time, resource}` — forged via devtools or a buggy client — is rejected with an `error` event rather than written into `participant.selection`. Once validated, it **overwrites** `participant.selection`; sending the same `{time, resource}` as the current selection clears it back to `null`, the deselect case from decision #10; any other in-range value moves the selection, the change-vote case), `end-session` (adminToken, **re-validated server-side even for an already admin-authenticated socket** — never trust a prior handshake alone). Server→client **events**: `session-info` (emitted directly to the connecting socket right after `connection`), `joined` / `admin-acknowledged` / `selection-acknowledged` — these are direct acknowledgements confirming the server processed that one socket's request, not broadcasts (emitted via `socket.emit(...)`, never `io.to(room)`, since they must not leak to other participants) — and `session-ended` (the one broadcast event — `io.to(sessionId).emit('session-ended', reveal)` — reaches every socket in the room the instant the admin ends it), `error` (any rejected request — bad token, unknown session, stale action on an already-ended session — the frontend surfaces these via the `ErrorBanner` component, decision #13).

**Name dedup** (`sessionStore.ts`): case-insensitive collision check against current participants, appending `-1`, `-2`, ... on collision.

File layout and engineering patterns are covered together in **Engineering conventions & folder structure** below. Dependencies: `express`, `cors`, `socket.io`, `nanoid`; dev: `typescript`, `tsx`, `vitest`, `@types/*`.

**`render.yaml`**: `type: web`, `runtime: node`, `plan: free`, `buildCommand: npm install && npm run build`, `startCommand: npm run start`, `healthCheckPath: /healthz`, `CORS_ORIGIN` set manually in dashboard once the Vercel domain is known. Server must bind `process.env.PORT`.

## Frontend (`estimator-frontend/`)

**`/` — `CreateSessionPage`**: heading "Create a new session" (per wireframe), name field, `PointSystemPicker` (numerical/fibonacci radio), `RangeSlider` whose min/max (0–20 vs 0–64) changes when the point system changes (co-dependent, per spec) — the current value **resets to 0** on every point-system switch, deliberately forcing the admin to consciously pick a max each time rather than silently inheriting a full-size grid from the previous selection. Submit button reads **"Start Session"** (per wireframe). On submit: `POST /sessions`, store `adminToken` in `localStorage['estimator:adminToken:' + sessionId]`, navigate to `/:sessionId`.

**`/:sessionId` — `SessionPage`**: on mount, `GET /sessions/:id` first, then branch — 404 → not-found view; `ended` → render `EstimationGrid mode="readonly"` + `AbstainedList` straight from REST plus a **"Create new session"** button (per wireframe) that navigates back to `/`, **no socket opened**; not ended + stored admin token present → open WS, send `admin-auth`, render interactive grid + `AdminControls`; not ended + no token → heading "Join a session" (per wireframe), `NameEntryGate` (submit button reads **"Enter Session"**, per wireframe) → on submit, open WS, send `join`, render interactive grid.

**Components** (built on shadcn/ui primitives where applicable):
- `PointSystemPicker` — shadcn `RadioGroup`
- `RangeSlider` — shadcn `Slider`, min/max/value reset on point-system change (co-dependent, per spec)
- `NameEntryGate` — shadcn `Input` + `Button`, with inline validation error text
- `SessionStatusHeader` — shadcn `Badge` ("In Progress" / "Ended")
- `ShareLink` — shadcn `Input` (readonly) + `Button` (copy-to-clipboard)
- `AdminControls` — shadcn `Button` + `AlertDialog` (confirm before ending — irreversible action)
- `EstimationGrid` — **custom**, not shadcn (data-driven `axisValues.length × axisValues.length` layout via Tailwind + inline `style`); interactive mode highlights only *your* selection and dispatches `select-square` on click, readonly mode renders every square's voter names from `reveal`. Clicking a different square while one is already selected moves the highlight and re-dispatches `select-square` (change-vote, decision #10); clicking the already-selected square again dispatches the clear/deselect case. Click/tap only — no keyboard navigation (decision #18). Cells with many names clustered on one square (a realistic outcome — teams often converge) wrap/truncate with a `+N more` affordance rather than silently overflowing the cell; this wasn't specified anywhere else, so it's called out explicitly here as an implementation requirement, not left to be improvised during the build.
- `AbstainedList` — shadcn `Badge` per name, in a simple flex-wrapped list
- `ErrorBanner` — **custom**, not shadcn (decision #13 chose a hand-rolled banner over pulling in `sonner`/`toast`) — a small dismissible banner mounted once near the top of `SessionPage`, driven by an `error` string/null piece of state that `useSessionSocket` sets whenever a WS `error` event arrives

shadcn setup: run `npx shadcn@latest init` (creates `components.json`, Tailwind config, `src/lib/utils.ts` for the `cn()` classname helper) once during scaffolding, then `npx shadcn@latest add button input slider radio-group badge alert-dialog` to pull in exactly the primitives listed above — each lands as editable source in `src/components/ui/`, not a black-box dependency.

**Hooks/lib**: `useSessionSocket` (Socket.IO client lifecycle via `socket.io-client`, connecting with `{ reconnection: false, query: { sessionId } }` — auto-reconnect is deliberately disabled so a network blip re-prompts for a name instead of silently resuming, matching "always fresh join"; also owns the `error` state surfaced by `ErrorBanner`, set on any incoming `error` event and cleared on dismiss or on the next successful action), `useAdminToken` (localStorage get/set/remove), `lib/api.ts` (fetch wrappers), `lib/socket.ts` (socket instance factory + typed `emit`/`on` wrappers for the event names above).

**Shared types**: hand-duplicate a small `types.ts` protocol file in each repo (message unions, `PointSystemConfig`, `RevealPayload`) with a comment pointing at its counterpart — appropriate given these are separate top-level folders and the protocol is ~6 message types; not worth a published package or submodule.

## Engineering conventions & folder structure

Both repos follow the same underlying principle: **keep domain logic free of transport/framework dependencies**, so the parts with real logic (point-scale math, session state transitions, WS lifecycle) are unit-testable without spinning up a server or a browser, and the transport layers (Express, Socket.IO, React components) stay thin and mostly declarative. Deliberately **not** introducing heavier patterns this app doesn't need — no repository/interface abstraction over `sessionStore` (there's exactly one storage backend, in-memory, with no plan to swap it — an interface would be pure ceremony), no feature-folder restructuring on the frontend (only 2 routes exist), no DI container.

### Backend (`estimator-backend/`)

**Composition root pattern**: `server.ts` is the only file that actually binds a port and starts anything — it builds the `http.Server`, mounts the Express `app` (imported from `app.ts`, itself just a factory that isn't auto-started), and attaches the Socket.IO server on top. `app.ts` being importable-but-inert means REST routes can be tested with `supertest` against an in-memory Express instance, no real network involved.

**Config module** (`src/config.ts`): a single place reads `process.env` once at startup (`PORT`, `CORS_ORIGIN`, `NODE_ENV`), validates presence/shape, and exports a typed config object — avoids `process.env.X` scattered through the codebase, and gives one file to update when a new env var is needed.

**Domain logic has zero framework imports**: `sessionStore.ts` and `pointSystems.ts` never import `express` or `socket.io` — they operate purely on the `SessionState`/`Participant` types and are called *by* the routes/handlers layer, not the other way around. This is what makes the unit tests in the Verification section possible without mocking HTTP or sockets.

**Consistent error contract**: `src/errors.ts` defines a small `AppError` class (`code`, `message`, `httpStatus`) covering the handful of real failure cases (invalid name, bad slider value, unknown session, bad admin token). One Express error-handling middleware (`src/middleware/errorHandler.ts`) turns any thrown `AppError` into the `{ error: code, message }` REST shape already specified; the Socket.IO handlers catch the same `AppError` type and emit the matching `error` event payload — one failure shape reused on both transports instead of two ad hoc ones.

**Module system (ESM), required for `nanoid` compatibility**: recent major versions of `nanoid` (including the `nanoid/non-secure` subpath used for `sessionId`) are ESM-only — no CommonJS export. Since the plan's production path is `tsc` build + `node dist/server.js` (not `tsx`, which is more lenient about interop), the backend must be set up as a genuine ESM project from the start: `"type": "module"` in `package.json`, `"module": "NodeNext"` / `"moduleResolution": "NodeNext"` in `tsconfig.json`. Getting this wrong surfaces as a runtime `ERR_REQUIRE_ESM` on `import { customAlphabet } from 'nanoid/non-secure'` the first time the compiled build actually runs, not at compile time — worth setting up correctly at scaffolding (build step 1), not discovering it at deployment.

**Out of scope, named deliberately**: no rate limiting on `POST /sessions`. There's no auth, so nothing stops repeated calls from creating many sessions — acceptable for an internal/small-team tool with no adversarial users in mind; each session is cheap (a small in-memory object) and Render's periodic restarts naturally bound how long any junk accumulates. Revisit if this is ever exposed somewhere less trusted than a shared team link.

```
estimator-backend/
  package.json, tsconfig.json, eslint.config.mjs, render.yaml, .env.example, .gitignore
  src/
    server.ts              # composition root: http.Server + app + Socket.IO, binds process.env.PORT
    app.ts                  # express app factory (middleware, routes) — importable without starting
    config.ts                # reads/validates process.env once, exports typed config
    errors.ts                 # AppError + error codes, shared by REST and WS layers
    types.ts                   # SessionState, Participant, WS event payload types
    pointSystems.ts             # computeAxisValues, validateSliderMax — pure, no framework deps
    sessionStore.ts              # createSession/getSession/dedupeName/addParticipant/setSelection/
                                  #   endSession/buildRevealPayload — pure, no framework deps
    routes/
      sessions.ts                 # POST /sessions, GET /sessions/:id (Express Router)
    ws/
      ioServer.ts                  # SocketIOServer setup, cors config, connection handler + room join
      handlers.ts                   # handleJoin/handleAdminAuth/handleSelectSquare (validates time/resource
                                     #   against session axisValues)/handleEndSession
    middleware/
      errorHandler.ts                # Express error middleware → { error, message } response shape
    utils/
      validation.ts                   # name regex, shared client/server-mirrored rules
      id.ts                            # generateSessionId (nanoid/non-secure), generateAdminToken (crypto)
  tests/
    pointSystems.test.ts
    sessionStore.test.ts
```

### Frontend (`estimator-frontend/`)

**Container/presentational split**: route components (`routes/`) own data-fetching and orchestration (the `GET /sessions/:id` → branch logic, the WS connection lifecycle); everything in `components/` is presentation-only, receiving data and callbacks as props. This keeps `EstimationGrid`, `AdminControls`, etc. easy to reason about and test in isolation from network/socket concerns.

**Side effects live in hooks, not components**: `useSessionSocket` owns the entire Socket.IO connection lifecycle (connect, emit, listen, cleanup on unmount); `useAdminToken` owns all `localStorage` reads/writes. Components consume these hooks' return values declaratively rather than touching `localStorage` or a socket instance directly — keeps the side-effecting code in one auditable place per concern.

**Flat structure is the right size here**: with only two routes and a handful of components, a `routes/` + `components/` + `hooks/` + `lib/` split is sufficient — deliberately not adopting a `features/session/...` style structure, which would just add indirection for an app this small.

```
estimator-frontend/
  package.json, tsconfig.json, vite.config.ts, tailwind.config.ts, components.json, vercel.json, .env.example
  src/
    main.tsx
    App.tsx                    # BrowserRouter + Routes
    types.ts                    # hand-duplicated protocol types, mirrors backend src/types.ts
    routes/
      CreateSessionPage.tsx       # name + PointSystemPicker + RangeSlider, POST /sessions, store adminToken
      SessionPage.tsx              # GET /sessions/:id, branch: 404 / ended / admin / name-gate → interactive
    components/
      ui/                           # shadcn-generated primitives (button, input, slider, radio-group,
                                     #   badge, alert-dialog) — editable source, not a black-box dependency
      PointSystemPicker.tsx
      RangeSlider.tsx
      NameEntryGate.tsx
      SessionStatusHeader.tsx
      ShareLink.tsx
      EstimationGrid.tsx            # custom, data-driven grid — not a shadcn primitive
      AbstainedList.tsx
      AdminControls.tsx
      ErrorBanner.tsx                # custom dismissible banner for WS `error` events — not shadcn toast/sonner
    hooks/
      useSessionSocket.ts            # Socket.IO lifecycle, reconnection: false
      useAdminToken.ts                 # localStorage get/set/remove keyed by sessionId
    lib/
      api.ts                            # createSession(), getSession() — fetch wrappers
      socket.ts                          # socket instance factory + typed emit/on wrappers
      utils.ts                            # shadcn's cn() classname helper
```

**Testing note**: Vitest + React Testing Library is the natural fit here (same test runner as the backend, keeping tooling consistent across both repos) for the handful of components/hooks with actual logic worth covering — `RangeSlider`'s co-dependent reset behavior, `EstimationGrid`'s selection/readonly rendering, and `useSessionSocket`'s state transitions. The thin `components/ui/` shadcn wrappers don't need dedicated tests; they're exercised indirectly through the components that use them.

## Deployment

- **Backend → Render**: `render.yaml` as above (free Web Service).
- **Frontend → Vercel**: auto-detects Vite; one required config, `vercel.json`, for SPA rewrites so a hard refresh on `/:sessionId` doesn't 404:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
  Env vars: `VITE_API_BASE_URL`, `VITE_SOCKET_URL` (must be `wss://`-capable, i.e. `https://`, since Socket.IO negotiates the transport itself and the page is served over `https`).
- **CORS/origin**: Express `cors()` reads an allowlist from `CORS_ORIGIN` for REST. Socket.IO reads the **same allowlist** via its own `cors: { origin }` constructor option — one config value shared by both layers, no separate hand-rolled origin check needed (this was the main risk flagged with raw `ws` and is why Socket.IO was chosen). Scoped to the **production Vercel domain only** — no `*.vercel.app` suffix-matching for preview/branch deploys, so preview deploys of the frontend can't reach the live backend (only a locally-run backend would work against them).

  *List-parsed, not a bare string, even with one value today*: `CORS_ORIGIN` is a comma-separated list (`config.ts` does `process.env.CORS_ORIGIN.split(',').map(s => s.trim())`), and both Express's `origin` option and Socket.IO's `cors.origin` option are given a validator function (`(origin, cb) => cb(null, allowedOrigins.includes(origin))`) rather than a static string. This is the standard shape production CORS config takes — `Access-Control-Allow-Origin` can only echo back one value per response, so supporting more than one valid origin requires dynamically matching the incoming request against a list rather than hardcoding a constant. Today the list holds exactly one value (the production Vercel domain), so behavior is identical to a bare string — but it means adding a staging environment or a `www`/bare-domain split later is a config change, not a code change. This costs nothing to build now and matches the shape the `cors` package's own docs lead with, rather than the narrower single-string form.

  *Why `CORS_ORIGIN` exists at all*: the frontend and backend are deployed to two different domains (`*.vercel.app` and `*.onrender.com`), and browsers enforce the same-origin policy — JS on one domain can't read responses from another domain unless the server explicitly allows that exact origin via response headers. Without `CORS_ORIGIN` configured correctly, the backend still receives and processes requests, but the browser silently blocks the frontend's JS from reading the response — REST calls and the WebSocket handshake both fail. This is a *browser* protection, not a server access-control mechanism — it does nothing to stop a direct `curl`/Postman request, which is why nothing security-sensitive relies on it (that's `adminToken`'s job, below).

  *Bootstrap order for deploying (a real sequencing dependency, not just a value to fill in)*: the backend's `CORS_ORIGIN` needs to know the frontend's final Vercel URL, but that URL doesn't exist until the frontend has been deployed at least once.
  1. Deploy the backend to Render first — its `CORS_ORIGIN` value doesn't matter yet, since no live frontend exists to test against.
  2. Deploy the frontend to Vercel, note the assigned production URL.
  3. Set `CORS_ORIGIN` on Render's dashboard to that exact URL (scheme + host, no trailing slash — a literal string match). Render auto-restarts the service on save, so this takes effect immediately without a manual redeploy.
  4. Set `VITE_API_BASE_URL`/`VITE_SOCKET_URL` on Vercel's dashboard to the Render backend's URL. Unlike Render, Vercel's `VITE_*` vars are baked into the static bundle at **build** time, not read at runtime — saving them in the dashboard alone does nothing until a redeploy is triggered.
  5. If a custom domain is later added to the Vercel project, `CORS_ORIGIN` must be updated again to match.

  *Localhost, by contrast*: `CORS_ORIGIN=http://localhost:5173` is just a value in the backend's local `.env` — set once at scaffolding, rarely touched (only if the frontend's dev port ever changed, which the plan deliberately avoids — see Local development). A dev-server restart picks up the change; no dashboard, no bootstrap ordering.
- **Render free-tier spin-down risk (accepted)**: the free Web Service spins down after 15 minutes with no HTTP traffic. Because this app is realtime-socket-heavy but HTTP-light during an actual session (participants mostly just click, not poll), a session left idle for a stretch — e.g. created well before a meeting starts — risks the backend spinning down and killing open sockets/in-memory state mid-use, not merely causing a slow first request. This is accepted as consistent with the already-accepted in-memory-only tradeoff (data loss on restart was already fine); the practical mitigation is social, not technical — create the session shortly before the meeting starts rather than far in advance.

## Secrets & environment configuration

This app's design keeps the secret surface unusually small — no database, no third-party auth provider, no external APIs — so most "config" below is not actually sensitive. Distinguishing which is which matters for where each value is allowed to live.

**Backend (`estimator-backend/`) — set in Render's dashboard (Environment tab), never committed:**
- `PORT` — not a secret; Render injects this automatically, the app just needs to bind to it rather than hardcode a port.
- `NODE_ENV` — not a secret; `production` on Render.
- `CORS_ORIGIN` — not a secret, but *is* environment-specific config: a comma-separated allowlist (holding just the production Vercel domain today; preview/branch deploys are intentionally not included — see Deployment section for the list-parsing rationale). Read by both Express's `cors()` and Socket.IO's `cors` option.
- **No database credentials** — no DB exists in this design (in-memory only, per the resolved persistence decision).
- **No JWT/session-signing secret** — `adminToken` is a random opaque value (`crypto.randomBytes(32)`) generated per-session and compared by direct equality against the in-memory `SessionState`, not a signed/verified token. There's nothing to configure here; it's generated at runtime, not supplied via env var.

  *Why `adminToken` exists*: there are no accounts in this app, and the session link (`/:sessionId`) is the exact same URL shared with every participant — so nothing about the URL itself distinguishes "the person who created this" from anyone else with the link. To solve that without building real authentication, session creation generates **two** separate random values, not one: `sessionId` (public, goes in the shareable link, only needs to be hard to *collide*) and `adminToken` (private, returned only to the creating browser, needs to be hard to *forge*). The frontend stores `adminToken` in `localStorage` keyed to that `sessionId`; when that browser reopens the link, finding a matching stored token is what triggers admin treatment (skip the name prompt, show `AdminControls`). Critically, the server doesn't just trust that client-side flag — every `end-session` request re-sends the token and the server re-validates it against what it originally issued, so a forged request via devtools without the real token is rejected even if the requester correctly guessed someone else was the admin. Tradeoff: admin status lives only in that one browser's storage — clearing it or switching devices loses admin control of that session, with no account to recover it from, which is accepted as consistent with the no-accounts design.
- **No third-party API keys** — nothing in the spec calls for email, payments, analytics, or an auth provider. If that changes later (e.g. adding Slack notifications when a session ends), that key would go here.

**Frontend (`estimator-frontend/`) — set in Vercel's dashboard (Project Settings → Environment Variables, both Production and Preview):**
- `VITE_API_BASE_URL` — the deployed backend's REST base URL (`https://estimator-backend.onrender.com`).
- `VITE_SOCKET_URL` — the deployed backend's Socket.IO URL (same host, `https://` — Socket.IO negotiates its own transport upgrade).
- **Important constraint, not just a config note**: anything prefixed `VITE_` is inlined into the client-side JS bundle at build time and is publicly visible to anyone who opens devtools — so nothing genuinely secret can ever go in a `VITE_*` variable. Both values above are fine here because they're just public URLs, not credentials. If a future feature needed a real frontend-visible key (e.g. a public analytics write key), that's the only category of "secret" that belongs in this file; anything requiring confidentiality (a private API key, a signing secret) must stay server-side and be proxied through the backend instead.

**Not needed for this app, worth naming so it's not assumed missing by mistake**: OAuth client ID/secret (no accounts/login), a session-cookie signing secret (no server-side cookies — admin identity lives in `localStorage` + the opaque token), a database connection string, and any CI/CD deploy tokens (Render and Vercel both support git-connected auto-deploy from their dashboards, so no `RENDER_API_KEY`/`VERCEL_TOKEN` is required unless you later want scripted/CLI-triggered deploys instead of push-to-deploy).

**Local development**: each repo's `.env.example` (already in both file-layout trees above) documents the variable *names* with placeholder values, committed to git; the real `.env` files are gitignored and populated locally per-developer. Full detail below.

## Local development (localhost, two ports)

The app runs identically on localhost and deployed — same `server.ts`/`app.ts`, only env var *values* differ. Different `localhost` ports count as different origins under the browser's same-origin policy, so local dev naturally exercises the same cross-origin path as the deployed Vercel↔Render setup, rather than being a simplified stand-in for it.

- **Backend**: `npm run dev` → `tsx watch src/server.ts`. `config.ts` defaults `PORT` to `3001` when unset (Render injects `PORT` in production; nothing injects it locally). Local `estimator-backend/.env`: `PORT=3001`, `NODE_ENV=development`, `CORS_ORIGIN=http://localhost:5173`.
- **Frontend**: `npm run dev` → Vite's default dev server on `5173`, left at Vite's default rather than reassigned (e.g. to `8080`): 8080 is a common default for other local tooling (Tomcat, Jenkins, corporate proxies/VPN clients), so it's more contention-prone than 5173, and a busy port makes Vite silently fall back to the next free one unless `strictPort: true` is set — which would silently desync from whatever port `CORS_ORIGIN` and `VITE_API_BASE_URL` were pinned to and surface as a confusing CORS/connection failure rather than an obvious "port in use" error. Staying on Vite's default sidesteps that failure mode entirely rather than needing `strictPort` to guard against it. Local `estimator-frontend/.env.local` (Vite's gitignored-by-convention override file, layered on top of `.env`/`.env.example`): `VITE_API_BASE_URL=http://localhost:3001`, `VITE_SOCKET_URL=http://localhost:3001`.
- Run both dev servers concurrently (two terminal tabs, or an npm script using `concurrently` in whichever repo you invoke first — optional, not required).
- No code path differences between local and deployed; switching environments is purely a matter of which `.env`/dashboard values are active.

## Build order

1. Backend: types + point-scale math + unit tests for boundary values (0, exact fib numbers, between-fib values, 64, 20).
2. Backend: session store (create/dedupe/select/end/reveal) + unit tests.
3. Backend: REST routes, manual curl test.
4. Backend: Socket.IO server attached to the shared `http.Server` + the 4 event handlers, manual test with a small `socket.io-client` script or a Socket.IO-aware tool (plain `wscat` won't speak Socket.IO's framing).
5. Frontend: scaffold (Vite react-ts, bump to React 19, router, types, `lib/api.ts`), then `npx shadcn@latest init` (Tailwind + `components.json` + `cn()` helper) and `npx shadcn@latest add button input slider radio-group badge alert-dialog`.
6. Frontend: create-session flow (`PointSystemPicker`, `RangeSlider` on shadcn primitives), verified against the real `POST /sessions`.
7. Frontend: `SessionPage` branching skeleton (loading/404/ended/name-gate/interactive).
8. Frontend: Socket.IO integration (`useSessionSocket` with `reconnection: false`, `NameEntryGate`, interactive grid).
9. Frontend: admin flow, reveal broadcast handling, readonly grid, abstained list.
10. Polish: status header, share link, error states.
11. Deployment configs (`render.yaml`, `vercel.json`), env vars, CORS + WS-origin allowlist.
12. Deploy both, smoke-test against real public URLs (not localhost) to catch CORS/WSS issues early.

## Verification

**Unit (backend, vitest)**: axis computation at 0/1/4/55/64 (fib) and 0/20 (numerical); dedup chain producing `-1`/`-2`/`-3`; slider-bound rejection; admin-token rejection on end-session with a wrong/missing token even from an already admin-auth'd socket; `select-square` rejection of an out-of-range or malformed `{time, resource}` pair (not a member of the session's `axisValues`) — verifies the store is untouched and an `error` is returned rather than a corrupted `participant.selection`.

**Manual E2E (multiple browser profiles)**:
- Numerical max=10 → 11×11 grid; fibonacci slider=64 → exactly `[0,1,2,3,5,8,13,21,34,55]`; fibonacci slider=10 → `[0,1,2,3,5,8]`; slider=0 → degenerate 1×1 grid.
- Three "Jim" joins → `Jim`, `Jim-1`, `Jim-2`.
- Second participant tab cannot see the first's selection or even that anyone has voted.
- Refresh mid-session → re-prompted for name; prior vote survives server-side under the old (now orphaned) name — expected, not a bug (decision #11).
- Click a different square before reveal → highlight moves, no duplicate entry at reveal; click the *same* already-selected square again → clears back to no selection (decision #10 — counts as Abstained if reveal happens right after).
- Admin opens the same session link in a second tab, or just refreshes their own tab, after already selecting a square → grid immediately shows the existing selection, not blank (decision #19).
- Two admin tabs open simultaneously: select a square in tab 1 → tab 2 does **not** live-update (expected, decision #20, no cross-tab sync); ending the session from either tab still flips both tabs (and every participant) to reveal via the room-wide broadcast.
- Double-trigger `end-session` (rapid double-click on the confirm dialog, or two tabs both ending within the same race) → second call is a silent no-op, no `ErrorBanner` shown (decision #21).
- Admin ends session → every open tab flips to reveal via the `session-ended` push, no manual refresh needed.
- Brand-new visitor after end → sees reveal directly via REST, no name prompt, no socket opened; squares unclickable for everyone including admin.
- Forge an `end-session` socket emit with a wrong token via devtools console (`socket.emit('end-session', { adminToken: 'bogus' })`) → `error` event → `ErrorBanner` appears, session stays active (decision #13).
- Forge a `select-square` emit with an out-of-range value via devtools console (`socket.emit('select-square', { time: 999, resource: -5 })`) → `error` → `ErrorBanner` appears, `participant.selection` unchanged server-side.
- Kill/restart backend mid-session → old links now 404 (expected, in-memory tradeoff).
- Network blip / manually disconnect a socket mid-session → client does **not** silently reconnect and resume (verifies `reconnection: false` is actually taking effect) — participant is re-prompted for a name.
- Deployed cross-origin check: Vercel frontend ↔ Render backend works for REST + Socket.IO; a request/connection from an unlisted origin is rejected.
- Render free-tier cold start after 15+ min idle → slow first request, then normal — expected, not a bug.

## Critical files

- `estimator-backend/src/sessionStore.ts` — core in-memory state machine everything else depends on.
- `estimator-backend/src/server.ts` — shared-port `http.Server` with the Socket.IO server attached on top (the correctness point for Render's single-port constraint).
- `estimator-backend/src/ws/handlers.ts` — enforces the hidden-votes-until-reveal invariant and admin-token re-validation.
- `estimator-frontend/src/hooks/useSessionSocket.ts` — WS lifecycle and the admin/participant/ended branching driving `SessionPage`.
- `estimator-backend/render.yaml`, `estimator-frontend/vercel.json` — without these, SPA routing and free-tier WS deployment don't work.
