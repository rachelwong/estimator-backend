# Feature — Session description

> **Status: pending.** Nothing below is built yet. Remove this note once it ships
> and the doc has been re-checked against the code.

The admin can add an optional description when creating a session: the ticket
or task being estimated. Everyone in the session can see it, before and after
the reveal.

Frontend side: `estimator-frontend/docs/features/session-description.md`.

## Decisions taken

Don't re-open these while implementing.

- **Optional.** If it's left out, blank, or only whitespace, it's stored as `null`.
- **One line of plain text and links.** The server trims the ends and collapses
  any run of whitespace (spaces, tabs, line breaks) to one space. A real client
  never sends a line break. This only stops a hand-made request from storing one.
- **Up to 500 characters**, counted after that clean-up. Both sides use JS
  string `.length`, so the frontend's count matches the server's.
- **Fixed at creation.** There is no endpoint or socket event to edit it.
- **REST only.** `POST /sessions` takes it. `POST /sessions` and
  `GET /sessions/:id` return it. The socket protocol does not change, and
  `session-info` does not carry it. Every frontend page that shows it already
  loads `GET /sessions/:id`.
- **Public.** It's session info, like the point system. Anyone with the link
  can read it. The "votes stay hidden until reveal" rule is not affected.
- **New error code `INVALID_DESCRIPTION` (400)** for a description over 500
  characters. A non-string value is still `INVALID_REQUEST`, caught by Zod.
- **The error message states the rule only:**
  `description must be at most 500 characters`. It never repeats the text that
  was sent. `errorHandler` logs every `AppError` message, so echoing the input
  would put user text in the server logs.
- **Plain text on the wire, no HTML sanitising on the server.** Beyond the
  whitespace clean-up, the server stores the text as sent. It goes out as JSON,
  never as HTML. The frontend makes it safe when it renders it: React escapes
  text, only `http(s)` URLs become links, and a CSP backs that up (see the
  frontend doc). Stripping HTML here would mangle real text like `a < b`.

## API changes

### `POST /sessions`

Request, with the new optional field:

```json
{
  "adminName": "Ada",
  "pointSystemType": "numerical",
  "sliderMax": 4,
  "description": "PROJ-12 Add login https://example.com/browse/PROJ-12"
}
```

The response gains `description: string | null`, the stored (cleaned-up) value.

### `GET /sessions/:id`

The response gains `description: string | null` for both open and ended
sessions.

### Errors

| Case | Response |
| ---- | -------- |
| `description` is not a string (e.g. `123`) | 400 `INVALID_REQUEST` |
| `description` is over 500 characters after clean-up | 400 `INVALID_DESCRIPTION` |

## Changes

The rule lives in domain code. The route only passes the value through
(see "Domain purity" in `CLAUDE.md`).

| File | Change |
| ---- | ------ |
| `src/errors.ts` | Add `InvalidDescription: 'INVALID_DESCRIPTION'` and `400` in `ERROR_HTTP_STATUS`. |
| `src/utils/patterns.ts` | Add `WHITESPACE_RUN_PATTERN = /\s+/g`: any run of spaces, tabs or line breaks. |
| `src/utils/validation.ts` | Add `MAX_DESCRIPTION_LENGTH = 500` and `normalizeDescription(raw?: string): string \| null`. Trims, collapses whitespace runs to one space, returns `null` when empty, throws `AppError(InvalidDescription)` when too long. |
| `src/types.ts` | Add `description: string \| null` to `SessionState`. |
| `src/sessionStore.ts` | Add `description?: string` to `CreateSessionInput`. `createSession` calls `normalizeDescription` before generating ids, as it does for the name. |
| `src/schemas.ts` | `CreateSessionRequestSchema`: `description: z.string().optional()`. `CreateSessionResponseSchema` and `GetSessionResponseSchema`: `description: z.string().nullable()`. |
| `src/routes/sessions.ts` | Add `description: session.description` to the POST and GET responses. |

## Tests

Follow the `test-conventions` skill: assert the exact error code, use literal
expected values, and pair each rejection with its boundary acceptance.

`tests/sessionStore.test.ts`

- Stores the trimmed text.
- Omitted → `null`.
- `"   "` → `null`.
- Collapses whitespace runs: `"a \n\t b"` becomes `"a b"`.
- Exactly 500 characters is accepted.
- 501 characters throws `INVALID_DESCRIPTION`.
- 500 characters with spaces around them is accepted, because the count is
  taken after clean-up.

`tests/sessions.test.ts`

- POST with a description returns it.
- POST without one returns `description: null`.
- `description: 123` → 400 `INVALID_REQUEST`.
- 501 characters → 400 `INVALID_DESCRIPTION`. The `message` is exactly
  `description must be at most 500 characters` and doesn't contain the text
  that was sent.
- GET returns the description for an open session and for an ended one.
- The existing strict response-schema checks still pass with the new field.

`tests/handlers.test.ts` — no change. The field is optional, so existing
`createSession` calls still compile, and the socket payloads are unchanged.

## Docs to update when it ships

- `estimator-plan.md`: add the field to the API section and record it as a new
  numbered decision.
- `docs/features/sessions-explained.md`: one line saying a session can carry a
  description.
- Remove the "pending" note at the top of this file.

## Verification

- `npm test`, `npm run lint` and `npm run build` pass.
- By hand:

  ```sh
  curl -s -X POST localhost:3001/sessions \
    -H 'content-type: application/json' \
    -d '{"adminName":"Ada","pointSystemType":"numerical","sliderMax":4,"description":"PROJ-1 https://x.io"}'
  ```

  The response includes the description. `GET /sessions/<id>` returns it too.
