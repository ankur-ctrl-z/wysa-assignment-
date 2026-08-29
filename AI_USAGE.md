# AI Usage

> Written from the actual session that produced this repo. Please read it through
> and adjust anything that does not match how you would describe your own process
> before submitting — the sections below record what happened, not what should
> have happened.

---

## 1. Tools used

| Tool | Used for |
|---|---|
| **Claude Code** (Claude Opus 5, CLI) | The whole implementation: schema, backend, frontend, tests, Docker, docs. Run against a live workspace, so it could execute `npm`, `prisma`, `docker` and `curl` and read the results rather than guessing. |

No other AI tools were used. Everything below was produced in a single session
with the assignment PDF read directly as input.

---

## 2. Prompts given

**Opening prompt** (verbatim):

```
React for frontend
Node + express for back-end
Prisma + PostgreSQL for database
Docker for containerization

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"

Please create this based on the above tech stack. Refer the PDF and create it
properly make it modular.
```

**Two clarifying decisions** answered mid-plan:

- *JavaScript or TypeScript for the backend?* → **TypeScript**
- *What should the React frontend do?* → **Player + flow admin UI** (rather than
  player-only or a raw JSON debug page)

**Follow-ups during implementation** were corrections and verification requests
rather than new instructions — see sections 4 and 5.

The assignment PDF was supplied as a file and read in full, not summarised into
the prompt.

---

## 3. What was changed from the AI's output

These are the substantive departures from what was first produced:

**Deleted a whole middleware layer.** A `src/lib/validate.ts` with
`validateBody` / `validateQuery` middleware was written first. It needed an
awkward `req.validatedQuery` side-channel to satisfy TypeScript. It was deleted
and replaced by handling `ZodError` once in the error handler, so handlers just
call `schema.parse(req.body)`. Net: one fewer file, one fewer concept, identical
behaviour.

**Split the pure rules out of the service.** The flow logic was initially heading
into `flow.service.ts` alongside the Prisma calls. It was pulled into
`flow.rules.ts` with structural types (`RuleQuestion`, `RuleModuleState`) instead
of Prisma types, so the entire edge-case matrix could be tested without a
database. `flow.service.ts` now makes no decisions of its own. This is the single
change that most affected the shape of the codebase.

**Changed the module-switch semantics.** The first design set `completedAt` on the
source module when an option jumped elsewhere. That is a lie — the user *left*, they
did not *finish*. It now clears `currentQuestionId` and leaves `completedAt` null,
and `start` treats "left mid-flow" and "finished" as the same restart case.

**Moved `contextResetSeq` onto module entry too.** Originally only checkpoints
moved the watermark. Entering a module from another one now moves it as well,
which is what prevents `back` from walking out of the module the user just
switched into. This was found by writing the "switch back and forth twice" test.

**Moved the seed file.** It was written to `prisma/seed.ts`, which silently breaks
the production Docker image: `tsx` is a devDependency and is not present in the
runtime stage. Moved to `src/seed.ts` so `tsc` compiles it and the container runs
`node dist/seed.js`.

**Changed `onDelete` on `Option.nextQuestion` to `Restrict`.** `SetNull` was the
first choice, but it makes a deleted target indistinguishable from a legitimately
terminal option. `Restrict` means an author gets a 409 naming the referencing
options instead of silently corrupting the flow.

---

## 4. What the AI got wrong

**The `back` algorithm was wrong on the second press.** The first version set the
current question to "the question in the last `ANSWERED` event". That works once,
then sticks: pressing back again finds the same event and goes nowhere, because
history is append-only and nothing was removed. Fixed by replaying the module's
live events as a stack — `ANSWERED` pushes, `BACK` pops — which also made
"answer again after going back" behave correctly. There are three tests covering
exactly this in `tests/rules.test.ts`.

**A test asserted the wrong error code.** The e2e test for `STALE_QUESTION` passed
an option belonging to a *different* question, so `OPTION_MISMATCH` fired first
and the test failed with 400 instead of 409. The engine was right and the test was
wrong — the fix was to look up a real option of the stale question. Worth noting
because the failure looked at first glance like a backend bug.

**A TypeScript error revealed a modelling slip.** `decideAnswer` typed its
`currentQuestion` parameter as `RuleQuestion`, but the service passes the full
`QuestionView` (which nests `module.id` rather than a flat `moduleId`). The
compiler caught it. Rather than reshaping the object, the parameter became
generic, because the rules never read that value — they only attach it to the
error so a stale client can re-render itself. The type was claiming more than the
code needed.

**Docker Desktop was not running** when the first `docker compose up` was
attempted, and the failure was reported as an image-pull error rather than a
daemon-not-running error. Not the AI's mistake, but it needed diagnosing rather
than retrying.

**General pattern:** the AI was consistently good at breadth (every endpoint, every
error code, consistent structure) and needed checking on stateful sequences —
anything where the correct answer depends on what happened two steps earlier.
That is precisely where the tests were pointed.

---

## 5. How correctness was verified

**Nothing was accepted as working because it looked right.** Every claim below was
executed.

**Pure rule tests — 31 assertions, no database** (`npm run test:rules`).
The whole matrix as plain function calls: every `decideAnswer` guard in order,
`back` across a checkpoint and across repeated presses, all eight deep-link
resolution reasons, and every `start` case. These run in under a second, which is
why the rules were made database-free in the first place.

**End-to-end test — 18 cases against real Postgres** (`npm test`).
One walk through the seeded flow that exercises the assignment's requirements in
sequence: start → advance → back → switch to another module → return to a
previously visited module → reach a checkpoint → back is refused at the boundary →
an old deep link resolves to the current question → a stale answer returns 409
with the live question → a mismatched option is rejected → unknown ids give 404
not 500 → a terminal option completes the module → restarting gives a fresh
context. Plus a second test that loops between two modules twice and asserts state
still agrees with the last response.

**Full stack, actually run.** `docker compose up --build` was executed; migrations
and seed ran in the container, `GET /api/health` answered through the nginx proxy,
and `/admin` served the SPA (200).

**Admin API smoke-tested with `curl`.** Create module → validate (correctly
reports `NO_ENTRY_QUESTION`) → add question → add an option pointing into another
module → validate again (correctly reports it as a `MODULE_SWITCH`) → attempt to
delete a question three options point at (correctly refused, 409, with all three
referencing options named) → reject a malformed module key → delete.

**Type checking.** `tsc --noEmit` on the backend and `tsc -b` on the frontend both
clean, and both production Docker images build.

**What is not covered:** concurrent answers from the same user (the `seq` race is
documented as a known limit in the README rather than solved), and there are no
frontend tests — the UI was verified by running it, not by assertion.
