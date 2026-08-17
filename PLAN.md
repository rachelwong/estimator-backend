# Estimator Backend — Implementation Plan

## Context

`estimator-plan.md` already fully specifies this app's architecture — it was built and grilled extensively in a prior session, down to fixing real correctness gaps (vote-change/deselect semantics, admin reconnect state, `select-square` bounds validation, idempotent `end-session`). `estimator-backend/` was just created and is currently empty.

This plan translates that architecture into a literal, buildable sequence for the backend only: what commands to run, what files to create, and what each file's exported surface looks like — detailed enough that implementation is mostly transcription plus tests, not fresh design. Per your direction, this is a **planning document for the whole backend component**, but **execution proceeds step by step** with review checkpoints between steps — Phase 0 (scaffolding) first, then Build Steps 1–4 one at a time, not all at once.

Two mattpocock skills govern the work once approved:

- **`tdd`** — governs each of Build Steps 1–4 (red-green-refactor per step; this is exactly the kind of test-first, boundary-value-heavy domain logic it's meant for).
- **`writing-for-agents`** — governs the actual prose of `CLAUDE.md`, written **after Step 4 lands** (see "Post-Step-4" below) so it describes real, verified behavior rather than an aspirational plan.

Deliberately out of scope for this whole plan: `render.yaml` and any deployment config (that's build-order step 11 in the source doc, far beyond step 4), and the frontend.

---

## Phase 0 — Scaffolding

This is the only phase executed immediately upon approval; Steps 1–4 below are reference material for the sessions that follow, not run in this pass.

### 0.1 — Init + git

```bash
cd /Users/rachelwong/Projects/estimator-backend
git init
npm init -y
mkdir -p src/routes src/ws src/middleware src/utils tests scripts
```

`scripts/` isn't in the original file tree — added to hold the manual Socket.IO test client from Step 4. Independent repo (not tracked by the outer `Projects/` git repo), matching both sibling projects' pattern.

### 0.2 — Install dependencies

```bash
npm install express cors socket.io nanoid

npm install -D typescript tsx vitest supertest socket.io-client \
  @types/node @types/express @types/cors \
  eslint @eslint/js typescript-eslint \
  prettier eslint-config-prettier
```

**Express 5** (the current `latest`, no pin needed): stable since October 2024 — roughly two years of production use by now, not experimental. Its breaking changes from v4 (updated `path-to-regexp`, dropped deprecated APIs) don't touch anything this app does — no exotic route patterns, no use of removed legacy methods. More importantly, it natively propagates errors thrown/rejected inside `async` route handlers to the error middleware, which directly matches `errors.ts`'s whole design (throw `AppError`, let it get caught centrally) — no `asyncHandler` wrapper needed. Given the rest of this stack already defaults to modern (NodeNext ESM, TS `strict`, Node 24), and this is a small 2-endpoint REST surface with no legacy middleware dependency forcing v4, v5 is the better fit here, not just the newer option.

### 0.3 — `package.json` (hand-edited fields after `npm init -y`)

```jsonc
{
  "name": "estimator-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
  },
}
```

**Node pinning** (per your answer): `engines: ">=24"` — tightened from a looser floor because your local machine already runs Node v24.18.0; pinning to match it (rather than a permissive `>=20`) is what actually prevents the local/Render drift this decision exists to guard against. A `.nvmrc` containing `24` accompanies it, so `nvm use` picks the same major automatically.

### 0.4 — `tsconfig.json` (base — editor, `tsc --noEmit`, vitest)

**Amended 2026-08-17**: `target`/`lib` bumped from `ES2022`/`["ES2023"]` (below) to `ES2025`/`["ES2025"]`. TypeScript 6.0.3 (this project's pinned devDependency) added `es2025` as the latest official target/lib option and made it the new default, describing it as "the most recent supported ECMAScript spec version" for evergreen runtimes. Node ≥24 (V8 13.6) is a comfortable match for that — no reason to target two spec years behind what the compiler and runtime both actually support.

```jsonc
{
  "compilerOptions": {
    "target": "ES2025",
    "lib": ["ES2025"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "sourceMap": true,
    "rootDir": ".",
    "outDir": "dist",
  },
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"],
}
```

`verbatimModuleSyntax: true` matters under `NodeNext`: it forces `import type { X }` for type-only imports (this codebase is interface-heavy — `SessionState`, `Participant`, etc.), preventing accidental runtime imports of type-only modules. `forceConsistentCasingInFileNames` matters specifically because local dev is macOS (case-insensitive filesystem) but Render deploys on Linux (case-sensitive) — this catches an import-casing bug locally instead of it only surfacing in production.

### 0.5 — `tsconfig.build.json` (production build only)

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
  },
  "include": ["src/**/*"],
  "exclude": ["tests/**/*", "scripts/**/*"],
}
```

Split needed because `tests/` and `scripts/` live outside `src/` — a single `tsc` build with `rootDir: "src"` would fail on them, but vitest needs them typechecked as part of the same project. This split is also a tripwire: if `src/` code ever accidentally imports something from `tests/` or `scripts/`, `npm run build` fails loudly.

**Build matches dev strictness deliberately**: `noUnusedLocals`/`noUnusedParameters` stay `true` here too (no override), inherited as-is from the base config. Since this project has no CI gate (already decided), `npm run build` — what Render actually runs to deploy — is the only automated backstop that would catch a real unused-var issue before it ships if `npm run lint` wasn't run first by habit.

### 0.6 — `eslint.config.mjs`

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  { ignores: ['dist/**', 'node_modules/**'] },
);
```

No sibling ESLint config is reusable (both are `eslint-config-next`, Next-specific) — fresh flat-config setup. `eslint-config-prettier` goes last to disable stylistic rules that would otherwise conflict with Prettier; Prettier stays a separate formatting pass (`npm run format`), not run through ESLint itself.

### 0.7 — `.prettierrc.json`

```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

No sibling precedent; these are reasonable, easily-adjusted defaults.

### 0.8 — `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node', passWithNoTests: true },
});
```

`passWithNoTests: true` matters immediately: with zero test files (true until Step 1), vitest's default behavior is to exit with an error, which would make `npm test` look broken during scaffolding verification for no real reason.

### 0.9 — `.gitignore` / `.env.example`

```
# .gitignore
node_modules/
dist/
.env
*.log
.DS_Store
coverage/
```

```
# .env.example
PORT=3001
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

`CORS_ORIGIN` matches Vite's default dev port (`5173`), not the generic `3000` — `estimator-plan.md`'s Local Development section deliberately keeps the frontend on Vite's default rather than reassigning it, specifically to avoid this exact mismatch.

### 0.10 — Save this plan into the repo

Copy this document to `estimator-backend/PLAN.md`. This plan currently only lives in Claude Code's ephemeral plan-mode storage (`~/.claude/plans/...`) — copying it into the repo makes it a durable, version-controlled artifact future sessions (and future you) can read directly from the project, not just something referenced from memory of this conversation. `estimator-plan.md` (the full product/architecture spec) now also lives directly in this `estimator-backend/` folder (in addition to its original home in the sibling `jira-poker/` folder), so both plans are readable from within this repo without a cross-repo reference.

### 0.11 — First commit point

After 0.1–0.10 land and verify clean (see Verification below), that's a natural first-commit boundary — not committing automatically; you'll say when.

---

## Build Steps 1–4 (reference for future sessions — not executed this pass)

Included in full detail now since you asked for the whole component planned up front, even though we'll implement it one step at a time with a checkpoint between each.

### Step 1 — Types + point-scale math + tests

Order: `src/types.ts` and `src/errors.ts` (no interdependency) before `src/pointSystems.ts` (needs both).

- **`src/types.ts`**: `PointSystemType`, `PointSystem { type, sliderMax, axisValues }`, `Selection { time, resource }`, `Participant { id, name, selection, isAdmin }`, `SessionState { id, adminToken, adminParticipantId, pointSystem, participants: Map<string, Participant>, ended, createdAt, endedAt }`, `RevealSquare { time, resource, names }`, `RevealPayload { squares, abstained }`.
- **`src/errors.ts`**: `ERROR_HTTP_STATUS` — a single `const` object mapping every error code to its REST status (`{ INVALID_NAME: 400, INVALID_SLIDER_MAX: 400, UNKNOWN_SESSION: 404, INVALID_ADMIN_TOKEN: 403, INVALID_SELECTION: 400, SESSION_ENDED: 409 } as const`), with `ErrorCode` **derived** from it (`type ErrorCode = keyof typeof ERROR_HTTP_STATUS`) rather than declared as a separate union — one declaration instead of two that could drift apart, and TypeScript enforces the mapping is complete (adding a 7th code without an entry here is a compile error, not a runtime gap). `AppError extends Error` takes only `(code: ErrorCode, message: string)` — **no `httpStatus` param** — using **TS constructor parameter properties** (`constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'AppError'; }`) rather than separate field declarations + manual assignment. `httpStatus` deliberately isn't carried on the instance: `sessionStore.ts`/`pointSystems.ts` throw `AppError` and are consumed by both REST and WS, and WS has no concept of an HTTP status — only `middleware/errorHandler.ts` (Step 3) needs it, so only it looks the code up in `ERROR_HTTP_STATUS`. A constructor itself can't be avoided (`super(message)` must run before `this` is usable when extending `Error`), only its boilerplate can.
- **`src/pointSystems.ts`** (zero framework imports): `FIBONACCI_SEQUENCE = [0,1,2,3,5,8,13,21,34,55]`; `validateSliderMax(type, sliderMax)` throws `AppError('INVALID_SLIDER_MAX', ...)` if `type` is not exactly `'numerical' | 'fibonacci'` (guards against a forged/garbage `type` on a REST/WS payload, same "never trust client input" principle applied everywhere else), if `sliderMax` is negative, or if it's outside the `{numerical: 20, fibonacci: 64}` ceilings, or non-integer; `computeAxisValues(type, sliderMax)` — fibonacci filters `<= sliderMax`, numerical builds `0..sliderMax`.
- **`tests/pointSystems.test.ts`**: boundary values `0`, every exact fib number, between-fib values, `64` (confirms `55` is the max included), `20`; rejection of out-of-ceiling, negative, and non-integer `sliderMax` values; rejection of a `type` outside `'numerical' | 'fibonacci'`.

**Extensibility note (not acted on — YAGNI for now, documented for whoever adds a 3rd point-system type later, e.g. t-shirt sizing):**

- **Cheap case**: a new type that fits the existing shape — a fixed ordered sequence, with the slider ceiling picking a prefix (exactly how `FIBONACCI_SEQUENCE` already works) — is a small, mechanical add: one more entry in `validateSliderMax`'s ceiling table, one more branch in `computeAxisValues`, one more case in the frontend's slider min/max switch and `PointSystemPicker`'s radio options.
- **The one place that ripples wider, regardless of shape**: `axisValues` and `Selection.time`/`Selection.resource` are typed as `number` throughout (`types.ts`, both repos, the grid's cell keys). A categorical scale (t-shirt sizes, or anything non-numeric) needs those widened to `number | string` (or a generic) — this touches every file that imports those types, front and back. The mitigating factor: `selectSquare`'s validation is already an **exact-membership check** against `axisValues`, not a numeric range comparison, so the validation *logic* doesn't care whether values are numbers or strings — only the type annotations need to change, not the logic.
- **Expensive case**: a type with no numeric "ceiling" concept at all (e.g. always shows a fixed list, no slider) breaks `PointSystem { type, sliderMax, axisValues }`'s core assumption that every type has a slider-driven ceiling — `sliderMax` would need to become optional/nullable or `PointSystem` would need restructuring into a discriminated union, plus the frontend would need to conditionally hide `RangeSlider` for that type.
- **Decision**: not generalizing `axisValues`/`Selection` to `number | string` now — no confirmed near-term need, matches this project's stated minimalism (see "Engineering conventions" in `estimator-plan.md`). Worth revisiting this note first if a non-numeric point system is ever actually requested, since retrofitting after Steps 1–4 are built costs more (touches `sessionStore.ts`, both route/handler layers, and the frontend grid) than typing it generically would have cost in Step 1.

### Step 2 — Session store + tests

Order: `src/utils/id.ts` first, then `src/sessionStore.ts` (needs `types.ts`, `errors.ts`, `pointSystems.ts`, `utils/id.ts`), then its tests.

- **`src/utils/id.ts`**: `generateSessionId()` — `nanoid/non-secure` `customAlphabet`, alphanumeric, length 16; `generateAdminToken()` — `crypto.randomBytes(32)`; `generateParticipantId()` — `crypto.randomUUID()`. Participant IDs get their own, simpler generator: unlike `sessionId`, they never appear in a shareable URL and don't need to be short or typeable, so there's no reason to reuse `sessionId`'s constrained alphabet/length — a standard UUID is the right tool here.
- **`src/sessionStore.ts`** (zero framework imports): `createSession({adminName, pointSystemType, sliderMax})` — generates/regenerates-on-collision `sessionId`, generates `adminToken`, creates the admin as the first `Participant` (using `generateParticipantId()`), calls `validateSliderMax`/`computeAxisValues` internally too (domain invariant, not solely the route layer's job); `getSession(id)`; `addParticipant(sessionId, name)` — **throws `AppError('SESSION_ENDED', ...)` if `session.ended`** (guards a stale/forged `join` racing an `end-session`, before doing anything else), otherwise generates a new `generateParticipantId()`, case-insensitive dedup with `-1`/`-2`/... suffixing; `selectSquare(sessionId, participantId, time, resource)` — **throws `AppError('SESSION_ENDED', ...)` if `session.ended`** (guards a stale vote racing an `end-session` — the exact case named in `estimator-plan.md`'s WS error UX decision), otherwise validates `{time,resource}` are exact members of `pointSystem.axisValues` (not just numerically in range), same value as current selection → clears to `null` (deselect), otherwise overwrites (change-vote); `validateAdminToken(sessionId, adminToken)`; `endSession(sessionId, adminToken)` → `{reveal, wasAlreadyEnded}` — **always** re-validates the token (even on an already-ended session, per the "never trust a prior handshake alone" rule with no carve-out), and if already ended returns `wasAlreadyEnded: true` without re-mutating state, which is what lets the WS handler (Step 4) suppress a duplicate broadcast; `computeReveal(session)` — pure, exported separately for direct unit testing, groups participants by selection into `squares`, non-voters into `abstained`. `endSession` is the one deliberate exception to the "reject on an ended session" rule above — it's idempotent by design (decision #21), not guarded the same way `join`/`select-square` are.
- **`tests/sessionStore.test.ts`**: collision-triggered id regeneration, name dedup chain, select/deselect/change-vote toggling, `selectSquare` rejecting a non-member `{time,resource}` pair, `selectSquare` and `addParticipant` both rejecting with `SESSION_ENDED` once `session.ended` is true, `endSession` idempotency (`wasAlreadyEnded: true` + identical reveal on 2nd call), `endSession` rejecting a bad token even on the 2nd call, `computeReveal` grouping including an all-abstained session.

### Step 3 — REST routes + manual curl test

Order: `src/config.ts` → `src/middleware/errorHandler.ts` → `src/utils/validation.ts` → `src/routes/sessions.ts` → `src/app.ts` → minimal `src/server.ts` (REST only, no Socket.IO yet).

- **`src/config.ts`**: `loadConfig()` reads `PORT` (default 3001), `CORS_ORIGIN`, `NODE_ENV` once; returns a typed `Config` object passed explicitly into `app.ts`/`ioServer.ts` (not read from `process.env` inside them) — this dependency-injection is what makes `app.ts` testable with `supertest` in isolation from real env vars.
- **`src/middleware/errorHandler.ts`**: `AppError` → `{error: code, message}` JSON with status looked up from `ERROR_HTTP_STATUS[err.code]` (`errors.ts`) — the only place in the codebase that reads that table; unknown errors → generic `500`.
- **`src/utils/validation.ts`**: `validateParticipantName(name)` — `/^[A-Za-z0-9]{1,20}$/`, throws `AppError('INVALID_NAME', ...)`.
- **`src/routes/sessions.ts`**: `POST /` → `{adminName, pointSystem, sliderMax}` → `201 {sessionId, adminToken, adminParticipantId, adminName, pointSystem}` (Express 5 lets handlers `throw AppError` directly, no manual `next(err)`); `GET /:id` → **both** in-progress and ended responses include `{sessionId, pointSystem, ended}` (in-progress has no participant data beyond that; ended adds `reveal`). `pointSystem` (with `axisValues`) must be present in both cases, not just the in-progress one — a brand-new visitor arriving after the session has already ended has _only_ this REST response as their data source (no WS `session-info` is ever sent to them, since the frontend never opens a socket for an ended session), and needs `axisValues` to render the full grid dimensions, not just the squares that happen to have votes in `reveal.squares`. `404 UNKNOWN_SESSION` if missing.
- **`src/app.ts`**: `createApp(config)` factory — `cors()`, `express.json()`, inline `GET /healthz`, mounts `sessionsRouter` at `/sessions`, `errorHandler` last.
- **`src/server.ts`** (v1): builds `http.Server` around `createApp(config)`, `.listen(config.port)` — the only file that starts anything.
- **Manual test**: `curl -X POST .../sessions`, then `curl .../sessions/<id>`, `curl .../healthz`.

### Step 4 — Socket.IO layer + manual client script

Order: `src/ws/ioServer.ts` → `src/ws/handlers.ts` → extend `src/server.ts` to attach both to the same `http.Server` → `scripts/manual-ws-client.mjs`.

- **`src/ws/ioServer.ts`**: `createIoServer(httpServer, config)` — `new Server(httpServer, { cors: { origin: config.corsOrigin } })`. No listeners here — purely construction, mirroring `app.ts`'s separation of concerns.
- **`src/ws/handlers.ts`**: `registerSocketHandlers(io)`, single `io.on('connection', ...)`. On connect: read `sessionId` from handshake query, validate session exists (else `error` + disconnect), `socket.join(sessionId)`, direct `session-info` emit containing `{pointSystem, ended}` — `pointSystem` (with `axisValues`) is needed immediately so the client can render grid dimensions before `join`/`admin-auth` has even resolved, same reasoning as the REST endpoint above. `join` (name) → `addParticipant` (rejects with `SESSION_ENDED` if the session ended between connect and this event — see Step 2) → direct `joined` ack. `admin-auth` (adminToken) → `validateAdminToken` → direct `admin-acknowledged` ack that **includes the admin's current `selection`**, not just id/name (this is the fix that makes a reconnecting or second-tab admin socket see their real existing vote instead of a blank grid). `select-square` ({time,resource}) → `selectSquare` (rejects with `SESSION_ENDED` if a vote arrives just after the admin ends the session — the race this code exists for), direct `selection-acknowledged` on success, `error` on `AppError`. `end-session` (adminToken) → `endSession`; if `wasAlreadyEnded`, do nothing further (silent no-op, no re-broadcast); else `io.to(sessionId).emit('session-ended', reveal)` — the one broadcast event in the system. Every handler needs its own `AppError` → `error`-event translation; worth a small shared `withErrorHandling(socket, fn)` wrapper inside this file rather than repeating try/catch four times.
- **Extend `src/server.ts`**: add `createIoServer(httpServer, config)` + `registerSocketHandlers(io)` between building `httpServer` and calling `.listen()` — confirms Socket.IO attaches to the _same_ `http.Server` Express is mounted on, not a second listener.
- **`scripts/manual-ws-client.mjs`**: throwaway `socket.io-client` script (plain `.mjs`, not compiled) that connects with a `sessionId` from `process.argv`, logs every inbound event, and emits a scripted `join`/`select-square`/optionally `admin-auth`+`end-session` sequence — the "manual test with a small `socket.io-client` script" the architecture doc calls for (plain `wscat` can't speak Socket.IO's framing). Optional `"test:ws:manual"` npm script for convenience.

### Post-Step-4 — `CLAUDE.md`

**Yes, create one — after Step 4, not during scaffolding.** Deferred deliberately: it should describe real, verified behavior (commands that actually work, patterns that actually exist in committed code) rather than an aspirational plan that could drift from what Steps 1–4 actually produce. Authored via the **`writing-for-agents`** skill — a short commands-and-gotchas reference, not a restatement of `estimator-plan.md`. Non-obvious things worth including: the ESM/NodeNext requirement exists _specifically_ because `nanoid`/`nanoid/non-secure` is ESM-only (violating it surfaces as a runtime `ERR_REQUIRE_ESM`, not a compile error); the composition-root split (`server.ts` is the only file that calls `.listen()`); the domain-purity rule (`sessionStore.ts`/`pointSystems.ts` never import `express`/`socket.io`); and the shared `AppError` → `{code, message}` contract on both REST and WS, thrown directly thanks to Express 5's native async-error propagation. Should point at `PLAN.md` (this document, saved into the repo per 0.10 below) for the full backend build sequence, and at `estimator-plan.md` (now also in this same folder) for the full product spec.

### Sequencing dependencies across all 4 steps

1. `types.ts` + `errors.ts` before `pointSystems.ts`.
2. `pointSystems.ts` + `utils/id.ts` before `sessionStore.ts`.
3. `sessionStore.ts` + `errors.ts` before both `routes/sessions.ts` and `ws/handlers.ts`.
4. `config.ts` before `app.ts` and `ws/ioServer.ts` (both take `Config` as an argument).
5. `app.ts` and `ws/ioServer.ts` are siblings, no dependency on each other — but both must exist before the final `server.ts` wiring.
6. `server.ts` is written twice on purpose: a minimal REST-only version at the end of Step 3 (clean curl-testable checkpoint), extended in Step 4 to attach Socket.IO. Don't front-load the WS wiring during Step 3.
7. `verbatimModuleSyntax: true` means essentially every cross-file type import needs `import type { ... }` from `types.ts` onward.

---

## Critical Files

- `estimator-backend/src/types.ts`, `src/errors.ts` — the shared vocabulary every other file imports.
- `estimator-backend/src/sessionStore.ts` — the core state machine; almost everything else calls into it.
- `estimator-backend/src/ws/handlers.ts` — enforces the hidden-votes-until-reveal invariant and admin-token re-validation from the product spec.
- `estimator-backend/tsconfig.json` + `tsconfig.build.json` — the NodeNext/ESM setup that `nanoid` compatibility depends on.
- `estimator-backend/CLAUDE.md` — future-session context, written after Step 4, not during Phase 0.
- `estimator-backend/PLAN.md` — this document, saved into the repo per 0.10.
- `estimator-backend/estimator-plan.md` — the full product/architecture spec, now also copied into this folder.

## Verification

**Phase 0 (this pass):**

- `npm install` completes cleanly.
- `npm run lint` exits 0 (no source files yet, so trivially clean — confirms the flat config itself loads without error).
- `npm run format:check` passes on the scaffold files.
- `npm test` reports zero tests found _without failing_ (confirms `passWithNoTests: true` is actually working).
- `npm run typecheck` — with zero `.ts` files anywhere under `src/`/`tests/`/`scripts/`, `tsc` will most likely hard-error ("no inputs were found in config file") rather than run vacuously and pass. That's expected and fine at this point — not a sign the scaffold is broken — and gets resolved naturally the moment Step 1 adds real source files. Not treated as a Phase 0 pass/fail gate.
- `estimator-backend/PLAN.md` exists and matches this document.
- `git status` shows a clean initial tree ready for a first commit (not made automatically).

**Step 1–4 (future sessions):** each step's own unit tests (`pointSystems.test.ts`, `sessionStore.test.ts`) plus the manual curl / `socket.io-client` checks described inline above — matching the "Verification" section already agreed in `estimator-plan.md`.
