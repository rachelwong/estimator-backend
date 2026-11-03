# Plan — Change an estimate after the reveal

Today a session is frozen once the admin ends it. `select-square` gets
`SESSION_ENDED`, and the frontend closes its socket on the Reveal.

This plan lets anyone who joined (and the admin) keep changing their estimate
on the Reveal screen. Everyone looking at the Reveal sees the changes live.

Status: backend built (build steps 1–3, not yet deployed). Frontend not
started.

Rules and behaviour, without code:
[change-estimate-after-reveal-behaviour.md](change-estimate-after-reveal-behaviour.md).

Frontend work happens on `release/design` in `estimator-frontend` only.

## Decisions taken

Confirmed with the user. Don't re-open these while building.

- **Who can change.** Only people who joined before the end:
  - The admin, from any tab, any time. The stored admin token re-identifies
    them, even after a refresh.
  - A participant whose tab watched the session end and still has its socket.
- **How they change it.** Click another square on the Reveal grid. Clicking
  their own square clears it, same as before the end. No new buttons.
- **Nobody new can join.** `join` on an ended session is still rejected with
  `SESSION_ENDED`. A new visitor with the share link sees the Reveal and
  watches changes live, but can't vote.
- **Live updates for everyone.** Every vote after the end sends the new reveal
  to the whole session room.
- **Votes after the end extend the session's life.** An ended session is
  deleted 1 hour after the later of `endedAt` and its last post-end vote.
  A socket connecting still does not extend an ended session.
- **No lasting "changed" mark.** A changed square plays a short rolling
  gradient border, then goes back to normal. An estimate can change again,
  so marking it for good isn't useful. This is frontend only. The backend
  doesn't track who changed.

## Behaviour by viewer

| Viewer on `/:id/ended` | Sees live changes | Can change estimate |
| --- | --- | --- |
| Admin, any tab, before or after refresh | Yes | Yes |
| Participant whose tab watched the end | Yes | Yes |
| That participant after a refresh | Yes | No — no identity (decision #7) |
| New visitor with the share link | Yes | No |
| Any tab after its socket drops | No (last reveal stays on screen) | No |

A participant who refreshes keeps their old vote in the reveal but can't
change it. Same trade-off as decision #11, now also true after the end.

## Backend changes

The reveal payload shape does not change. No new fields on `Participant` or
`RevealPayload`.

### `src/sessionStore.ts`

- `selectSquare`: remove the `SESSION_ENDED` check. The square check and the
  toggle logic stay the same. Signature stays `Selection | null`.
- `selectSquare` keeps setting `lastActivityAt` on every accepted vote, ended
  or not.
- `isExpired`: an ended session's clock runs from
  `max(endedAt, lastActivityAt)`. Only an accepted vote moves
  `lastActivityAt` after the end:
  - `touchSession` still ignores ended sessions.
  - `addParticipant` still rejects ended sessions before touching the clock.
- `addParticipant`: unchanged. Still `SESSION_ENDED`.
- Update the comments on `selectSquare`, `isExpired`, `touchSession`.

### `src/ws/events.ts`

- Add `WsEvent.RevealUpdated: 'reveal-updated'`.
- Add to `ServerToClientEvents`:
  `[WsEvent.RevealUpdated]: (payload: RevealPayload) => void`.

### `src/ws/handlers.ts`

- `handleSelectSquare`: after `selection-changed` goes to the participant
  room, if `session.ended`, emit `reveal-updated` with `computeReveal(session)`
  to `io.to(session.id)`. Same pattern `routes/sessions.ts` already uses for
  `GET`.
- The pre-end path must not change: before the end, nothing goes to the
  session room. This is still the core rule.
- `handleAdminAuth`: no change. It already works on an ended session.
- No change to `connection`: a socket on an ended session already joins the
  session room, so watch-only visitors get `reveal-updated`.

### `src/routes/sessions.ts`

- No code change. `GET /sessions/:id` already recomputes the reveal on each
  read, so it shows post-end votes.

## Backend tests

Follow `test-conventions` (specific error codes, literal expected values,
paired boundary tests).

### Tests that break and need changing

- `tests/sessionStore.test.ts:301` "rejects a vote once the session has
  ended" → flip to "accepts a vote after the session has ended".
- `tests/handlers.test.ts:326` "rejects select-square on an already-ended
  session with error SESSION_ENDED" → flip to accepted.

### New tests — `sessionStore.test.ts`

- After end: move to another square, clear by clicking the same square.
- After end: an out-of-range square is still `INVALID_SELECTION`, store
  untouched.
- `computeReveal` after a post-end move or clear shows the new square, or the
  name in `abstained`.
- TTL, ended session (hand-typed times):
  - post-end vote at +30 min → alive at +1 h 30 min, gone 1 ms later
  - a rejected post-end vote (`INVALID_SELECTION`) does not extend it
  - `touchSession` still does not extend it
  - existing "runs its clock from endedAt" test still passes

### New tests — `handlers.test.ts`

- Post-end vote sends `reveal-updated` to every socket in the session,
  including one that never joined (watch-only).
- Post-end vote still sends `selection-changed` only to the voter's own room.
- **Before the end, a vote sends no `reveal-updated` to anyone.** Guards the
  core rule.
- Admin connects to an ended session, sends `admin-auth`, gets their selection,
  votes, and everyone gets `reveal-updated`.
- `join` on an ended session is still `SESSION_ENDED` (existing test, keep).
- `select-square` on an ended session from a socket that never identified is
  still the plain error (decision #22a).

### New tests — `sessions.test.ts` / `sessionSweeper.test.ts`

- `GET` on an ended session shows a post-end vote.
- Sweeper keeps an ended session alive past 1 h after `endedAt` when a vote
  came later.

## Frontend changes (`release/design` only)

The main shift: the Reveal screen now holds a live socket. Today `/ended`
never opens one, and the store closes its socket on `ENDED`.

### Protocol and constants

- `src/types/protocol.ts`: `ServerToClientEvents` gains `reveal-updated`.
  `RevealPayload` is unchanged.
- `src/constants.ts`:
  - `WebSocketEvent.REVEAL_UPDATED`
  - `SessionAction.REVEAL_UPDATED`

### State machine — `src/lib/sessionConnectionReducer.ts`, `src/types/session.ts`

- `ENDED` is no longer terminal. It carries:
  - `selection: Selection | null`
  - `reveal: RevealPayload | null` (null until one arrives over the socket)
  - `canVote: boolean` (true once identified)
  - `error: SessionError | null`
  - `isLive: boolean` (false after a disconnect)
- New transitions while `ENDED`:
  - `SELECTION_ACKED` → update `selection`
  - `REVEAL_UPDATED` → replace `reveal`
  - `IDENTITY_ACKED` → set `selection`, `canVote: true` (admin opening `/ended`)
  - `ERROR_RECEIVED` / `ERROR_DISMISSED` → set or clear `error`
  - `DISCONNECTED` → `isLive: false`, `canVote: false`. Stay on `ENDED`.
- `SESSION_ENDED` from `ACTIVE` now keeps the payload: `reveal` from the
  event, `canVote: true`.
- Update the state diagram in the reducer comment and in `PLAN.md`.

### Store — `src/lib/sessionConnectionRegistry.ts`

- `isTerminal` drops `ENDED`. The store no longer disconnects when the session
  ends.
- Keep the `session-ended` payload. Dispatch it instead of dropping it.
- Listen for `reveal-updated` → `REVEAL_UPDATED`.
- Identity on `session-info` with `ended: true`:
  - admin token → still send `admin-auth`
  - name → don't send `join` (it would be rejected)
  - watch-only → send nothing
- `SessionIdentity` gains a watch-only variant, e.g. `{ watchOnly: true }`.
  `endSession` stays a no-op for it.
- `hasLiveSessionConnection` / `hasIdentity` in `loaders.ts` must not treat a
  watch-only store as an identity.

### Routes — `src/routes/loaders.ts`, `src/routes/EndedPage.tsx`

- `endedLoader` opens a socket when this tab has none:
  - admin token → `getOrCreateSessionConnection(id, { adminToken })`
  - otherwise → watch-only
  - a participant's store from `/start` is reused as-is
- `revealViewer` reads `canVote` and `selection` from the store.
- `EndedPage` subscribes with `useSessionConnection` and renders
  `state.reveal ?? loaderData.session.reveal`.
- `EndedPage` shows `ErrorBanner` for `state.error`, e.g. a rejected square.
- When `isLive` goes false, keep showing the last reveal. Don't redirect to
  `/join` or show `ConnectionLost` full screen. Covers a dropped connection,
  a server restart and the TTL sweep.
  - Show a small note on the Reveal: "Live updates have stopped. Reload to
    see the latest estimates."
  - Under it, the existing `TryAgainButton`. It re-runs `endedLoader`.
  - `endedLoader` must swap a dead store for a fresh one, as `startLoader`
    already does for the admin:
    - admin token → new admin connection. Voting comes back.
    - no token → new watch-only connection. A participant comes back as a
      watcher.
    - session gone → `/not-found`, through `loadSession` as today.

### Grid — `src/components/EstimationGrid/`, `src/utils/grid.ts`

- Reveal grid needs a voting variant: reveal colours and names, plus
  click-to-vote. Options:
  - a third `GridMode` (e.g. `REVEAL_VOTING`)
  - or `READONLY` plus an `onSelect` prop
- For a voter:
  - a grid click calls `onSelect`, not the popover pin
  - hover replaces the click: the names box (`SquarePopover`) opens on hover
    and closes when the mouse leaves. The box itself is unchanged. It shows
    in place of the short tooltip, so the two don't overlap
  - keyboard focus on a square does the same as hover
  - chips in "Who landed where" still pin the popover
- For a watch-only viewer, grid click still pins the popover, as now.
- Check `squareLabel`, `squareFillClass`, `squareAriaLabel`, `tooltipText` for
  the new mode:
  - the aria label should say the square can be clicked to vote
  - no "click for names" for voters. Any prompt says "hover" instead
- Touch screens have no hover. A voter on a phone sees names inside the
  squares and by tapping a chip under the grid.
- The reveal wave (`ffRevealIn`) must not replay on every `reveal-updated`.
  Only on first render.
- "Your Square" marking follows the live `selection`.

### Change flash — `src/components/EstimationGrid/`

- On each `reveal-updated`, compare the new reveal with the one on screen.
  A square flashes when it gained a name — someone's new estimate, different
  from their previous one.
  - A move flashes the square joined. The square left doesn't flash.
  - A vote from Abstained flashes the square joined.
  - A clear flashes nothing. The name just moves to Abstained.
- **Not on the voter's own screen.** A tab skips a square whose only new
  name is its own. Covers every tab of that person, including the admin's
  other tabs.
  - The store keeps the viewer's own name from the `joined` /
    `admin-acknowledged` ack. Today it drops it.
  - Names are unique within a session, so comparing by name is safe.
  - A watcher has no name, so it flashes every change.
  - Frontend only. No backend change.
- The flash is a rolling animated rainbow gradient border. It plays once,
  briefly, then the square goes back to normal. Nothing is kept afterwards.
- Driven by the reveal diff only, not by `selection-changed`.
- A square that changes again mid-flash restarts its flash.
- No flash on first load, on the initial `session-ended`, or when the reveal
  didn't change.
- Grid squares only. Chips in "Who landed where" and Abstained don't flash.
- Chip order carries no meaning. `landedPeople` groups chips by square, so a
  move can shift a chip's place in the row. That's fine. No sorting needed.
- Reduced motion (`prefers-reduced-motion`): the same rainbow gradient
  border, static, shown for the same brief time, then gone.
- Must sit alongside the "Your Square" highlight and the hover highlight
  without hiding them. Record the flash in `DESIGN.md` §7 before building.
  Exact duration is picked at build time.
- The diff is a pure function (e.g. `changedSquares(previous, next)` in
  `src/utils/grid.ts`).

### Copy changes

Ship these with the feature, not before. Until it's live, they describe
something the site can't do.

**Reveal notice** — `src/components/RevealWindow/RevealNotice.tsx`

- Heading: "Estimating is done!" → "All estimates are now revealed!"
- Body: "Explore the grid to see how everyone estimated, click anywhere on
  the grid to change your estimate again. Latecomers to this session can see
  the estimates but they can't add their vote."
- One wording for voters and latecomers.
- The Welcome page hero draws the same `RevealWindow`
  (`src/routes/WelcomePage/HeroSection.tsx`). Its demo can't vote, so it gets
  its own body text: "Hover over the grid to see how everyone estimated."
  `RevealNotice` takes the body as a prop, or a flag for the demo.

**Welcome page, "Talk it through"** —
`src/routes/WelcomePage/HowToUseSection.tsx`

- Replace the whole card text with: "Talk through everyone's estimates, ask
  hard questions to flag uncertainties and dependencies. The best thing is
  the team can change their estimates!"
- This drops the current bold line "And start another session for the next
  task." Intended.

**Welcome page, House rules, "Change your mind"** —
`src/routes/WelcomePage/HouseRulesSection.tsx`

- Description: "Admin and users can change their estimates any time. Once a
  session has been revealed though, no latecomers can join the session to add
  their estimates"
- "latecomes" in the request is taken as "latecomers".

**Places that quote the old notice heading**

- `scripts/smoke/scenarios/welcome.mjs:57`
- `scripts/smoke/scenarios/session.mjs:308-309`
- `CONTEXT.md:51`

### Frontend smoke tests — `scripts/smoke/`

No unit test runner exists in the frontend. Smoke scenarios cover it.

- Existing checks to update or re-check:
  - `welcome.mjs` and `session.mjs`: "Estimating is done!" → the new notice
    heading.
  - `session.mjs` "No Square is pressed on the Reveal" — still true for the
    fresh visitor.
  - `session.mjs` Fay's checks on the live Reveal — she can now vote there.
- New checks:
  - Fay moves her vote on the Reveal → the admin and the fresh visitor see it
    move without a reload.
  - Fay's new square flashes on the admin's and the fresh visitor's tabs,
    then stops. It doesn't flash on Fay's own tab. Her old square doesn't
    flash. No square is left marked.
  - Admin moves → Fay and the fresh visitor see the flash, the admin
    doesn't.
  - Fay clears her vote → she moves to Abstained. Nothing flashes.
  - Fay hovers a square → its names show. No vote is sent.
  - Admin reloads `/ended` → can still vote. No flash on load.
  - Fay reloads `/ended` → sees the reveal, clicks do not vote.
  - Fresh visitor clicks a square → popover pins, no vote is sent.
  - The Welcome demo notice uses its own "hover" wording.
- `lib.mjs` may need a helper to spot a flashing square, e.g. by its
  animation name. `session.mjs` already checks `ffRevealIn` this way.

## Breaking changes

> **Read before merging.** None break an old frontend against the new
> backend. The new frontend **does** need the new backend.

### Wire protocol

1. **`select-square` after the end is accepted, not rejected.** Was
   `SESSION_ENDED`. An old frontend never sends it on purpose. But a click
   in flight as the admin ends the session now counts silently, instead of
   showing an error.
2. **New broadcast `reveal-updated`.** Additive. Old clients have closed their
   socket by then.

The reveal payload shape is unchanged, in `GET /sessions/:id`,
`session-ended` and `reveal-updated`.

### Product rules that change

3. **`session-ended` is no longer the only session-wide message.**
   `reveal-updated` joins it, only after the end. Votes before the end stay
   hidden. Update `CLAUDE.md` ("Votes stay hidden until reveal") and
   `estimator-plan.md` (invariant, decisions #6, #10).
4. **Ended sessions can live longer than 1 hour.** Decision #14 changes.
   Update `docs/features/session-ttl.md`, `CLAUDE.md`, `estimator-plan.md`.
5. **The frontend opens a socket for an ended session.** Reverses the
   `estimator-plan.md` rule "for an ended session, the frontend never opens a
   WebSocket at all". Update both repos' copies.
6. **Decision #22b note is outdated.** It says a socket on an ended session
   "can never successfully act". The admin and live participants now can.

### Internal code

7. **Frontend `ENDED` is no longer terminal.** Anything that relied on the
   store being dead after the end (`isTerminal`, `hasLiveSessionConnection`,
   the reducer's terminal guard, `revealViewer`) needs review.

### Which versions work together

| Frontend | Backend | Result |
| --- | --- | --- |
| old | new | Works. No live updates on the Reveal. |
| new | old | Broken. Votes on the Reveal get `SESSION_ENDED`. No live updates. |

Deploy the backend first. Full steps are in [Deployment](#deployment).

## Docs to update

Backend:

- `CLAUDE.md` — hidden-votes section, TTL paragraph, #22b bullet
- `estimator-plan.md` — decisions #6, #10, #14, #22b, the invariant, the
  ended-session REST/WS rule, test list
- `docs/features/session-ttl.md`
- `DEPLOYMENT.md` — "Operating notes": a session no longer always expires
  1 hour after the reveal. Mirrored in the frontend's
  `docs/plans/deployment.md`, so edit both.

Frontend (`release/design`):

- `estimator-plan.md` copy, `PLAN.md` state diagram
- `DESIGN.md` §7 Reveal — voting on the grid, the change flash
- `CONTEXT.md` — the "Estimating is done!" quote at line 51, and anywhere it
  defines the Reveal as read-only

## Build order

1. Backend: store and TTL. Store tests.
2. Backend: `reveal-updated` in the handler. Handler and REST tests.
3. Backend: docs. Deploy (stage 1 below).
4. Frontend: protocol, constants, reducer, store.
5. Frontend: `endedLoader`, `EndedPage`, disconnect handling.
6. Frontend: grid voting mode, change flash (after `DESIGN.md`).
7. Frontend: copy changes, smoke scenarios, docs. Deploy (stage 2 below).

## Deployment

Two stages, backend first. Stage 1 can stay live on its own for as long as
needed. Both frontends keep working on it.

### What's deployed where

| What | Branch | Host | URL |
| --- | --- | --- | --- |
| Backend | `master` | Render, auto-deploy | `https://estimator-backend-1nf2.onrender.com` |
| Frontend (new design) | `release/design` | Vercel | `https://fold-and-flip.vercel.app` |
| Frontend (prototype) | `master` | Vercel | `https://estimator-frontend-ashen.vercel.app` |

- Both frontends use the same backend.
- Only `release/design` gets this feature. The prototype stays on the old
  protocol. The backend must keep working for it, and it does (see the
  versions table above).
- Confirmed: the `fold-and-flip` Vercel project builds from
  `release/design`. That's the branch to update and deploy.

### Before you start

- **A backend deploy wipes every session.** State is in memory only. Deploy
  when nobody is mid-session.
- No env var changes on either side. `CORS_ORIGIN`, `VITE_API_BASE_URL` and
  `VITE_SOCKET_URL` stay as they are.
- Render ignores `**/*.md` pushes. A docs-only commit doesn't deploy. A code
  commit deploys everything with it.

### Stage 1 — Backend (Render)

Ships breaking changes 1–4 and 6. None of them break either frontend.

- [ ] B1. Local checks pass:
      `npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] B2. The compiled build boots:
      `NODE_ENV=production CORS_ORIGIN=https://example.com npm start`, then
      `/healthz` returns 200.
- [ ] B3. **Check that the old frontend still works with the new backend.**
      Run the new backend locally with the frontend on `master`:
      `npm run dev` there, and `npm run smoke`. The Reveal must still load and
      show no errors. This covers breaking changes 1–2.
- [ ] B4. Push to `master`. Render auto-deploys.
- [ ] B5. Render → Events shows the deploy live. Render → Logs shows no boot
      errors.
- [ ] B6. `curl https://estimator-backend-1nf2.onrender.com/healthz` returns
      200.
- [ ] B7. On the prototype (`-ashen`) and on `fold-and-flip` as it is now:
      create a session, join from a second profile, vote, and end it. Both
      tabs move to the Reveal, and the Reveal is right.

**Pause point.** Both frontends work. Ended sessions can now live longer than
1 hour if someone votes after the end. No current frontend can vote after the
end yet, so nothing changes for users.

### Stage 2 — Frontend (`release/design` → `fold-and-flip`)

Ships breaking changes 5 and 7. Needs stage 1 live first. Against the old
backend, votes on the Reveal fail with `SESSION_ENDED`.

- [ ] F1. Stage 1 is live: B5 and B6 pass.
- [ ] F2. Local checks pass on `release/design`: `npm run build`,
      `npm run lint`, and `npm run smoke` against a local backend on the new
      `master`. Includes the new scenarios.
- [ ] F3. Push `release/design`. Vercel builds `fold-and-flip`.
- [ ] F4. Check on the live site with two browser profiles, plus a private
      window for the new visitor:
  - Admin and participant vote. Admin ends the session.
  - Participant clicks another square on the Reveal. The admin's tab and
    the private window both update without a reload. The new square
    flashes briefly on those two, then stops. It doesn't flash on the
    participant's own tab.
  - Participant hovers a square. Its names show, and no vote is sent.
  - Participant clicks their own square. They move to Abstained. Nothing
    flashes.
  - Admin reloads the Reveal and can still vote. Nothing flashes on load.
  - Participant reloads the Reveal. Clicks no longer vote.
  - The private window can't vote. Clicking a square pins the names
    popover.
  - With reduced motion on in the OS, the flash is a static rainbow border,
    still brief.
  - The Reveal notice and the Welcome page show the new wording.
  - DevTools → Network: one `wss://` socket stays open on the Reveal.
- [ ] F5. Run the smoke suite against production:
      `SMOKE_APP_URL=https://fold-and-flip.vercel.app SMOKE_API_URL=https://estimator-backend-1nf2.onrender.com npm run smoke`.
      Run it after the deploy. The new checks fail against a build that
      doesn't have the feature yet.
- [ ] F6. Don't merge `release/design` into frontend `master` as part of this
      work. The prototype keeps working without it.

### Rollback

Roll back in reverse order: frontend first, then backend.

- **Frontend only:** Vercel → Deployments → the previous `fold-and-flip`
  build → Promote to Production. Safe at any time. An old frontend works on
  the new backend.
- **Backend:** roll back the frontend **first**. Then Render → Events → the
  previous deploy → Rollback.
  - Rolling back the backend alone breaks `fold-and-flip`. Votes on the
    Reveal get `SESSION_ENDED`, and live updates stop.
  - A Render rollback also wipes every session.

### Breaking changes by stage

| # | Breaking change | Ships in | Check |
| --- | --- | --- | --- |
| 1 | `select-square` accepted after the end | Stage 1 | B3, B7 |
| 2 | New `reveal-updated` broadcast | Stage 1 | B3 (old frontend ignores it) |
| 3 | Not the only session-wide message anymore | Stage 1 | Backend test: no `reveal-updated` before the end |
| 4 | Ended sessions can live past 1 hour | Stage 1 | Backend TTL tests |
| 5 | Frontend opens a socket on an ended session | Stage 2 | F4 (Network tab) |
| 6 | Decision #22b note outdated | Stage 1 | Docs only |
| 7 | Frontend `ENDED` not terminal | Stage 2 | F4, F5 |

## Risks and notes

- **A voter sees names by hovering, not clicking,** since a click votes.
  On touch screens there's no hover, so they rely on the names inside squares
  and the chips under the grid.
- **Each post-end click sends the full reveal to everyone.** Fine at team
  size.
- **No lock.** The admin can't freeze the reveal again. Votes keep changing
  until the session expires, and each vote pushes expiry out.
- **A flash can be missed.** Someone looking away won't know what changed.
  Accepted: the Reveal always shows the current estimates, and that's what
  matters.
- **Refreshing participants** still can't fix an old vote (decision #7).
