# Feature — Multiple CORS Origins

Let one backend (`https://estimator-backend-1nf2.onrender.com`) serve two
separate Vercel frontends:

- `https://estimator-frontend-ashen.vercel.app`
- `https://fold-and-flip.vercel.app`

## The problem

`CORS_ORIGIN` is read as a single string (`src/config.ts`) and handed as-is to
both `cors()` (`src/app.ts`) and Socket.IO (`src/ws/ioServer.ts`). Both echo a
string origin verbatim into `Access-Control-Allow-Origin`. Setting

```
CORS_ORIGIN=https://fold-and-flip.vercel.app,https://estimator-frontend-ashen.vercel.app
```

against today's code sends that whole comma-separated string as the header,
which no browser accepts — **both** frontends would break. Both libraries
accept an array of origins instead: they match the request's `Origin` against
the list and reflect only the one that matched. So the fix is to parse the env
var into a list.

## Order of work

The code change is backward-compatible (a single origin parses to a one-element
list), so it ships first, while `CORS_ORIGIN` still holds the current value.
Only after it is live does the Render env var change.

1. Code change → merge → deploy (Render env unchanged)
2. Update `CORS_ORIGIN` on Render
3. Point fold-and-flip at the backend and redeploy it
4. Verify

Setting the two-origin value **before** step 1 is live breaks both frontends.

---

## 1. Code change (this repo)

### `src/config.ts`

- `corsOrigin: string` → `corsOrigins: string[]`.
- Split `CORS_ORIGIN` on commas, trim each entry, drop empties.
- In production, run each existing check **per entry**:
  - list must be non-empty
  - no trailing slash
  - not `LOCAL_DEV_CORS_ORIGIN`
- Also reject, in production:
  - `*` (would open the API to every site)
  - anything not starting with `https://` (a typo here fails silently in the
    browser, not at boot)

### `src/utils/patterns.ts`

- The comma-split regex (e.g. `/\s*,\s*/`) goes here, not inline, per the
  repo convention that every production regex lives in this file.

### `src/app.ts` and `src/ws/ioServer.ts`

- Pass `config.corsOrigins` as `origin`. No other change — `cors` and
  Socket.IO both handle arrays natively, including for the WebSocket upgrade.

### Tests

- `tests/config.test.ts`:
  - two origins parse to a two-element array
  - whitespace around the comma is trimmed
  - a single origin still parses (backward compatibility)
  - one bad entry in an otherwise valid list throws (trailing slash,
    localhost default, `*`, non-`https`) — isolate each check
  - trailing/empty entries (`a,,b`, `a,`) are dropped, and an all-empty value
    still throws in production
- Rename `corsOrigin` → `corsOrigins` in the `testConfig` objects in
  `tests/handlers.test.ts`, `tests/server.test.ts`, `tests/sessions.test.ts`.
- New wiring test (in `server.test.ts` or `sessions.test.ts`): with two
  configured origins, a request from each gets its own origin back in
  `Access-Control-Allow-Origin`, and an unlisted origin gets no header.

### Docs

- `render.yaml`: `CORS_ORIGIN` comment → comma-separated list of exact origins.
- `DEPLOYMENT.md`:
  - env table (line ~262): "Exact match" → comma-separated exact matches
  - preview-builds gotcha (line ~301) and "New frontend URL" note (line ~327):
    mention both frontends
  - "Protocol changes" note: the contract now has two consumers
- `.env.example` stays a single localhost origin (the config test pins it).

---

## 2. Render

Dashboard → `estimator-backend-1nf2` → Environment. The service is manual, not
a Blueprint, so `render.yaml` has no effect here.

```
CORS_ORIGIN=https://fold-and-flip.vercel.app,https://estimator-frontend-ashen.vercel.app
```

- Exact origins: `https`, no trailing slash, no path.
- Saving restarts the service, which wipes every in-memory session. Do it when
  nobody is mid-session.

---

## 3. fold-and-flip (Vercel)

Production env vars — mirror whatever estimator-frontend-ashen uses:

```
VITE_API_BASE_URL=https://estimator-backend-1nf2.onrender.com
```

- If there's a separate socket URL var, use the same `https://` URL;
  Socket.IO upgrades to `wss://` itself.
- No trailing slash.
- Redeploy after saving — Vite bakes these in at build time.
- Turn off Vercel Deployment Protection for Production, or share links send
  recipients to a Vercel login.

---

## 4. Verify

```sh
curl -i -H "Origin: https://fold-and-flip.vercel.app" \
  https://estimator-backend-1nf2.onrender.com/healthz
curl -i -H "Origin: https://estimator-frontend-ashen.vercel.app" \
  https://estimator-backend-1nf2.onrender.com/healthz
curl -i -H "Origin: https://evil.example" \
  https://estimator-backend-1nf2.onrender.com/healthz
```

The first two each reflect their own origin in `Access-Control-Allow-Origin`;
the third has no such header.

Then, in a private window on each site: create a session, join it, and confirm
in DevTools → Network → WS that the socket connects over `wss://` with no CORS
errors.

---

## Side effects of sharing one backend

- **Shared session store.** Both frontends read and write the same in-memory
  `Map`. A session created on one can be joined from the other given its ID,
  and every deploy or restart wipes sessions for both.
- **One protocol, two consumers.** fold-and-flip must speak the same REST and
  socket events as `src/types.ts`. Contract changes now need coordinating
  across both frontends.
- **No change to free hours.** Still one service, so the existing 10-minute
  `/healthz` keep-alive covers it.
- **Vercel preview deployments stay blocked by CORS**, as today. Allowing them
  would need pattern-based origin matching — out of scope.
