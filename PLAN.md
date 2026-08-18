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
npm install express cors socket.io nanoid zod

npm install -D typescript tsx vitest supertest socket.io-client \
  @types/node @types/express @types/cors \
  eslint @eslint/js typescript-eslint \
  prettier eslint-config-prettier
```

**Amended 2026-08-17**: `zod` added after Phase 0 originally ran (Steps 1–2 were already built without it). Needed starting Step 3 for REST request-body validation — see Step 3 below. It's a runtime dependency (not `-D`): request bodies are validated at request time, not just typechecked at compile time.

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

**Amended 2026-08-17 (2)**: added `"types": ["node"]`. Discovered while building Step 2 (`src/utils/id.ts`'s `import { randomBytes, randomUUID } from 'node:crypto'`): with this project's exact `typescript@6.0.3` + `@types/node@24.13.3` pairing, `tsc` fails to auto-discover `@types/node` for resolving `node:`-prefixed ambient module declarations unless `types` explicitly lists `"node"` — without it, every `node:*` import errors with `TS2591: Cannot find name 'node:crypto'`, even though `@types/node` is installed and otherwise unreferenced elsewhere in the config. Verified by reproducing the failure in an isolated tsconfig and confirming `types: ["node"]` alone fixes it.

```jsonc
{
  "compilerOptions": {
    "target": "ES2025",
    "lib": ["ES2025"],
    "types": ["node"],
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

Order: `src/utils/id.ts` first, then `src/sessionStore.ts` (needs `types.ts`, `errors.ts`, `pointSystems.ts`, `utils/id.ts`, and `src/utils/validation.ts`), then its tests. `utils/validation.ts` is nominally a Step 3 file (see below) but was pulled forward here — `sessionStore.ts` calls `validateParticipantName` directly, so it's a real Step 2 dependency, not just an organizational label. Nothing else from Step 3 (`config.ts`, `errorHandler.ts`, `routes/sessions.ts`, `app.ts`, `server.ts`) is needed yet.

- **`src/utils/id.ts`**: `generateSessionId()` — `nanoid/non-secure` `customAlphabet`, alphanumeric, length 16; `generateAdminToken()` — `crypto.randomBytes(32).toString('hex')` (64-char hex string — `randomBytes` alone returns a `Buffer`, not something that can sit in JSON/`localStorage`/a WS payload as-is; `hex` is picked over `base64url` purely for being the simpler, zero-ambiguity charset — `adminToken` is never embedded in a URL, so base64url's compactness buys nothing here); `generateParticipantId()` — `crypto.randomUUID()`. Participant IDs get their own, simpler generator: unlike `sessionId`, they never appear in a shareable URL and don't need to be short or typeable, so there's no reason to reuse `sessionId`'s constrained alphabet/length — a standard UUID is the right tool here.
- **`src/sessionStore.ts`** (zero framework imports): all session state lives in a single module-level `const sessions = new Map<string, SessionState>()` — a process-wide singleton (every importer of this module shares the same `Map` instance, per ES module caching), mutated in place via `.set`/`.get`/`.delete` rather than reassigned. This is a deliberate fit for this app, not a shortcut: `estimator-plan.md` already settles persistence as in-memory-only with no database ("Restarting the server loses all sessions — accepted tradeoff") and explicitly rejects wrapping it in a repository/interface abstraction ("there's exactly one storage backend, in-memory, with no plan to swap it — an interface would be pure ceremony"). A bare module-level `Map` would be a smell in a backend that needs real persistence or horizontal scaling — a second process wouldn't share this `Map`, so sessions would randomly 404 depending which instance handled the request — but this app is intentionally single-instance (one Render web service) with sessions pinned 1:1 to live Socket.IO connections anyway, so a second instance couldn't share those sockets either. The pattern also keeps this file framework-free and trivially unit-testable — no mocks or fixtures, just `resetSessionStore()` between tests (see below). Both `createSession`'s `adminName` and `addParticipant`'s `name` are **trimmed before validation** — leading/trailing whitespace only (`name.trim()`), *not* interior whitespace — so `"  Jim  "` is captured as `"Jim"`, while an embedded space (`"Jim Bob"`) is left as-is and falls through to `validateParticipantName`'s alphanumeric-only regex as an `INVALID_NAME` rejection (single-token names only). Once a name passes validation it is **capitalized** — first character uppercased, remainder lowercased (e.g. `"jIM"` → `"Jim"`) — before being used in the dedup loop or stored, so every stored/returned `Participant.name` is already in display-ready form and the frontend (out of scope for this plan) never needs its own capitalization logic. `createSession({adminName, pointSystemType, sliderMax})` — generates/regenerates-on-collision `sessionId`, generates `adminToken`, trims then calls `validateParticipantName(adminName)` (see below), capitalizes the result, and calls `computeAxisValues` (domain invariant, not solely the route layer's job) — **not** a separate direct call to `validateSliderMax` first, since `computeAxisValues` already validates internally; an earlier draft called both, which validated the same `sliderMax` twice on every `createSession` for no benefit — creates the admin as the first `Participant` (using `generateParticipantId()`); `getSession(id)`; `addParticipant(sessionId, name)` — **throws `AppError(ErrorCode.SessionEnded, ...)` if `session.ended`** (guards a stale/forged `join` racing an `end-session`, before doing anything else), otherwise trims then calls `validateParticipantName(name)`, capitalizes the result, generates a new `generateParticipantId()`, case-insensitive dedup by **existence-check loop** — try the capitalized `name`, then `name-1`, `name-2`, ... testing each candidate against current participants (case-insensitive comparison, e.g. `"jim"` collides with an existing `"Jim"`) until one is free, *not* a count of existing `name*` matches: participant records are never removed (decision #11's orphaned-vote tradeoff), so a count-based suffix can produce a real collision (e.g. a `Jim-1` from an earlier, now-orphaned join makes a naive count wrong) — only re-checking each candidate's actual availability is safe; `selectSquare(sessionId, participantId, time, resource)` — **throws `AppError(ErrorCode.SessionEnded, ...)` if `session.ended`** (guards a stale vote racing an `end-session` — the exact case named in `estimator-plan.md`'s WS error UX decision), otherwise validates `{time,resource}` are exact members of `pointSystem.axisValues` (not just numerically in range), same value as current selection → clears to `null` (deselect), otherwise overwrites (change-vote). `participantId` here is **never client-supplied** — the WS layer (Step 4) is the only caller, and it passes back the id its own `join` handler received from `addParticipant`, held in that connection's own closure state, never re-read off an incoming payload. So an `participantId` with no matching entry in `session.participants` cannot be produced by a real client action; treat it as a programming-invariant violation (a plain thrown `Error`, not a new `AppError`/`ErrorCode` member) rather than a new rejectable error case; `validateAdminToken(sessionId, adminToken)` — does its own `getSession` lookup (throws `AppError(ErrorCode.UnknownSession, ...)` if missing, checked *before* the token itself), then throws `AppError(ErrorCode.InvalidAdminToken, ...)` on mismatch, else **returns the `SessionState`** — both `endSession` below and Step 4's `admin-auth` handler need the session right after validating the token, so returning it avoids a second `getSession` call at each site; `endSession(sessionId, adminToken)` → `{reveal, wasAlreadyEnded}` — **always** re-validates the token (even on an already-ended session, per the "never trust a prior handshake alone" rule with no carve-out), and if already ended returns `wasAlreadyEnded: true` without re-mutating state, which is what lets the WS handler (Step 4) suppress a duplicate broadcast; `computeReveal(session)` — pure, exported separately for direct unit testing, groups participants by selection into `squares`, non-voters into `abstained`. `endSession` is the one deliberate exception to the "reject on an ended session" rule above — it's idempotent by design (decision #21), not guarded the same way `join`/`select-square` are. `resetSessionStore()` — test-only export that clears the module-level `Map`; needed because vitest runs every case in `sessionStore.test.ts` against the same module instance, so without an explicit reset, dedup/collision state leaks across unrelated test cases within the file. Called from `beforeEach`/`afterEach`, not used outside tests.
- **`tests/sessionStore.test.ts`** (51 cases): `resetSessionStore()` in `beforeEach` for isolation; `getSession` returning the session when found and `undefined` when not; collision-triggered id regeneration (via a partial `vi.mock` of `utils/id.ts` that wraps the real `generateSessionId` and only forces a collision inside that one test); name dedup chain (including a case where a literal `"Jim-1"` already exists before a second `"Jim"` joins, to pin down the existence-loop behavior over a naive count, and a case-insensitive collision where `"jim"` joins after an existing `"Jim"`); name trimming of leading/trailing whitespace before validation (e.g. `"  Jim  "` → stored as `"Jim"`), an embedded space (e.g. `"Jim Bob"`) still rejected as `INVALID_NAME`, post-validation capitalization (e.g. `"jIM"` → stored as `"Jim"`), and a 20-character name accepted at the exact ceiling (paired with the existing over-ceiling rejection, matching `pointSystems.test.ts`'s own boundary-pairing convention); select/deselect/change-vote toggling; `selectSquare` rejecting a non-member `{time,resource}` pair, *and* a pair where only one coordinate is out of range (proves both sides of the `||` check are independently enforced, not just the both-invalid case); `selectSquare` and `addParticipant` both rejecting with `UNKNOWN_SESSION` for a session id that doesn't exist, and with `SESSION_ENDED` once `session.ended` is true; `addParticipant`/`createSession` rejecting an invalid name (empty, too long, non-alphanumeric after normalization) with `INVALID_NAME`; `endSession` idempotency (`wasAlreadyEnded: true` + identical reveal on 2nd call); `endSession` rejecting a bad token even on the 2nd call; `validateAdminToken` rejecting an unknown `sessionId` with `UNKNOWN_SESSION` before ever checking the token; `computeReveal` grouping including an all-abstained session and a mixed session (some participants voted on different squares, another abstained entirely).

### Step 3 — REST routes + manual curl test

Order: `src/config.ts` → `src/schemas.ts` → `src/middleware/errorHandler.ts` → `src/utils/validation.ts` → `src/routes/sessions.ts` → `src/app.ts` → minimal `src/server.ts` → `tests/sessions.test.ts` (REST only, no Socket.IO yet).

**Amended 2026-08-17 (grilling session on this step, before implementation)**: several changes below versus the original draft of this step, all settled before any Step 3 code was written — see rationale inline at each bullet.

- **`src/config.ts`**: `loadConfig()` reads `PORT` (default 3001), `CORS_ORIGIN`, `NODE_ENV` once; returns a typed `Config` object passed explicitly into `app.ts`/`ioServer.ts` (not read from `process.env` inside them) — this dependency-injection is what makes `app.ts` testable with `supertest` in isolation from real env vars. `CORS_ORIGIN` stays a **plain string** — a single allowed origin, matched by exact equality — not a comma-separated list with a validator function; no second origin is actually planned (preview/branch deploys are explicitly out of scope), so building that machinery now would be exactly the kind of speculative complexity this project's own conventions warn against elsewhere (no repository abstraction, no DI container). **Amended 2026-08-18 (grilling session on this step)**: `estimator-plan.md`'s Deployment section originally described list-parsing instead — corrected there to match this decision, rather than the other way around, since a single fixed production origin is genuinely all this app needs; revisit only if a real second origin is ever confirmed (build order step 11). `loadConfig()` also **fails fast**: it throws at startup if `CORS_ORIGIN` is missing or empty **when `NODE_ENV === 'production'`** — local/dev/test stay unguarded (nothing stops a bare `npm run dev` with no `.env` from booting, it just won't do CORS correctly) — so a misconfigured production deploy crashes at boot instead of silently blocking all frontend traffic the first time a real request needs CORS. **Amended 2026-08-18 (2)**: presence alone doesn't catch the likelier real mistake — a *wrong but non-empty* value. Two additional production-only checks, both narrow and cheap rather than full URL-shape validation (over-engineering for one env var with one legitimate value): reject if `CORS_ORIGIN` has a trailing slash (violates the documented exact-match rule in `estimator-plan.md`'s Deployment section), and reject if it equals the literal local-dev default (`http://localhost:5173`, the same value `.env.example` ships) — a plausible copy-paste-into-Render mistake, not a hypothetical one. **Amended 2026-08-18 (3)**: that second check's value, `LOCAL_DEV_CORS_ORIGIN`, is now an **exported** constant (not a private one), specifically so a new `tests/config.test.ts` case — `readFileSync('.env.example')`, parse the `CORS_ORIGIN=` line, assert it equals `LOCAL_DEV_CORS_ORIGIN` — can hold `config.ts` accountable to `.env.example`, turning a silent drift between the two files into a failing test. A generic `constants.ts` was considered and rejected: `.env.example` is plain text, not a TS module, so no TS-side file (whether `config.ts` itself or a shared constants file) can be imported by it — centralizing wouldn't touch the actual drift risk, only a test that reads both files can.
- **`src/schemas.ts`** (new file, not in the original draft of this step): Zod schemas for the REST surface, both request and response.
  - **Request** — `CreateSessionRequestSchema` (the only route with a body). **Shape-only validation, deliberately not domain rules**: checks `adminName` is a non-empty string, `sliderMax` is a number, `pointSystemType` is one of the two literal values — it does **not** re-implement the name regex or slider ceilings, since those already live correctly in `utils/validation.ts`/`pointSystems.ts` (Step 1–2, already tested) and duplicating them here would create two sources of truth for the same rule with nothing keeping them in sync. `pointSystemType` is validated as `z.enum([PointSystemType.Numerical, PointSystemType.Fibonacci])` — **derived from the existing `PointSystemType` const object in `types.ts`, not retyped as fresh `'numerical'`/`'fibonacci'` string literals** — per this repo's own `no-magic-strings` convention (`.claude/skills/no-magic-strings/SKILL.md`, which cites `PointSystemType` itself as the pattern's example). Called via `.parse()` (not `.safeParse()`) as the first line of the route handler — matches this codebase's existing pattern of throwing directly and letting Express 5 propagate the error, rather than each route hand-rolling an `if (!result.success)` branch. A thrown `ZodError` is handled centrally by `errorHandler.ts` (below), not caught in the route itself.
  - **Response** — `CreateSessionResponseSchema`, `GetSessionResponseSchema`, both declared `.strict()`. Used as the `z.infer<>` type source for what each route returns (compile-time guarantee `res.json(...)` matches the documented shape) and asserted against real responses in `tests/sessions.test.ts` (below) — never `.parse()`'d in the live route itself, since nothing adversarial controls a response this backend builds itself, so runtime-checking it on every request would just be redundant with what the compiler already guarantees. `.strict()` specifically matters here, not just as a style choice: Zod's default `.parse()` silently *strips* unknown keys rather than rejecting them, so a non-strict schema would let an accidentally-leaked field (e.g. `adminToken` slipping into `GET /:id`'s response — see the `routes/sessions.ts` bullet below) pass the test undetected. `.strict()` is what makes the test-time assertion an actual guard against that leak rather than a no-op. This also directly answers why response schemas are worth having at all despite never running in production: `estimator-plan.md` commits to hand-duplicating protocol types across `estimator-backend`/`estimator-frontend` with no shared package, so this is the one place anything would catch the backend's real response drifting from what the frontend's hand-copied type expects.
- **`src/errors.ts`** (amended in Step 3, already built in Step 2): adds a 7th code, `ErrorCode.InvalidRequest` → `400`, alongside the existing six in `ERROR_HTTP_STATUS`. Distinct from `INVALID_NAME`/`INVALID_SLIDER_MAX`: those mean "well-formed request, rejected by a domain rule"; `INVALID_REQUEST` means "malformed request — wrong type or missing field entirely," the category a `ZodError` from `schemas.ts` maps to. **Amended 2026-08-18**: also adds an 8th code, `ErrorCode.InternalError` → `500`, for `errorHandler.ts`'s true-fallback branch (see below) — this repo's `no-magic-strings` convention (`.claude/skills/no-magic-strings/SKILL.md`) applies to that literal the same as any other discriminant string, so it moved into the same `ErrorCode`/`ERROR_HTTP_STATUS` pair rather than staying a bare string at the call site.
- **`src/middleware/errorHandler.ts`**: `AppError` → `{error: code, message}` JSON with status looked up from `ERROR_HTTP_STATUS[err.code]` (`errors.ts`) — the only place in the codebase that reads that table. **New in this amendment**: also special-cases `ZodError` (from `zod`) → `{error: 'INVALID_REQUEST', message}` at `400`, formatted from the Zod issue list — keeps "only this file knows about transport status codes" intact rather than teaching `schemas.ts`/routes to translate their own errors. Any other unknown error → generic `500`, now via `ErrorCode.InternalError` (see amendment above) rather than a bare literal. **Amended 2026-08-18 (2)**: each of the three branches also logs before responding — `console.warn` for `AppError`/`ZodError` (expected, non-bug rejections; kept out of `error`-level logs so they don't read as incidents) and `console.error` (with the full caught value, for a stack trace) for the true fallback branch, which is an actual unexpected bug. Deliberately placed here rather than inside `AppError`'s constructor: `AppError` is thrown from `sessionStore.ts`/`pointSystems.ts`, which stay framework-free by design, and constructing an error is not the same event as it going unhandled to a client — logging at construction time would also fire during the many places tests construct/expect an `AppError` as a normal passing-test assertion, not an incident. **Amended 2026-08-18 (3)**: plain `console.warn`/`console.error` — not a structured logger (pino, winston) — is the right tool here specifically because this is a hobby project, not a production service with an on-call rotation. The textbook argument for a structured logger is JSON output plus log levels plus request-correlation IDs feeding a search/alerting pipeline; none of that exists or is planned here — there's no log aggregator, no dashboard, no second person paged at 2am, just Render's raw stdout/stderr capture, which `console.*` already writes to correctly split by severity. Reaching for a logging library now would be paying real setup and dependency cost for capabilities this project has no consumer for, the same speculative-complexity trade this plan already declines elsewhere (no repository abstraction, no DI container, no CI gate). Revisit only if a real consumer shows up — e.g. this app gets a second maintainer who needs alerting, or moves off a single Render instance — not preemptively.
- **`src/utils/validation.ts`**: `validateParticipantName(name)` — `/^[A-Za-z0-9]{1,20}$/`, throws `AppError(ErrorCode.InvalidName, ...)`. Case-insensitive by construction (the character class covers both cases, so `"Jim"` and `"jim"` are equally valid) and is called by the store *after* leading/trailing whitespace has already been trimmed from `name` (see Step 2) — any interior space is left for this regex to reject as `INVALID_NAME`, since embedded spaces were never stripped. Capitalization (also Step 2) happens *after* this validator returns, not before — it's a display-formatting step on an already-valid name, not part of the validation contract itself. Called from `sessionStore.createSession`/`addParticipant` (Step 2), **not** from `routes/sessions.ts` directly — same treatment as `validateSliderMax`, which the route also doesn't call itself. This matters beyond consistency: `POST /sessions` is not the only entry point that creates a participant — Step 4's WS `join` event is the *only* path for every non-admin participant, and it was never going to call this file's export on its own. Putting the check inside the store means it's enforced no matter which transport calls in, instead of depending on both a REST route and a WS handler independently remembering to call it. This file's regex/ceiling-style domain rules are **not** duplicated in `schemas.ts` — see that bullet above.
- **`src/routes/sessions.ts`**: `POST /` → body validated first via `CreateSessionRequestSchema.parse(req.body)` (throws `ZodError` on shape mismatch, see above) → `{adminName, pointSystemType, sliderMax}` (**request field renamed from `pointSystem` to `pointSystemType`** — the original draft used `pointSystem` for both the request field, a bare type string, and the response field, the full `{type, sliderMax, axisValues}` object; same name meaning two different shapes was a real footgun for whoever wrote this route, and `pointSystemType` also now matches `createSession`'s existing parameter name exactly, so no renaming happens at the route boundary) → `201 {sessionId, adminToken, adminParticipantId, adminName, pointSystem}` — `adminName` in the response is read from the **created admin participant record** (`session.participants.get(session.adminParticipantId).name`), not echoed raw from the request body, since `createSession` trims/capitalizes it (e.g. `"jIM"` → `"Jim"`) before storing — echoing the raw input would show the admin a name that doesn't match what every other participant eventually sees at reveal. After the Zod parse, the route just calls `createSession` and lets a thrown `AppError(ErrorCode.InvalidName, ...)` or `AppError(ErrorCode.InvalidSliderMax, ...)` propagate to `errorHandler` (Express 5 lets handlers `throw AppError` directly, no manual `next(err)`); `GET /:id` → **both** in-progress and ended responses include `{sessionId, pointSystem, ended}` (in-progress has no participant data beyond that; ended adds `reveal`). `pointSystem` (with `axisValues`) must be present in both cases, not just the in-progress one — a brand-new visitor arriving after the session has already ended has _only_ this REST response as their data source (no WS `session-info` is ever sent to them, since the frontend never opens a socket for an ended session), and needs `axisValues` to render the full grid dimensions, not just the squares that happen to have votes in `reveal.squares`. `404 UNKNOWN_SESSION` if missing — the route itself calls `getSession(id)` and throws `AppError(ErrorCode.UnknownSession, ...)` when it returns `undefined`, since `getSession` only ever returns the session or `undefined` and never throws (Step 2); this check is new route-level logic, not something Step 2's tests already exercise (see the test bullet below). **Both responses are built as new plain objects picking only the documented fields — never `{...session, ...}` or any other spread of the raw `SessionState`.** `SessionState` carries `adminToken` as a plain string field; `GET /:id` is public and unauthenticated (per `estimator-plan.md`), so a naive spread would leak the one value in this system described as needing to "resist guessing" straight into an unauthenticated response the instant someone implemented the route by convenience instead of explicitly. `participants` (a `Map`) would silently serialize to `{}` either way, so this risk is specific to `adminToken`, not participant data — but it's real, not hypothetical, since spreading is the shorter thing to type.
- **`src/app.ts`**: `createApp(config)` factory — `cors()`, `express.json()`, inline `GET /healthz`, mounts `sessionsRouter` at `/sessions`, `errorHandler` last.
- **`GET /healthz`**: a plain, unauthenticated route returning `200` with no body/domain logic behind it — not part of the product's REST surface described in `estimator-plan.md`, purely infrastructure. **What it's actually for**: Render polls this path after every deploy to decide whether the new instance is safe to receive traffic. Render's deploy model is immutable — each deploy provisions a fresh instance from scratch, and that instance only gets cut into traffic once `/healthz` responds successfully; if the process never reaches that point (crashes on boot — e.g. the `CORS_ORIGIN` fail-fast checks above), Render discards the new instance and keeps routing to the last instance that *did* pass, marking the deploy failed rather than taking the app down. This is what makes crashing on a bad `CORS_ORIGIN` a safe choice rather than a risky one on this platform (confirmed against Render's own docs during the Step 3 grilling session, not assumed) — a blocked deploy, not an outage. It's also why `tests/sessions.test.ts` asserts `GET /healthz → 200` even though there's no domain behavior to test: it's the one endpoint this entire safety argument depends on, and nothing else in the suite would catch it silently breaking (wrong path, wrong method, an accidental `throw`, middleware ordering that shadows it).
- **`src/server.ts`** (v1): builds `http.Server` around `createApp(config)`, `.listen(config.port)` — the only file that starts anything.
- **`tests/sessions.test.ts`** (new file, not in the original draft of this step): `supertest` against `createApp(config)` directly — no real network, no `server.ts` involved. This becomes the primary correctness verification for Step 3 (matching the coverage-by-test-file convention Steps 1–2 already established), not the manual curl pass below.
  - `POST /sessions` happy path: numerical (e.g. `sliderMax: 5`) → `201`, response checked against `CreateSessionResponseSchema.strict()`, plus hand-typed (per `test-conventions`, independent of the implementation's formula) `axisValues: [0,1,2,3,4,5]`; fibonacci (e.g. `sliderMax: 10`) → `201`, `axisValues: [0,1,2,3,5,8]` hand-typed.
  - `POST /sessions` domain rejection (proves the route correctly propagates `AppError` from `sessionStore` unmodified): name with an embedded space → `400 {error: 'INVALID_NAME'}`; over-ceiling `sliderMax` → `400 {error: 'INVALID_SLIDER_MAX'}`.
  - `POST /sessions` shape rejection (the behavior this step actually adds): missing `adminName` → `400 {error: 'INVALID_REQUEST'}`; `sliderMax` sent as a string → `400 {error: 'INVALID_REQUEST'}` (paired against the domain-rejection case above — same field, two different failure categories, proving the shape/domain split from `schemas.ts` actually holds); `pointSystemType: "tshirt"` (outside the enum) → `400 {error: 'INVALID_REQUEST'}`.
  - `GET /sessions/:id` in-progress: create then fetch → `200`, `GetSessionResponseSchema.strict()`, plus an explicit `expect(body.adminToken).toBeUndefined()` — belt-and-suspenders on top of the strict-schema check, since this is the actual security property being protected, not just a shape to match; `ended: false`, no `reveal` key.
  - `GET /sessions/:id` ended: fixture created by calling `endSession()` from `sessionStore.ts` **directly** (not through a real end-session flow — Step 4/WS doesn't exist yet) → `200`, `reveal` present and correctly shaped, `adminToken` still absent.
  - `GET /sessions/:id` unknown id (a syntactically-valid but never-created session id) → `404 {error: 'UNKNOWN_SESSION'}`. **Amended 2026-08-18**: this case was originally marked as skippable ("already covered at the `sessionStore` level in Step 2's tests") — that reasoning was wrong. `sessionStore.getSession()` only ever returns the session or `undefined`; it never throws. The `404`/`UNKNOWN_SESSION` behavior is new logic living entirely in `routes/sessions.ts` (see that bullet above), which Step 2's tests never touch — this is the only place it's actually exercised, so it stays in the suite.
  - `GET /healthz` → `200`.
  - A route that doesn't exist anywhere in the app (not `/healthz`, not under `/sessions`) → non-`200` status (Express's default unmatched-route fallback, `404`) — guards against a future overly-broad catch-all middleware accidentally 200-ing everything.
  - Deliberately **not** included: a forced generic-`500` test (no natural route produces one — contorting the router just to hit that fallback tests defensive code, not real behavior).
- **Manual test**: now secondary to the automated suite above — narrowed to what only a live server actually proves (port binding, env loading, real HTTP over the wire), not full case coverage. `curl -X POST .../sessions`, then `curl .../sessions/<id>`, `curl .../healthz`.

### Step 4 — Socket.IO layer + manual client script

Order: `src/ws/ioServer.ts` → `src/ws/handlers.ts` → extend `src/server.ts` to attach both to the same `http.Server` → `scripts/manual-ws-client.mjs`.

- **`src/ws/ioServer.ts`**: `createIoServer(httpServer, config)` — `new Server(httpServer, { cors: { origin: config.corsOrigin } })`. No listeners here — purely construction, mirroring `app.ts`'s separation of concerns.
- **`src/ws/handlers.ts`**: `registerSocketHandlers(io)`, single `io.on('connection', ...)`. On connect: read `sessionId` from handshake query, validate session exists (else `error` + disconnect), `socket.join(sessionId)`, direct `session-info` emit containing `{pointSystem, ended}` — `pointSystem` (with `axisValues`) is needed immediately so the client can render grid dimensions before `join`/`admin-auth` has even resolved, same reasoning as the REST endpoint above. A `let participantId: string | undefined` is declared in the `connection` handler's closure, one per socket — this is the socket's sole record of "who it is," never re-derived from an incoming payload. `join` (name) → `addParticipant` (rejects with `SESSION_ENDED` if the session ended between connect and this event — see Step 2) → stores the returned id into that closure's `participantId` → direct `joined` ack. `admin-auth` (adminToken) → `validateAdminToken` (also sets `participantId` to `session.adminParticipantId` on success — the admin's own reconnect/second-tab path never goes through `join`, so this is the other place `participantId` gets assigned) → direct `admin-acknowledged` ack that **includes the admin's current `selection`**, not just id/name (this is the fix that makes a reconnecting or second-tab admin socket see their real existing vote instead of a blank grid). `select-square` ({time,resource}) → `selectSquare(sessionId, participantId, time, resource)`, reading `participantId` from the closure, **never from the event payload** — the payload only ever carries `{time, resource}` — (rejects with `SESSION_ENDED` if a vote arrives just after the admin ends the session — the race this code exists for), direct `selection-acknowledged` on success, `error` on `AppError`. If `select-square` arrives before `participantId` is set (i.e. before `join`/`admin-auth` resolved), reject client-side with an `error` — there's no valid `AppError`/`ErrorCode` for "not identified yet" since it can't happen through the normal client flow, only a malformed/out-of-order client. `end-session` (adminToken) → `endSession`; if `wasAlreadyEnded`, do nothing further (silent no-op, no re-broadcast); else `io.to(sessionId).emit('session-ended', reveal)` — the one broadcast event in the system. Every handler needs its own `AppError` → `error`-event translation; worth a small shared `withErrorHandling(socket, fn)` wrapper inside this file rather than repeating try/catch four times.
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
