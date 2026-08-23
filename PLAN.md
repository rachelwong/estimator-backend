# Estimator Backend — Implementation Plan

## Context

`estimator-plan.md` (same folder) fully specifies this app's architecture and product decisions. This document covers only the backend's literal build sequence: what files exist, what they export, and why. **All 4 build steps are built and tested** — every snippet below is pulled from the real files in `src/`.

### How to read this document

- Each file gets its own subsection: a signature-only code snippet, then a short **Why**. Snippets never show full implementations — read the real file in `src/` for that.
- Product-level decisions (not documentation-format ones) are cited as **(decision #N)** rather than re-explained — see `estimator-plan.md`'s numbered decision list for the full reasoning.
- **Never trust the client** — named once here, referenced by name below. Every input (slider bounds, point-system type, participant name, a selected square, the admin token) is re-validated server-side, regardless of any client-side check or a prior successful check earlier in the same connection. An admin-authenticated socket still gets its token re-checked on every privileged action — there's no "already trusted this session" shortcut.

Two mattpocock skills govern the work: **`tdd`** (red-green-refactor for each Build Step) and **`writing-for-agents`** (governs `CLAUDE.md`'s prose, written after Step 4 lands — see "Post-Step-4" below).

Deliberately out of scope: `render.yaml`/deployment config, and the frontend.

---

## Phase 0 — Scaffolding ✅ Done

All scaffolding files exist in the repo root — read them directly rather than relying on a copy here: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `.nvmrc`.

**Gotchas worth keeping in mind** (things a plain read of those files won't explain):

- **Express 5**, not 4 — needed for its native propagation of thrown/rejected errors from async route handlers to `errorHandler.ts`, matching this codebase's "throw `AppError`, let it get caught centrally" design. No `asyncHandler` wrapper needed.
- **Node `>=24`** pinned in `engines`, with a matching `.nvmrc` — chosen to match the actual local dev machine, closing the gap that causes local/Render drift.
- **`tsconfig.json` targets `ES2025`** — TypeScript 6.0.3's newest supported spec version, a comfortable match for Node ≥24's V8 engine.
- **`types: ["node"]`** in `tsconfig.json` is required, not optional — with this project's exact `typescript@6.0.3` + `@types/node@24.13.3` pairing, every `node:`-prefixed import (`node:crypto`, etc.) fails to typecheck without it, even though `@types/node` is installed.
- **`tsconfig.build.json`** is a separate config scoped to `src/` only (excludes `tests/`, `scripts/`) — this is what makes `npm run build` (what Render actually runs) fail loudly if `src/` code ever imports from `tests/`.
- **`.env.example`'s `CORS_ORIGIN`** defaults to `http://localhost:5173` (Vite's default port) — deliberately matching the frontend's default so local dev never hits a CORS mismatch from a reassigned port.

---

## Build Steps

### Step 1 — Types + point-scale math ✅ Built

Order: `types.ts`, `errors.ts` (no interdependency) → `pointSystems.ts` (needs both).

#### `src/types.ts`

```ts
export const PointSystemType = { Numerical: 'numerical', Fibonacci: 'fibonacci' } as const;
export type PointSystemType = (typeof PointSystemType)[keyof typeof PointSystemType];

export interface PointSystem { type: PointSystemType; sliderMax: number; axisValues: number[] }
export interface Selection { time: number; resource: number }
export interface Participant { id: string; name: string; selection: Selection | null; isAdmin: boolean }
export interface SessionState {
  id: string; adminToken: string; adminParticipantId: string;
  pointSystem: PointSystem; participants: Map<string, Participant>;
  ended: boolean; createdAt: Date; endedAt: Date | null;
}
export interface RevealSquare { time: number; resource: number; names: string[] }
export interface RevealPayload { squares: RevealSquare[]; abstained: string[] }
```

**Why**: the shared vocabulary every other file imports. `PointSystemType` is a const object, not a bare string union, so its values are reusable at runtime (e.g. by a Zod enum in Step 3) — this repo's `no-magic-strings` convention.

#### `src/errors.ts`

```ts
export const ErrorCode = {
  InvalidName: 'INVALID_NAME', InvalidSliderMax: 'INVALID_SLIDER_MAX',
  UnknownSession: 'UNKNOWN_SESSION', InvalidAdminToken: 'INVALID_ADMIN_TOKEN',
  InvalidSelection: 'INVALID_SELECTION', SessionEnded: 'SESSION_ENDED',
  InvalidRequest: 'INVALID_REQUEST', InternalError: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = { /* one status per code */ };

export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string);
}
```

**Why**: `ErrorCode` is derived from `ERROR_HTTP_STATUS`'s own keys rather than declared separately — adding a code with no HTTP status is a compile error, not a runtime gap. `AppError` carries no `httpStatus` field: it's thrown from framework-free domain code and consumed by both REST and WS, and WS has no concept of an HTTP status. Only `middleware/errorHandler.ts` (Step 3) looks the status up.

#### `src/pointSystems.ts`

```ts
export const FIBONACCI_SEQUENCE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
export function validateSliderMax(type: PointSystemType, sliderMax: number): void;
export function computeAxisValues(type: PointSystemType, sliderMax: number): number[];
```

**Why**: zero framework imports — pure domain math, unit-testable with no server. `validateSliderMax` rejects a type outside `numerical`/`fibonacci` (never trust the client), a non-integer, negative, or over-ceiling value (20 for numerical, 64 for fibonacci). `computeAxisValues` calls `validateSliderMax` internally, so callers never validate the same value twice.

**Future extensibility (not needed now)**: a new fixed-sequence type (e.g. t-shirt sizes) is a small add — one ceiling entry, one branch in `computeAxisValues`. A type with no numeric ceiling at all would need `PointSystem` restructured into a discriminated union. Not generalizing `axisValues`/`Selection` beyond `number` now — no confirmed need.

**Test Cases** (`tests/pointSystems.test.ts`):
- `computeAxisValues` — fibonacci at the exact top (55), a between-fib value (10), at the slider ceiling (64, still tops out at 55), at 0; numerical 0..5 and the full 0..20 (hand-typed, not the same formula the implementation uses); rejects a forged type; rejects a negative value.
- `validateSliderMax` — boundary pairs at 20/21 (numerical) and 64/65 (fibonacci); rejects negative, non-integer, and a forged type.

---

### Step 2 — Session store ✅ Built

Order: `utils/id.ts` first, then `sessionStore.ts` (needs `types.ts`, `errors.ts`, `pointSystems.ts`, `utils/id.ts`, `utils/validation.ts`).

#### `src/utils/id.ts`

```ts
export function generateSessionId(): string;      // nanoid/non-secure, 16 alphanumeric chars
export function generateAdminToken(): string;      // crypto.randomBytes(32).toString('hex')
export function generateParticipantId(): string;   // crypto.randomUUID()
```

**Why**: a session id is a public, shareable link, not a secret — it only needs to avoid collisions, not resist guessing, so the cheaper `nanoid/non-secure` generator is enough (16 chars ≈ 95 bits of space). The admin token *is* a secret (it grants control over someone else's session) — it uses `crypto.randomBytes`, hex-encoded since a raw `Buffer` can't sit in JSON/localStorage/a WS payload directly. A participant id never appears in a URL and doesn't need to be short, so it's a plain UUID.

#### `src/utils/validation.ts`

```ts
export function validateParticipantName(name: string): void;  // /^[A-Za-z0-9]{1,20}$/, throws INVALID_NAME
```

**Why**: never trust the client. This is the one place the name rule lives — called from `sessionStore`, not from the route — so both REST's `POST /sessions` and the WS `join` event enforce it identically without either transport needing its own copy.

#### `src/sessionStore.ts`

All session state lives in one module-level `Map<string, SessionState>` — no database, matching the in-memory-only decision (decision #1).

```ts
export function createSession(input: { adminName: string; pointSystemType: PointSystemType; sliderMax: number }): SessionState;
export function getSession(sessionId: string): SessionState | undefined;
export function addParticipant(sessionId: string, name: string): Participant;
export function selectSquare(sessionId: string, participantId: string, time: number, resource: number): void;
export function validateAdminToken(sessionId: string, adminToken: string): SessionState;
export function endSession(sessionId: string, adminToken: string): { reveal: RevealPayload; wasAlreadyEnded: boolean };
export function computeReveal(session: SessionState): RevealPayload;
export function resetSessionStore(): void;   // test-only, wipes the Map
```

**Why**, function by function:
- **`createSession`** — validates the admin's name and point-system settings, regenerates the session id on a collision, creates the admin as the session's first participant.
- **`addParticipant`** — rejects with `SESSION_ENDED` if the session already ended (guards a stale `join` racing an `end-session`). Names are trimmed (leading/trailing whitespace only — an embedded space still fails validation), capitalized, then de-duplicated case-insensitively (`Jim` → `Jim-1` → `Jim-2` ...) via an existence-check loop rather than a count — participant records are never deleted, so counting `name*` matches can be wrong once an earlier suffixed name is orphaned (decision #11).
- **`selectSquare`** — also rejects `SESSION_ENDED`. Validates `{time, resource}` is an exact member of the session's `axisValues` (never trust the client). Voting the same square again clears the vote; a different square overwrites it. `participantId` always comes from server-held connection state (Step 4), never the request payload, so an unmatched id here is a programming bug, not real client input — it throws a plain `Error`, not an `AppError`.
- **`validateAdminToken`** — looks up the session first (`UNKNOWN_SESSION` before ever checking the token), then compares the token, returning the session so callers don't need a second lookup.
- **`endSession`** — always re-validates the token, even on an already-ended session (never trust the client, applied to auth — no "already authenticated this connection" shortcut). Idempotent: a second call returns the same reveal with `wasAlreadyEnded: true` instead of re-mutating state (decision #21).
- **`computeReveal`** — pure grouping logic, exported separately so it's testable without going through `endSession`.
- **`resetSessionStore`** — test-only; vitest runs every case against the same module instance, so tests need an explicit reset between them.

**Test Cases** (`tests/sessionStore.test.ts`):
- `createSession` — sole initial participant, name trim/capitalize, empty/over-length/embedded-space rejection, session-id collision regeneration.
- `getSession` — found vs. `undefined`.
- `addParticipant` — unknown session, 20-char ceiling, trim, embedded-space rejection, capitalize, empty/over-length rejection, dedup chain (`Jim`→`Jim-1`→`Jim-2`), case-insensitive dedup, rejects on an ended session.
- `selectSquare` — unknown session, a pair where only one coordinate is out of range (proves both sides are checked independently), first vote, deselect, overwrite, non-member pair rejection, rejects on an ended session.
- `endSession` — marks ended + returns reveal, idempotent second call, rejects a bad token even on an already-ended session.
- `validateAdminToken` — unknown session before the token check, mismatched token, matching token returns the session.
- `computeReveal` — groups by square, all-abstained, mixed vote/abstain.

---

### Step 3 — REST routes ✅ Built

Order: `config.ts` → `schemas.ts` → `middleware/errorHandler.ts` → `routes/sessions.ts` → `app.ts` → `server.ts` (v1).

#### `src/config.ts`

```ts
export const LOCAL_DEV_CORS_ORIGIN = 'http://localhost:5173';
export interface Config { port: number; corsOrigin: string; nodeEnv: string }
export function loadConfig(env?: NodeJS.ProcessEnv): Config;
```

**Why**: reads `process.env` once and is passed explicitly into `app.ts`/`server.ts` rather than read inside them — this is what makes `app.ts` testable with `supertest` against a fake config. `CORS_ORIGIN` is a single string, not a list — only one origin is ever expected in this deployment. Fails fast only in production: throws if `CORS_ORIGIN` is unset, has a trailing slash, or equals the local-dev default — each a plausible deploy mistake, not a hypothetical one. `LOCAL_DEV_CORS_ORIGIN` is exported so a test can hold it accountable against `.env.example`, catching drift between the two.

#### `src/schemas.ts`

```ts
export const CreateSessionRequestSchema = z.object({ adminName, pointSystemType, sliderMax });
export const CreateSessionResponseSchema = z.object({ sessionId, adminToken, adminParticipantId, adminName, pointSystem }).strict();
export const GetSessionResponseSchema = z.object({ sessionId, pointSystem, ended, reveal: RevealPayloadSchema.optional() }).strict();
export const ErrorResponseSchema = z.object({ error, message }).strict();
```

**Why**: shape-only validation (string/number/enum), not domain rules — the name regex and slider ceilings already live correctly in `validation.ts`/`pointSystems.ts`, so this doesn't re-implement them. Response schemas are `.strict()` so a test asserting against them catches an accidentally-leaked field (e.g. `adminToken` on `GET /:id`) — Zod's default `.parse()` silently strips unknown keys, which would make that leak invisible to a non-strict assertion.

#### `src/middleware/errorHandler.ts`

```ts
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void;
```

**Why**: the one place that reads `ERROR_HTTP_STATUS` — turns a thrown `AppError` into `{error, message}` with its looked-up status, a `ZodError` into `400 INVALID_REQUEST`, anything else into a generic `500 INTERNAL_ERROR`. Logs `console.warn` for expected rejections and `console.error` (with the full value) only for the true-unknown fallback, so real bugs read visually differently from normal validation noise. No structured logger (pino/winston) — this is a hobby project with no on-call rotation or log aggregator to feed.

#### `src/routes/sessions.ts`

```ts
sessionsRouter.post('/', (req, res) => { /* POST /sessions */ });
sessionsRouter.get('/:id', (req, res) => { /* GET /sessions/:id */ });
```

**Why**: `POST /` parses the body with `CreateSessionRequestSchema.parse()` first (throws `ZodError` on a shape mismatch), calls `createSession`, and echoes back the *stored* admin name (trimmed/capitalized) rather than the raw input, so the admin isn't shown a name that won't match what other participants see at reveal. `GET /:id` throws `UNKNOWN_SESSION` if `getSession` returns `undefined`. Both responses are built as new plain objects picking only the documented fields — never a `{...session}` spread, since `SessionState` carries `adminToken` and a naive spread would leak it into this public, unauthenticated endpoint.

#### `src/app.ts`

```ts
export function createApp(config: Config): Express;
```

**Why**: `cors()` + `express.json()` + `GET /healthz` + `sessionsRouter` mounted at `/sessions` + `errorHandler` last. Importable-but-inert (never calls `.listen()`), so `supertest` can exercise it with no real network. `/healthz` isn't part of the product surface — it's what Render polls after every deploy to decide whether the new instance is safe to receive traffic; if `loadConfig()` throws on a bad `CORS_ORIGIN`, the process never reaches this route, so Render marks the deploy failed and keeps routing to the last good instance instead of taking the app down.

#### `src/server.ts` (v1 — REST only, extended in Step 4)

```ts
// builds http.Server around createApp(config), calls .listen(config.port)
```

**Why**: the only file that actually starts anything — the composition root. Rewritten in Step 4 to also attach Socket.IO to the same `http.Server`.

**Test Cases** (`tests/sessions.test.ts`, `tests/config.test.ts`):
- `GET /healthz` → 200.
- `POST /sessions` — numerical + fibonacci happy paths (axis values hand-typed, not the implementation's own formula); domain rejection (embedded-space name, over-ceiling slider) vs. shape rejection (missing field, wrong type, bad enum value) — proving the two failure categories stay distinct.
- `GET /sessions/:id` — in-progress (no reveal, no leaked `adminToken`), ended (reveal present, still no leak), unknown id → 404.
- An unmatched route → non-200 (guards against a future catch-all accidentally 200-ing everything).
- `loadConfig` — port default/override, throws in production on unset/trailing-slash/local-default `CORS_ORIGIN`, doesn't throw outside production, `LOCAL_DEV_CORS_ORIGIN` matches `.env.example`.

---

### Step 4 — Socket.IO layer ✅ Built

Order: `ws/events.ts` → `ws/ioServer.ts` → `ws/handlers.ts` → extend `server.ts` → `tests/handlers.test.ts` → `tests/server.test.ts`.

#### `src/ws/events.ts`

```ts
export const WsEvent = { Join: 'join', AdminAuth: 'admin-auth', SelectSquare: 'select-square', EndSession: 'end-session', SessionInfo: 'session-info', Joined: 'joined', AdminAcknowledged: 'admin-acknowledged', SelectionAcknowledged: 'selection-acknowledged', SessionEnded: 'session-ended', Error: 'error' } as const;
export interface ClientToServerEvents { /* join, admin-auth, select-square, end-session */ }
export interface ServerToClientEvents { /* session-info, joined, admin-acknowledged, selection-acknowledged, session-ended, error */ }
export interface SocketData { participantId?: string }
```

**Why**: the WS wire protocol's shared vocabulary — same role `errors.ts`'s `ErrorCode` plays for error codes. `WsEvent`'s literal values key both interfaces, so `.on()`/`.emit()` calls are checked against the event name *and* its payload shape at compile time, not just the name — this repo's `no-magic-strings` convention, applied to Socket.IO. `SocketData` types `socket.data`, Socket.IO's built-in per-connection state slot.

#### `src/ws/ioServer.ts`

```ts
export function createIoServer(httpServer: http.Server, config: Config): Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
```

**Why**: pure construction, no listeners registered here — mirrors `app.ts`'s separation of "build" from "start."

#### `src/ws/handlers.ts`

```ts
export function registerSocketHandlers(io: AppServer): void;
function withErrorHandling(socket: AppSocket, fn: () => void): void;
function handleJoin(socket: AppSocket, session: SessionState, name: string): void;
function handleAdminAuth(socket: AppSocket, session: SessionState, adminToken: string): void;
function handleSelectSquare(socket: AppSocket, session: SessionState, payload: { time: number; resource: number }): void;
function handleEndSession(io: AppServer, socket: AppSocket, session: SessionState, adminToken: string): void;
```

**Why**: `registerSocketHandlers` only does connection setup (session lookup, room join, `session-info` emit) and delegates each event straight to its own named handler, rather than four inline closures in one long callback. `withErrorHandling` translates a thrown `AppError` into `WsEvent.Error` and logs it — `console.warn` for the expected case, `console.error` (full value) for a true-unexpected bug — the same two-tier treatment `middleware/errorHandler.ts` gives REST, so a real WS bug is as visible in the logs as its REST equivalent. Per-connection identity lives in `socket.data.participantId`, set by `handleJoin`/`handleAdminAuth` and never read from an incoming payload — never trust the client, applied to identity rather than input shape.

- **On connect** — reads `sessionId` from the handshake query; an unknown session gets `error` + disconnect. An *ended* session is still admitted (see the race note below) and receives `session-info` with `ended: true`.
- **`handleJoin`** → `addParticipant`, stores the returned id in `socket.data.participantId`, acks with `{participantId, name}` — the *stored* (post-dedup) name, same reasoning as `POST /sessions`'s response in Step 3.
- **`handleAdminAuth`** → `validateAdminToken`, sets `socket.data.participantId` to the admin's own id, acks with `{participantId, name, selection}`. Including the current selection is what makes a second admin tab, or a refresh, show the real vote instead of a blank grid (decision #19).
- **`handleSelectSquare`** → `selectSquare`, reading `participantId` only from `socket.data`. If it isn't set yet (an event arriving before join/admin-auth resolved), reject with a generic `error` — no dedicated error code, since this is only reachable via a hand-forged socket call, never a real client flow (decision #22).
- **`handleEndSession`** → `endSession`; a no-op if already ended (no re-broadcast); otherwise `io.to(sessionId).emit(WsEvent.SessionEnded, reveal)` — the one broadcast event in the system.
- **No `disconnect` handler** — nothing server-side changes when a socket disconnects; there's no presence indicator and no state tied to connection liveness.

**Ended-session connect race**: a socket can start connecting in the same instant the admin ends the session. Rather than special-casing it, the socket is simply admitted and told `ended: true` — every action after that still gets rejected downstream with `SESSION_ENDED`, so the race is inert, not unsafe (decision #22).

#### `src/server.ts` (v2 — extends the Step 3 version)

```ts
// adds createIoServer(httpServer, config) + registerSocketHandlers(io),
// between building httpServer and calling .listen()
```

**Why**: confirms Socket.IO attaches to the *same* `http.Server` Express is mounted on, not a second listener — required by Render's single-port free tier.

**Test Cases** (`tests/handlers.test.ts`) — a real `http.Server` + `socket.io-client` sockets, no mocking of the socket layer:
- Connect — unknown session → `error` + disconnect, no `session-info`; valid in-progress session → correct `session-info`; already-ended session → still admitted, `session-info.ended === true`.
- `join` — happy path acks `{participantId, name}`; a second `Jim` joining gets `Jim-1` back; rejected `SESSION_ENDED` on an ended session.
- `admin-auth` — happy path includes current `selection` (both `null` and a prior vote); wrong token → `error INVALID_ADMIN_TOKEN`.
- `select-square` — select/deselect/change-vote over the wire; an out-of-range pair → `error INVALID_SELECTION`; sent before identity resolved → generic `error`; on an ended session → `error SESSION_ENDED`.
- `end-session` — broadcasts to every socket in the room (asserted with two connected sockets, not just the caller); a second call produces no second broadcast; wrong token → `error INVALID_ADMIN_TOKEN`, session stays active.

**Test Cases** (`tests/server.test.ts`): one real end-to-end round trip — `POST /sessions` over real HTTP, then `admin-auth` → `select-square` → `end-session` over a real WS connection on the *same* real port, confirming `GET /sessions/:id` reflects `ended: true` afterward. This is the only test that proves `server.ts`'s actual composition (Express + Socket.IO sharing one `http.Server`) works — `tests/sessions.test.ts` exercises `app.ts` via `supertest` (no real port), `tests/handlers.test.ts` exercises the WS layer against a bare `http.Server` (no Express mounted). Replaces the old manual `scripts/manual-ws-client.mjs` smoke test, which proved the same thing but only when a human remembered to run it.

---

### Post-Step-4 — `CLAUDE.md`

Written after Step 4, not during scaffolding — it should describe real, verified behavior, not an aspirational plan. Authored via the `writing-for-agents` skill. Worth including: the ESM/NodeNext requirement (`nanoid`/`nanoid/non-secure` is ESM-only), the composition-root split (`server.ts` is the only file that calls `.listen()`), domain purity (`sessionStore.ts`/`pointSystems.ts` never import `express`/`socket.io`), and the shared `AppError` → `{code, message}` contract on both transports. Should point at this file for the build sequence and `estimator-plan.md` for the product spec.

---

## Sequencing dependencies across all 4 steps

1. `types.ts` + `errors.ts` before `pointSystems.ts`.
2. `pointSystems.ts` + `utils/id.ts` before `sessionStore.ts`.
3. `sessionStore.ts` + `errors.ts` before both `routes/sessions.ts` and `ws/handlers.ts`.
4. `config.ts` before `app.ts` and `ws/ioServer.ts` (both take `Config` as an argument).
5. `app.ts` and `ws/ioServer.ts` are siblings, no dependency on each other — but both must exist before the final `server.ts` wiring.
6. `server.ts` is written twice on purpose: a minimal REST-only version at the end of Step 3, extended in Step 4 to attach Socket.IO.
7. `verbatimModuleSyntax: true` means essentially every cross-file type import needs `import type { ... }`.

## Critical Files

- `src/types.ts`, `src/errors.ts` — the shared vocabulary every other file imports.
- `src/sessionStore.ts` — the core state machine; almost everything else calls into it.
- `src/ws/handlers.ts` — enforces the hidden-votes-until-reveal invariant and admin-token re-validation from the product spec.
- `tsconfig.json` + `tsconfig.build.json` — the NodeNext/ESM setup `nanoid` compatibility depends on.
- `CLAUDE.md` — future-session context, written after Step 4.
- `PLAN.md` — this document.
- `estimator-plan.md` — the full product/architecture spec.
