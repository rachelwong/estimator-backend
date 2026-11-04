---
name: ship
description: Rachel's pre-push workflow for every fix or feature on Estimator (estimator-backend + estimator-frontend, both frontend branches) — plan, build, user-level tests, run the whole app locally and root-cause any bugs, every check green, decisions and docs (markdown, Notion, Miro, design boards) in sync, no commits. Run only when Rachel types /ship.
argument-hint: <describe the fix or feature>
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: 'Bash'
      hooks:
        - type: command
          command: '"$CLAUDE_PROJECT_DIR"/.claude/skills/ship/hooks/block-commit.sh'
  Stop:
    - hooks:
        - type: command
          command: '"$CLAUDE_PROJECT_DIR"/.claude/skills/ship/hooks/check-before-stop.sh'
          timeout: 300
---

The change: $ARGUMENTS

Rachel runs this before every push to production. When it's done:

- the app works end to end, run locally
- every regression test passes
- the decisions are recorded
- the docs and external sources (markdown, Notion, Miro, design boards) match the code

Work through every step, in order. This file is mirrored in both repos. Edit one, copy it to the other.

## The project

- One fullstack app in two sibling repos: `../estimator-backend` and `../estimator-frontend`.
- The frontend has two branches, and both get every fix and feature:
  - `release/design`: production. The same functions as `master`, plus the design UI. Real users use this one.
  - `master`: the functional prototype (POC). Functions only, plainer UI, and its copy may differ. Not for real users.
- `estimator-plan.md` is the high-level source of truth. Every copy must be identical: backend, frontend `release/design`, frontend `master`.

## 1. Understand and plan

- In the frontend, run `git branch --show-current`. It should be `release/design`. If not, ask before editing.
- Make sure `master` is checked out in a worktree at `../estimator-frontend-master`. If it isn't: `git -C ../estimator-frontend worktree add ../estimator-frontend-master master`.
- Restate the change in one or two sentences.
- Read the decisions in `estimator-plan.md` that the change touches. If it reverses one, stop and ask before going further.
- Note if the change alters the REST or socket contract (`src/ws/events.ts`, `src/ws/schemas.ts`, `src/routes/`, the frontend's `src/types`). A contract change needs the backend and both frontend branches updated.
- Write a short plan: what changes, in which repo and branch, and which user-facing behaviour it affects.

## 2. Build

- Follow `CLAUDE.md` and every skill in `.claude/skills/` of the repo being edited. The frontend also has `agent.md`.
- Keep domain logic out of routes and socket handlers (see `CLAUDE.md`).
- Frontend: build it on `release/design` first, then make the same functional change on `master` in `../estimator-frontend-master`.
  - Match `master`'s plainer UI and its own copy. Don't bring design UI over.
  - The behaviour must be the same on both branches.

## 3. Tests, from a user's point of view

- Write each test as something a person does and sees. Name it that way: "a participant who joins after the reveal can't vote", not "selectSquare throws SESSION_ENDED".
- Prefer end-to-end and integration tests:
  - Backend: drive the real HTTP server (`supertest`) and real socket clients, like `tests/sessions.test.ts` and `tests/handlers.test.ts`.
  - Frontend: add or extend a Playwright scenario in `scripts/smoke/scenarios/`, on both branches.
- Don't test internals: no checks on private helpers, state shape, or which function was called.
- List the edge cases a real user could hit, then cover each one. Start with:
  - admin and participant in different browsers; the same person in two tabs
  - joining, voting or refreshing before, during and after the reveal
  - an expired or unknown session link
  - empty, too-long, duplicate or odd input (spaces, emoji, case)
  - slow or dropped connection, Render cold start
- If the change affects a flow in `docs/testing/testrigor-e2e-test-cases.md`, update that case or add one.

## 4. Run everything, and fix what breaks

### Automated checks

- Backend: `npm run typecheck`, `npm run lint`, `npm test`, `npx prettier --check` on changed files.
- Frontend, both branches: `npx tsc -b`, `npm run lint`.
- The stop hook re-runs these when you try to finish, and blocks until they pass.

### The whole app, locally

- Start the backend on :3001 and the frontend on :5173.
- Run `npm run smoke` in the frontend.
- Click through every flow the change touches as a real user would, in separate browsers for admin and participant.
- Do this for `release/design`, then again for `master`. Only one frontend can use :5173, so stop one before starting the other.
- Stop any server you started when you're done.

### When something breaks

- Find the root cause before changing code. Use the `superpowers:systematic-debugging` skill.
- Fix the cause, not the symptom. Check whether the same cause affects the other branch or the other repo.
- Add a regression test from the user's point of view. It must fail before the fix and pass after.
- Re-run everything above.
- In the hand-over, say what broke, the root cause, and the fix.
- If you can't fix it, say so with the output. Never report a failing check as passing.

## 5. Update the docs in place

- Write the docs as if things always worked this way. No "updated on", "previously", "now changed", or changelog sections.
- Short plain sentences or bullets.
- The repos' docs drift. Check all three checkouts, even if the code change is in only one: `CLAUDE.md`, `README.md`, `PLAN.md`, `DEPLOYMENT.md`, `docs/`, the frontend's `CONTEXT.md` and `DESIGN.md`.
- Fix every doc the change makes out of date, including drift you find on the topic.
- Add a `docs/features/<name>.md` for a new feature, matching the existing ones.
- `estimator-plan.md`:
  - Record every decision the change makes or alters.
  - Any behaviour that touches both frontend and backend means a change to it.
  - Edit one copy, then copy it over the others so all are identical. The stop hook checks this.
  - Keep it high level. Detail goes in `docs/features/`.

## 6. Update the external sources and design boards

Keep these current too, not just the markdown. Same in-place rule as the docs.

### External sources

- The sources Rachel provided are listed at the top of `estimator-plan.md`. Today that's:
  - Notion spec: https://app.notion.com/p/rachelwong/Estimator-3bb375d34b3480548d26edd98dcc8a11 (use the Notion tools)
  - Miro wireframes: https://miro.com/app/board/uXjVH-RcLGw=/ (use the Miro tools)
- Notion: edit the affected part of the spec in place.
- Miro: update the affected screen when the UI changes. If a change is too big to redraw cleanly, leave a comment on that screen describing it instead, and tell Rachel.
- If Rachel adds a new source, add it to the list in `estimator-plan.md`.

### Design boards

There are two claude.ai design canvases. Only one gets updated here.

- **Built Designs**: https://claude.ai/artifact/3WDhzpesHMgzy5Efs8b9qG. Update it.
  - It shows every screen as built on `release/design`: desktop, tablet and mobile, one screenshot per artboard.
  - When a screen's look changes, retake it with `node .claude/skills/ship/capture-screens.mjs <scratch-dir>`. It needs both dev servers up, on `release/design`.
  - Upload the new screenshot with `upload_asset`, then point that artboard's `<img src>` at it with `edit_version`. Call `list_files` first.
  - A new screen gets a new artboard and a `boards` entry in `project/canvas.json`, in its row.
- **Design Options**: https://claude.ai/artifact/B8xUuTAY1pmHCQcMD5FKRc. Don't change it in `/ship`.
  - Rachel and Claude use it to explore options and pick what to build. It's shared publicly.

Also in the frontend:

- `DESIGN.md`: the visual spec. Keep it matching what's built.
- `public/*.png`: the README screenshots. Retake any screen whose look changed, at the same size as the current file.

If a tool needs authorising or fails, or an artefact can't be updated cleanly, say so in the hand-over. Don't skip it silently.

## 7. Save feedback

- If Rachel corrects code quality during this change, save the rule so it applies next time:
  - a rule about the code → add it to the matching skill in `.claude/skills/` of the repo it applies to, or create a new skill
  - a personal preference about how to work → save it to memory
- Say what you saved and where.

## 8. Hand over

- Never commit or push. The hook blocks it.
- Summarise, per repo and frontend branch:
  - what changed
  - the tests added, in plain words
  - the checks run and their results
  - bugs found while running the app: root cause and fix
  - the decisions and docs updated
  - the Notion, Miro and Built Designs changes, or why there were none
  - feedback saved, if any
