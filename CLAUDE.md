# estimator-backend

Backend for a "Jira poker" estimation tool: participants vote on a 2D time × resources grid, votes stay hidden until the admin ends the session. All 4 build steps are done — see [PLAN.md](PLAN.md) for the build sequence and [estimator-plan.md](estimator-plan.md) for the full product/architecture spec.

## State is in-memory, single-process

[sessionStore.ts](src/sessionStore.ts) holds every session in a module-level `Map`. No database, no persistence — a restart wipes all sessions, and there is no support for running more than one instance (a second process would have its own empty `Map`, so a client's REST/WS traffic must land on the same process every time). Don't assume sessions survive a deploy or scale horizontally without changing this.

## Composition root

[server.ts](src/server.ts) is the only file that calls `.listen()`. It wires together `createApp` ([app.ts](src/app.ts)), `createIoServer` ([ws/ioServer.ts](src/ws/ioServer.ts)), and `registerSocketHandlers` ([ws/handlers.ts](src/ws/handlers.ts)) on one shared `http.Server`. Everything else is importable and testable without a listening socket — tests build the same pieces directly instead of spawning `server.ts`.

## Domain purity

[sessionStore.ts](src/sessionStore.ts) and [pointSystems.ts](src/pointSystems.ts) never import `express` or `socket.io`. They're the transport-agnostic core; `routes/sessions.ts` and `ws/handlers.ts` are thin adapters that call into them. Keep new domain logic there, not in a route or socket handler.

## ESM / nanoid

This project is ESM (`"type": "module"`, NodeNext resolution). [utils/id.ts](src/utils/id.ts) imports `nanoid/non-secure`, which is ESM-only — importing it via `require` or a CJS build target will fail. `tsconfig.json`/`tsconfig.build.json` are already set up for this; if either drifts back toward CommonJS, this import breaks.

## Shared error contract

[errors.ts](src/errors.ts) defines `AppError` (a `code` from `ErrorCode` + a `message`) and `ERROR_HTTP_STATUS`, the one source of truth for both transports:

- REST: [middleware/errorHandler.ts](src/middleware/errorHandler.ts) catches a thrown `AppError`, looks up its status, and responds `{ error: code, message }`. A `ZodError` maps to `INVALID_REQUEST`/400. Anything else is an unexpected bug — generic 500, no leaked internals.
- WS: `withErrorHandling` in [ws/handlers.ts](src/ws/handlers.ts) gives the same two-tier treatment — a caught `AppError` becomes `socket.emit('error', { error: code, message })`; anything else logs the full error server-side and emits `INTERNAL_ERROR` with a generic message to the client.

Domain code (`sessionStore.ts`, `pointSystems.ts`) throws `AppError` and never touches Express or Socket.IO response objects directly — that's what keeps the two adapters this thin. Privileged actions (`end-session`) re-validate the admin token on every call, even for an already-authenticated socket — there's no "already trusted" shortcut (see comment at [ws/handlers.ts:107-110](src/ws/handlers.ts#L107-L110)).

## Votes stay hidden until reveal

`handleJoin` and `handleSelectSquare` in [ws/handlers.ts](src/ws/handlers.ts) only ever `socket.emit(...)` back to the calling socket, never `io.to(session.id).emit(...)`. No other participant learns who's joined or what anyone picked until `end-session` broadcasts the reveal — the one and only room-wide broadcast in the whole file. This is the product's core invariant, not an oversight: don't add a live roster or live-selection broadcast without re-reading `estimator-plan.md` first.

## No disconnect cleanup — participants and their votes are permanent

There is no `disconnect` handler in [ws/handlers.ts](src/ws/handlers.ts). A participant who closes their tab stays in `session.participants` for the rest of the session: their name stays permanently taken (a later rejoin with the same name gets suffixed, e.g. `Jim-1`), and if they'd voted, that vote still counts at reveal. Deliberate per `estimator-plan.md` decisions #7 (no reconnect identity), #11/#12 (`abstained` means "joined at some point, no selection by reveal time" — indistinguishable from someone who's still connected), and #15 (no live participant count/roster is ever shown). Don't add disconnect-based cleanup without checking those decisions — it would silently change who counts as `abstained`.

## WS/product behaviors that are deliberate, not bugs

Each of these is an accepted product decision, not a gap to fix — check `estimator-plan.md` before "fixing" any of them:

- **Forged pre-join event** ([ws/handlers.ts:94-100](src/ws/handlers.ts#L94-L100), decision #22a): `select-square` before `join`/`admin-auth` has run can only happen from a hand-crafted socket call, never a real client — it gets a plain `error` with no dedicated `ErrorCode`, deliberately, since no real flow reaches it.
- **Ended-session connect race** ([ws/handlers.ts:131-149](src/ws/handlers.ts#L131-L149), decision #22b): a socket connecting just as the admin ends the session is admitted rather than rejected. The frontend is expected to route off `session-info`'s `ended: true` rather than the backend refusing the connection.
- **No cross-tab admin sync** ([sessionStore.ts](src/sessionStore.ts)'s `selectSquare`, decision #20): `admin-auth` never mints a per-socket identity — every socket that authenticates with the same `adminToken` shares the one `adminParticipantId`. Two admin tabs both selecting squares is last-write-wins on `participant.selection`, with no live update pushed to the other tab (consistent with "votes stay hidden until reveal" above). A rare, self-inflicted scenario, accepted as out of scope rather than built out with per-socket admin bookkeeping.
