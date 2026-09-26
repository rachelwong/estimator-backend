# estimator-backend

Backend for a "Jira poker" estimation tool: participants vote on a 2D time × resources grid, votes stay hidden until the admin ends the session. All 4 build steps are done — see [PLAN.md](PLAN.md) for the build sequence and [estimator-plan.md](estimator-plan.md) for the full product/architecture spec.

## State is in-memory, single-process

[sessionStore.ts](src/sessionStore.ts) holds every session in a module-level `Map`. No database, no persistence — a restart wipes all sessions, and there is no support for running more than one instance (a second process would have its own empty `Map`, so a client's REST/WS traffic must land on the same process every time). Don't assume sessions survive a deploy or scale horizontally without changing this.

Sessions also expire on their own, on top of being wiped by restarts: an ended one is deleted 1 hour after `endedAt`, an open one 1.5 hours after `lastActivityAt` (creating, joining, voting, and a socket connecting all reset that clock; a pure read never does). `getSession`/`getSessionOrThrow` delete an expired entry on lookup, so the deadline is exact, and [ws/sessionSweeper.ts](src/ws/sessionSweeper.ts)'s one-minute timer clears out the sessions nobody looks at again and disconnects any sockets still in them. An expired session is deleted outright, never tombstoned — it reads exactly like one that never existed (`404`/`UNKNOWN_SESSION`). See [docs/features/session-ttl.md](docs/features/session-ttl.md).

## Composition root

[server.ts](src/server.ts) is the only file that calls `.listen()`. It:

- wires `createApp` ([app.ts](src/app.ts)), `createIoServer` ([ws/ioServer.ts](src/ws/ioServer.ts)) and `registerSocketHandlers` ([ws/handlers.ts](src/ws/handlers.ts)) onto one shared `http.Server`
- starts the session sweeper
- runs `createShutdown` ([shutdown.ts](src/shutdown.ts)) on `SIGTERM`/`SIGINT`: stop the sweeper, `io.close()`, exit. Exits anyway after 10 s.

Everything else can be imported and tested without a listening socket. Tests build the same pieces directly instead of running `server.ts`.

## Domain purity

[sessionStore.ts](src/sessionStore.ts) and [pointSystems.ts](src/pointSystems.ts) never import `express` or `socket.io`. They're the transport-agnostic core; `routes/sessions.ts` and `ws/handlers.ts` are thin adapters that call into them. Keep new domain logic there, not in a route or socket handler.

## ESM / nanoid

This project is ESM (`"type": "module"`, NodeNext resolution). [utils/id.ts](src/utils/id.ts) imports `nanoid/non-secure`, which is ESM-only — importing it via `require` or a CJS build target will fail. `tsconfig.json`/`tsconfig.build.json` are already set up for this; if either drifts back toward CommonJS, this import breaks.

## Shared error contract

[errors.ts](src/errors.ts) defines `AppError` (a `code` from `ErrorCode` + a `message`) and `ERROR_HTTP_STATUS`, the one source of truth for both transports:

- REST: [middleware/errorHandler.ts](src/middleware/errorHandler.ts) catches a thrown `AppError`, looks up its status, and responds `{ error: code, message }`. A `ZodError` (message formatted by `formatZodError`), or body-parser rejecting an oversized/malformed body, maps to `INVALID_REQUEST`/400. Anything else is an unexpected bug — generic 500, no leaked internals.
- WS: `withErrorHandling` in [ws/handlers.ts](src/ws/handlers.ts) gives the same treatment — a caught `AppError` becomes `socket.emit('error', { error: code, message })`, and a `ZodError` from parsing a payload against [ws/schemas.ts](src/ws/schemas.ts) becomes `INVALID_REQUEST`; anything else logs the full error server-side and emits `INTERNAL_ERROR` with a generic message to the client.

Domain code (`sessionStore.ts`, `pointSystems.ts`) throws `AppError` and never touches Express or Socket.IO response objects directly — that's what keeps the two adapters this thin. Privileged actions (`end-session`) re-validate the admin token on every call, even for an already-authenticated socket — there's no "already trusted" shortcut (see comment at [ws/handlers.ts:130-133](src/ws/handlers.ts#L130-L133)).

## Votes stay hidden until reveal

This is the product's core rule. Don't add a live roster or live-selection broadcast without re-reading `estimator-plan.md` first.

In [ws/handlers.ts](src/ws/handlers.ts):

- `handleJoin` and `handleAdminAuth` reply only to the calling socket.
- `handleSelectSquare` sends `selection-changed` to `participantRoom(sessionId, participantId)` ([ws/handlers.ts:37](src/ws/handlers.ts#L37)). That room holds only one participant's own tabs.
- A socket joins its participant room once `join`/`admin-auth` sets `socket.data.participantId`.
- `end-session`'s reveal is the only message sent to the whole session. Nothing else uses `io.to(session.id)`.

Why it's built this way:

- The room name includes the session id (`${sessionId}:${participantId}`). Socket.IO has one flat room namespace, and it already holds a room per session.
- `selection-changed` carries the result (`Selection | null`, `null` means cleared), not the square clicked. The server decides select vs. clear, so tabs never guess.

## No disconnect cleanup — participants and their votes are permanent

There is no `disconnect` handler in [ws/handlers.ts](src/ws/handlers.ts). A participant who closes their tab stays in `session.participants` for the rest of the session: their name stays permanently taken (a later rejoin with the same name gets suffixed, e.g. `Jim-1`), and if they'd voted, that vote still counts at reveal. Deliberate per `estimator-plan.md` decisions #7 (no reconnect identity), #11/#12 (`abstained` means "joined at some point, no selection by reveal time" — indistinguishable from someone who's still connected), and #15 (no live participant count/roster is ever shown). Don't add disconnect-based cleanup without checking those decisions — it would silently change who counts as `abstained`.

## WS/product behaviors that are deliberate, not bugs

Each of these is an accepted product decision, not a gap to fix — check `estimator-plan.md` before "fixing" any of them:

- **Forged pre-join event** ([ws/handlers.ts:119-124](src/ws/handlers.ts#L119-L124), decision #22a): `select-square` before `join`/`admin-auth` has run can only happen from a hand-crafted socket call, never a real client — it gets a plain `error` with no dedicated `ErrorCode`, deliberately, since no real flow reaches it.
- **Ended-session connect race** ([ws/handlers.ts:155-178](src/ws/handlers.ts#L155-L178), decision #22b): a socket connecting just as the admin ends the session is admitted rather than rejected. The frontend is expected to route off `session-info`'s `ended: true` rather than the backend refusing the connection.
- **Admin tabs share one identity** ([sessionStore.ts](src/sessionStore.ts)'s `selectSquare`, decision #20): every socket that sends the same `adminToken` shares one `adminParticipantId`, so they share one participant room.
  - Two admin tabs clicking is last-write-wins on `participant.selection`.
  - Every tab gets each `selection-changed`, so none goes stale.
  - Participants get the same sync, but can't open a second tab as the same person (decision #7).
