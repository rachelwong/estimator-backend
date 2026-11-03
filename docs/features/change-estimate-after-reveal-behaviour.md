# Feature — Change an estimate after the reveal: rules and behaviour

What this feature does, who can do what, and what everyone sees. No code here.
How it's built and deployed is in
[change-estimate-after-reveal.md](change-estimate-after-reveal.md).

Status: backend built, frontend not started.

## In one line

After the admin ends a session, people who took part can still move their
estimate on the Reveal. Everyone looking at the Reveal sees the change
straight away, with a short flash on the squares that changed.

## Why

A discussion often starts once the votes are revealed. People change their
mind. Today the only way to record that is to start a new session. This lets
the group settle on a final answer in the session they already have.

## Words used here

- **Session** — one round of estimating one ticket or task.
- **Admin** — the person who created the session. Only they can end it.
- **Participant** — anyone who joined by name with the share link.
- **Estimate** — the one square a person has picked on the grid. A person
  can also have none.
- **Reveal** — the screen everyone sees after the admin ends the session. It
  shows every estimate with names.
- **Abstained** — took part, but holds no estimate.
- **Watcher** — someone who opens the share link after the session has ended.
  They never joined.

## Before the end: nothing changes

- Estimates stay hidden until the admin ends the session. This is still the
  product's core rule.
- Nobody sees who has voted, or how many people have joined.
- Each person sees only their own estimate.

## After the end: who can do what

| Person | Sees the Reveal | Sees changes live | Can change their estimate |
| --- | --- | --- | --- |
| Admin | Yes | Yes | Yes, always — even after reloading the page or opening a new tab |
| Participant, page still open since the end | Yes | Yes | Yes |
| Participant who reloaded or closed the page | Yes | Yes | No |
| Watcher | Yes | Yes | No |
| Anyone whose connection dropped | Yes, as it last looked | No | No |

- **Nobody new can join an ended session.** A watcher can look, but can't
  add an estimate.
- **A participant can't get back in after reloading.** The app has no
  accounts and doesn't remember who someone was. Their estimate still counts
  and still shows. They just can't change it any more.
- **The admin is recognised on any tab** by the browser that created the
  session. All their tabs are the same person, and they all stay in step.

## Changing an estimate on the Reveal

It works the same as before the end:

- **Click another square** to move your estimate there.
- **Click your own square** to clear it. You move to Abstained.
- **Click a square while Abstained** to pick one again.
- No new buttons. The Reveal looks the same apart from the changes below.

Your own square stays highlighted as "your square" and follows your changes.

### Clicking a square: voters vs watchers

On the Reveal, a click on a square used to open a small box listing everyone
on that square. Now:

- **For someone who can vote:**
  - clicking a square moves their estimate
  - hovering over a square does what clicking used to: the names box opens
    while the mouse is over the square, and closes when it leaves. The box
    is the same as before
  - they can also click a name in "Who landed where" below the grid, which
    opens the same box
  - on a phone or tablet there's no hover. They see names written inside
    each square, or tap a name below the grid
- **For someone who can't vote,** clicking a square opens the box, as today.
- Any prompt for voters says "hover", never "click for names".

## What everyone else sees

- Every change shows up on every open Reveal straight away. That includes the
  admin, other participants, and watchers. No reload needed.
- Names move between squares, and in and out of Abstained.
- The opening reveal animation plays once, when the Reveal first appears.
  It doesn't replay on each change.
- Anyone who opens or reloads the Reveal later sees the latest estimates.

## Showing a change: a short flash

There is no lasting "changed" mark. An estimate can change again at any time,
so a permanent mark wouldn't mean much. Instead, a change is shown as it
happens:

- The square someone has just moved to — their new estimate — gets a
  rolling animated rainbow gradient border. It plays once, briefly, then the
  square looks normal again.
- It only appears when someone makes a new estimate that's different from
  their previous one.
- Which squares flash:
  - **Someone moves:** only the square they joined. The one they left
    doesn't flash.
  - **Someone picks a square from Abstained:** the square they joined.
  - **Someone clears their estimate:** nothing flashes. Their name moves to
    Abstained.
- Everyone else sees it: the admin, other participants and watchers. The
  person who made the change doesn't see it on their own screen, in any of
  their tabs.
- Nothing flashes when the Reveal first loads, or after a reload.
- If a square changes again while flashing, its flash starts over.
- Only grid squares flash. The names under the grid don't.
- The order of names under the grid doesn't mean anything. Each name is
  linked to its square, and after a change a name may sit in a different
  place in the row. Someone who clears their estimate moves to the Abstained
  row.
- People who turn off animations in their browser or device see a static
  rainbow gradient border instead. It doesn't move, and it still only shows
  briefly.
- Nothing records who changed or what their estimate was before. Someone who
  looks away during a flash simply sees the current estimates.

## How long a session lasts

- **Open session:** deleted 1.5 hours after anyone last created, joined,
  opened or voted in it. Unchanged.
- **Ended session:** deleted 1 hour after the later of:
  - when the admin ended it
  - the last estimate change after the end
- Only a change counts. Opening or reloading the Reveal does not keep an
  ended session alive.
- So a group still talking and adjusting keeps the session alive. Once
  everyone stops, it's gone an hour later.
- A deleted session reads as "not found", the same as a link that never
  existed.
- A server restart or deploy still wipes every session, ended or not.

## Wording on the site

These change when the feature goes live.

**Reveal notice**, at the top of the Reveal:

> **All estimates are now revealed!**
>
> Explore the grid to see how everyone estimated, click anywhere on the grid
> to change your estimate again. Latecomers to this session can see the
> estimates but they can't add their vote.

Everyone sees the same notice, including latecomers. The Welcome page's demo
Reveal can't vote, so it gets its own text: "Hover over the grid to see how everyone
estimated."

**Welcome page → How to use → "Talk it through":**

> Talk through everyone's estimates, ask hard questions to flag uncertainties
> and dependencies. The best thing is the team can change their estimates!

**Welcome page → House rules → "Change your mind":**

> Admin and users can change their estimates any time. Once a session has
> been revealed though, no latecomers can join the session to add their
> estimates

**Reveal, when live updates stop** — a small note on the Reveal, not a
full-page error. The estimates stay on screen as they last were.

> Live updates have stopped. Reload to see the latest estimates.
>
> [Try again]

## Edge cases

- **Clicking just as the admin ends the session.** Used to show an error and
  drop the click. Now the click counts. It shows on the Reveal like any other
  change, and its new square flashes for everyone else.
- **The admin ends the session twice** (double-click, or two tabs). Still
  harmless. Nothing happens the second time.
- **Two admin tabs clicking different squares.** The last click wins. Both
  tabs show the result.
- **Connection drops on the Reveal.** The Reveal stays on screen as it last
  looked, with the "live updates have stopped" note and a "Try again"
  button. That person can't vote, and doesn't see new changes until they try
  again.
  - The admin gets everything back: live updates and voting.
  - A participant gets live updates back, but not voting. They're now a
    watcher.
- **The server restarts, or the session expires, while the Reveal is open.**
  Same note and button. "Try again" shows "not found", because the session
  is gone.
- **A participant who reloaded before the end** joined again under a new
  name (e.g. `Jim-1`). Their old estimate still counts under the old name,
  and nobody can change it. Unchanged from today.
- **Everyone clears their estimate.** The Reveal shows everyone in Abstained.
  Allowed.
- **A clicked square that isn't on the grid** (only possible by tampering).
  Rejected. Nothing changes.

## Not part of this feature

- No way to re-open voting with estimates hidden again.
- No way for the admin to lock the Reveal so no more changes can be made.
- No history of what someone's estimate was before.
- No joining an ended session.
- The prototype site (`estimator-frontend-ashen.vercel.app`) doesn't get
  this. It keeps today's read-only Reveal.

## Still to decide

Nothing. Exact flash length is picked while building.