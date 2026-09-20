# Feature — `/healthz` Heartbeat Logging

Log a line every time `/healthz` is hit, so the server's log stream shows a
steady pulse instead of silence. When sessions vanish in production, the shape
of that pulse tells you why.

## The problem

You create a session, and seconds or minutes later the app says it doesn't
exist:

```
GET /sessions/T1YRo24LjKexYk7R
404  { "error": "UNKNOWN_SESSION", "message": "No session found with id ..." }
```

Nothing is broken in the code. Sessions are kept in an ordinary `Map` held in
the server's memory (`src/sessionStore.ts`). There is no database. When the
server process stops, every session stops with it — there is no delete, no
expiry and no cleanup anywhere in the backend, so a session that goes missing
means the whole process was replaced.

This never happens on localhost, because your local server keeps running while
you work. On Render, two normal events replace the process:

1. **A deploy.** Auto-deploy is on, so every push to `master` builds a new
   instance and switches traffic to it. Even a docs-only commit does this. The
   moment the switch completes, every live session is gone.
2. **Going to sleep.** The free tier sleeps after 15 minutes with no inbound
   HTTP traffic, and an open socket doesn't count as traffic. The next request
   wakes a brand new, empty process.

Both look identical from the browser: a session that existed a moment ago now
404s.

## Why it was hard to diagnose

The backend only logged problems, never progress. Before this change there were
exactly four log statements: one at startup, and three for errors. A successful
request produced no output at all.

So the Render logs showed the symptom — the `UNKNOWN_SESSION` warning — and
nothing about the cause. You couldn't tell a deploy from a sleep, or either from
a crash, because a healthy server and a server that had just restarted looked
the same: quiet.

It also meant the keep-alive ping was invisible. The ping could be working
perfectly and the logs would still show nothing, which makes the deployment
checklist's "confirm the logs show the `/healthz` request" impossible to
satisfy.

## What changed

**1. `/healthz` logs every hit** (`src/app.ts`)

```
GET /healthz
```

One line, no detail — Render stamps its own timestamp on each line. The
keep-alive job pings every 10 minutes, so this is about 144 lines a day.

**2. A build filter, so docs pushes stop restarting the server**
(`render.yaml`, and `DEPLOYMENT.md` R10)

Markdown files are excluded from triggering a build. Note that editing
`render.yaml` alone does nothing here: the live service was created by hand in
the dashboard rather than from a Blueprint, so Render never reads that file. The
filter has to be set in the dashboard, which is what R10 is for. The entry in
`render.yaml` records the intent so the file stays honest.

**3. The deployment checklist says what to look for** (`DEPLOYMENT.md` C4)

C4 now names the `GET /healthz` line, and records that a response carrying
`x-render-origin-server: Render` and `cf-cache-status: DYNAMIC` already proves
the ping reached the app rather than a cache — useful before the logs catch up.

## How to read the logs now

A healthy service is a line every 10 minutes:

```
10:00:12  GET /healthz
10:10:14  GET /healthz
10:20:11  GET /healthz
```

A restart is a gap, then the startup line:

```
10:00:12  GET /healthz
10:04:38  Jira poker backend listening on port 10000     <- restarted here
10:10:14  GET /healthz
```

Anything created before that startup line is gone. Render → Events then says
which kind of restart it was: "Deploy live" for a push, or a spin-down notice
for a sleep.

## What this does and doesn't fix

It does not make sessions survive a restart. That is deliberate and documented —
in-memory-only storage is an accepted trade-off (`estimator-plan.md` decision
#14, and the note at the top of `CLAUDE.md`). Sessions were never meant to
outlive the process.

What it fixes is that a restart used to be invisible, so the same 404 could
leave you hunting for a bug in code that was working correctly. Now the cause is
readable in the logs.

Two related items are still open in `DEPLOYMENT.md`:

- **C1** — create the cron-job.org keep-alive ping. Until it exists, the service
  still sleeps after 15 idle minutes, which is the second cause above.
- **R10** — set the build filter in the Render dashboard. Until it's set, any
  push still restarts the service.

## What we observed

On 2026-09-20 a session was created and polled every 30 seconds. It answered 200
for 24 consecutive checks over about 12 minutes — the instance was completely
stable. A commit was pushed at 10:08:04. At 10:08:47, 43 seconds later, that
session and an older one both returned 404 together.

Continuous traffic every 30 seconds rules out the sleep explanation for that
event: the service was never idle. A push replaced the instance, and both
sessions died with the process that held them — the same failure, reproduced on
purpose.

## Acceptance

- [x] `npm run typecheck` and `npm run lint` clean
- [x] `npm test` — 91 tests passing
- [x] Verified against the compiled output (`node dist/server.js`, which is what
      `npm run start` runs on Render): a request to `/healthz` prints
      `GET /healthz` to stdout, where Render picks it up
