---
name: verify-before-assuming
description: Three verification habits for this repo, each learned from a real bug or gap in this codebase, not hypothetical advice — before reusing or inlining a helper function, check every place that actually calls it instead of assuming it's only used once; before writing a test for a condition built from || or &&, write a case that isolates each side instead of only a case where both sides agree; before removing a manual smoke-test script, check whether an automated test actually exercises the same wiring, not just its individual pieces. Use when writing or reviewing a function that calls another validator/helper, a test asserting behavior behind a multi-part boolean condition, or a composition-root file (server.ts, app entry point) that wires together already-tested modules.
---

Three habits, each caught a real bug or gap in this repo when followed — and missed one when skipped.

## Before touching a function, find every place that calls it

**What happened**: `createSession` called `validateSliderMax` directly, then called `computeAxisValues` right after — but `computeAxisValues` already calls `validateSliderMax` internally. Nobody had checked that before writing the direct call, so every `createSession` validated the same `sliderMax` twice, silently, for no reason. It only came to light when asked directly: "is this the only place `validateSliderMax` is used?"

**Why it matters**: A function that looks like a private, one-off detail might already be called from somewhere else — inside another function you're also calling, or from a completely different file. Guessing gets this wrong in both directions: assuming a function is unused-elsewhere leads to duplicate work like the bug above; assuming a function IS used elsewhere leads to leaving genuinely dead code in place, or being too timid to change something safe to change.

**How to apply it**: Before calling a second function that might already do what you're about to do, or before inlining/deleting/changing a function's behavior, `grep` the codebase for its name first. Look at every result, not just the one you expected. If it's called from more than one place, or has its own dedicated tests, treat it as shared and don't duplicate its logic next to it — call it once and let it do its job.

## When a test covers `||` or `&&`, isolate each side

**What happened**: `selectSquare` rejects a `{time, resource}` pair with `!axisValues.includes(time) || !axisValues.includes(resource)`. The only test for this passed `(100, 100)` — a value where *both* sides of the `||` are true at once. A test like that can't tell a correct `||` apart from a broken `&&`: both would reject that one input, so the test would pass either way and the bug would ship unnoticed.

**Why it matters**: `time` and `resource` are independent coordinates on the estimation grid. A real bad request — a forged WS payload, or a client bug touching only one axis — is far more likely to have exactly one bad coordinate than both. If `||` silently became `&&`, that single-bad-coordinate case would be wrongly accepted and written into `participant.selection`, corrupting what every participant later sees in the reveal. Only a test that isolates one side catches that.

**How to apply it**: whenever a condition combines two or more parts with `||` or `&&`, write at least one test case where only one part is true (or false) and the others are the "normal" value — not just a case where every part agrees. That one case is what actually proves each part of the condition is being checked on its own, not just along for the ride.

## Before removing a manual smoke test, check what's actually testing the wiring

**What happened**: `scripts/manual-ws-client.mjs` was the only thing that ever proved `server.ts`'s real composition worked — Express and Socket.IO sharing one `http.Server`/port, the way Render's single-port free tier requires. `tests/sessions.test.ts` tests `app.ts` via `supertest` (no real port, no Socket.IO attached); `tests/handlers.test.ts` tests the WS layer against a bare `http.Server` (no Express mounted). Both looked like solid backend coverage, but neither exercised the one line where the two actually get wired together. That gap was invisible until asked directly: "do I really need this manual script?"

**Why it matters**: splitting a system into independently-tested pieces is good practice, but the composition step — the one file where those pieces actually get assembled (`server.ts`, `main.ts`, an app entry point) — isn't automatically covered just because each piece is. It's easy to end up with full confidence in the parts and zero automated confidence in the whole, with only a manual script (that nothing forces anyone to run) standing in the gap.

**How to apply it**: before deleting a manual smoke-test script, or when reviewing a composition-root file, ask specifically "which automated test, if any, imports and wires these pieces together the *same way this file does* — not just each piece separately?" If nothing does, either add a small test that does (see `tests/server.test.ts`, which replaced `scripts/manual-ws-client.mjs`) or keep the manual step and say so explicitly, rather than silently relying on the sum of the parts.
