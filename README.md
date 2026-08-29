# Modular Conversation Flow System
 
A backend (plus a React client) that drives a question-based conversation across
multiple modules: users answer questions, options decide what comes next, some
options jump to a different module, and some questions act as checkpoints that
reset the module's context without touching history.

**Stack:** React + Vite · Node + Express · Prisma + PostgreSQL · Docker · TypeScript

---

## Quick start

### With Docker (everything, one command)

```bash
docker compose up --build
```

| | |
|---|---|
| Player UI | <http://localhost:5173> |
| Admin UI | <http://localhost:5173/admin> |
| API | <http://localhost:3000/api> |
| Postgres | `localhost:5432` (postgres/postgres) |

Migrations and the seed run automatically on backend start. The seed is a no-op
if content already exists.

### Locally (backend outside Docker)

```bash
docker compose up -d db          # just Postgres, on the port the .env expects

cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run dev                      # http://localhost:3000

cd ../frontend
npm install
npm run dev                      # http://localhost:5173, proxies /api to :3000
```

`backend/.env` ships with the connection string as given:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
```

Inside Docker Compose the host becomes `db` instead of `localhost`; that is the
only difference, and it is set in `docker-compose.yml`.

### Tests

```bash
cd backend
npm run test:rules   # pure decision logic, no database needed
npm test             # the above + a full end-to-end walk (needs the db running + seeded)
```

52 tests. The e2e walks cover module switching, returning to a visited module,
checkpoints, deep chains, stale deep links, back, user deletion, and every
defensive case below.

---

## The design in one idea

> **History is append-only and is never rewritten. State is a small mutable
> pointer. A checkpoint moves a watermark over the history; it deletes nothing.**

Three concerns, kept apart on purpose:

| Concern | Tables | Mutability |
|---|---|---|
| **Content** — what the flow looks like | `Module`, `Question`, `Option` | edited by authors |
| **History** — what the user did | `ConversationEvent` | **append-only**, never updated or deleted |
| **State** — where the user is | `User`, `UserModuleState` | small, mutable, derived |

### History

`ConversationEvent` has a per-user gapless `seq` that totally orders everything
the user has ever done, across all modules. Each row snapshots `questionText`,
`moduleTitle` and `optionLabel`, so history stays readable even after an author
edits or deletes the question it refers to. Nothing in the codebase updates or
deletes a row in this table — `appendEvent()` is the only writer.

Event kinds: `PRESENTED`, `ANSWERED`, `CHECKPOINT`, `MODULE_SWITCH`, `BACK`,
`COMPLETED`.

### State

`UserModuleState` is one row per (user, module):

- `currentQuestionId` — where the user is parked, `null` if they left or finished
- `contextResetSeq` — **the checkpoint watermark**
- `completedAt` — set only by a terminal option

`User.currentModuleId` records which module is active right now.

### Checkpoints

Landing on a question with `isCheckpoint = true` sets
`contextResetSeq = <seq of that arrival>`. From then on, **only events with
`seq > contextResetSeq` count as live context for that module.** Everything
before it is still in the history table, still returned by `GET /history`, and
still rendered by the UI — just marked `isLiveContext: false`.

That single number is what makes "previous context must not affect future flow"
enforceable rather than aspirational: `back` cannot cross it, and a deep link
from before it resolves as `STALE_CHECKPOINT`.

### Module switching

An `Option.nextQuestionId` can point at **any** question, so a cross-module jump
needs no special modelling — the target simply has a different `moduleId`. On a
switch, in one transaction:

- `ANSWERED` + `MODULE_SWITCH` events are appended
- the source module's `currentQuestionId` is cleared (they *left*; `completedAt`
  stays null because they did not finish)
- the target module's state is upserted to the option's target, and its
  `contextResetSeq` moves to the switch — entering a module from outside is a
  fresh context for that module, which is what stops `back` walking out of the
  module the user is currently in, however many times they switch

Returning to a module later resumes it if they were parked mid-flow, and
restarts it from the entry question if they had left or completed it.

---

## API

Errors are always `{ "error": { "code", "message", ...context } }`. Clients branch
on `code`; `context` carries whatever is needed to recover.

### Flow

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/flow/:userId/start` | `{ moduleKey, restart? }` → `STARTED` \| `RESUMED` \| `RESTARTED` |
| `POST` | `/api/flow/:userId/answer` | `{ questionId, optionId }` → `ADVANCED` \| `MODULE_SWITCHED` \| `CHECKPOINT_REACHED` \| `MODULE_COMPLETED` |
| `POST` | `/api/flow/:userId/back` | bonus — one step back, within the module, since the checkpoint |
| `GET` | `/api/flow/:userId/resume?questionId=` | deep link / notification entry point |
| `GET` | `/api/flow/:userId/state` | current module + question, and state in every module touched |
| `GET` | `/api/flow/:userId/history?moduleKey=` | the complete history, never trimmed |

### Catalog (authoring)

| Method | Path |
|---|---|
| `GET` `POST` | `/api/modules` |
| `GET` `PATCH` `DELETE` | `/api/modules/:key` |
| `GET` | `/api/modules/:key/graph` — questions + options, for the admin UI |
| `GET` | `/api/modules/:key/validate` — missing entry, dead ends, unreachable questions |
| `POST` | `/api/questions` · `PATCH` `DELETE` `/api/questions/:id` |
| `POST` | `/api/options` · `PATCH` `DELETE` `/api/options/:id` |
| `GET` `POST` | `/api/users` |
| `DELETE` | `/api/users/:id` — also deletes all of that user's history and state |

### Deep links never dead-end

`GET /resume?questionId=X` **always returns 200**, with the best available
question and a `reason` explaining what happened:

| `reason` | Meaning |
|---|---|
| `EXACT` | the link is still valid |
| `CURRENT` | no question was requested; here is the live one |
| `SUPERSEDED` | valid question, but the user has moved on in that module |
| `STALE_CHECKPOINT` | the user has crossed a checkpoint since the link was made |
| `QUESTION_GONE` | the question was deleted |
| `MODULE_NOT_STARTED` | the user has never entered that module — its entry question is served |
| `MODULE_NOT_ACTIVE` | the user left or finished that module |
| `NO_ACTIVE_QUESTION` | nothing in progress at all |

`redirected: true` tells the client to say "that link is out of date".

### Defensive handling

Every guard has its own code, checked in this order:

| Situation | Response |
|---|---|
| unknown question | `404 QUESTION_NOT_FOUND` |
| unknown option | `404 OPTION_NOT_FOUND` |
| option belongs to another question | `400 OPTION_MISMATCH` |
| user has moved past that question (double submit, old tab, replayed link) | `409 STALE_QUESTION` **+ the live question in `error.currentQuestion`** |
| option points at a deleted question | `409 BROKEN_REFERENCE` — the user stays parked, not stranded |
| back at the start of a module | `400 NO_PREVIOUS_QUESTION` |
| back would cross a checkpoint | `400 CHECKPOINT_BOUNDARY` |
| module has no entry question | `400 MODULE_HAS_NO_ENTRY` |
| malformed body/query | `400 VALIDATION_ERROR` with the offending field |

Deleting a question that other options point to is refused with `409 CONFLICT`
listing the referencing options, so an author cannot create a dangling reference
in the first place — the `onDelete: Restrict` foreign key backs this up at the
database level.

---

## Layout

```
backend/
  prisma/schema.prisma          content / history / state, with the reasoning in comments
  src/seed.ts                   one declarative FLOW array — 6 modules, 50 questions
  src/lib/                      prisma client, ApiError + error handler
  src/routes.ts                 the only file that knows every module exists
  src/modules/
    users/                      routes
    catalog/                    authoring: routes + service (CRUD, graph, validation)
    flow/
      flow.rules.ts             PURE decision logic — no Prisma, no Express
      flow.service.ts           loads inputs, persists outcomes in transactions
      flow.routes.ts            HTTP + zod validation
  tests/rules.test.ts           the edge-case matrix as plain functions
  tests/flow.e2e.test.ts        one full walk against a real database
frontend/
  src/api/client.ts             typed fetch wrapper + endpoint map
  src/pages/PlayerPage.tsx      the conversation
  src/pages/AdminPage.tsx       flow authoring
  src/components/               question card, history panel, module list, admin editors
```

Each backend module owns its routes, service and schemas; adding a feature means
adding a folder under `src/modules` and one line in `routes.ts`.

**`flow.rules.ts` has no database in it on purpose.** Every rule the assignment
asks about is a pure function there, which is why the whole edge-case matrix can
be tested without spinning anything up, and why the service layer contains no
branching of its own.

---

## The seeded flow

Six modules, **50 questions**, seeded from one declarative `FLOW` array in
`backend/src/seed.ts`. A cross-module jump is just an option whose target
question happens to live in another module — there is nothing else to configure.

| key | title | questions | checkpoints |
|---|---|---|---|
| `new-pet-intake` | New Pet Intake | 9 | 2 |
| `symptom-triage` | Symptom Triage | 10 | 2 |
| `appointment` | Book an Appointment | 8 | 1 |
| `nutrition-plan` | Nutrition Plan | 8 | 1 |
| `meds-vaccines` | Medication & Vaccines | 7 | 1 |
| `support` | Support | 8 | 1 |

Shaped to exercise the assignment rather than to look full:

- **Chains up to 9 questions deep**, with real branching — `symptom-triage` forks
  on severity into a long urgent path and a short routine one, so two users
  answering the same first question travel different distances.
- **21 cross-module jumps** in both directions between every pair that makes
  sense, so switching modules repeatedly and returning to a previously visited
  module are both reachable by clicking.
- **8 checkpoints**, six of which have an option looping *back* across the
  checkpoint — which is what makes the watermark observable in the UI.
- Terminal options (`next: null`) in every module.

`GET /api/modules/:key/validate` reports all six as clean: no missing entry
questions, no dead ends, no unreachable questions.

Re-seeding is not automatic — the seed no-ops when content already exists:

```bash
cd backend && npm run seed -- --force     # or: docker compose down -v
```

---

## Trying the interesting parts

**Deep link going stale.** In the player, note the `question id` under the card
(it is also in the URL). Answer past a checkpoint ("Thanks — the basics are
saved"), then paste that old id into the *"Open an old deep link"* box. The API
serves your current question and the banner names the reason,
`STALE_CHECKPOINT`.

**Checkpoint vs history.** After crossing a checkpoint, press **Back** — refused
with `CHECKPOINT_BOUNDARY`. The history panel still shows every earlier answer,
dimmed and labelled *before checkpoint*: preserved, but no longer live context.

**A deep chain.** Start **Symptom Triage** and take the severe branch — *"They are
not eating or drinking"* → *"Since today"* → *"Severe - I am worried"* → *"No, none
of those"* → *"They feel hot, or seem very lethargic"*. Six distinct questions
before the checkpoint; the "mild" answer at the third step short-cuts to a
two-question ending instead.

**Module switching, repeatedly.** From "Welcome!" choose *"Actually, I need help
with something else"* → you are in Support. Work to its end and choose *"Register
another pet"* → back in New Pet Intake, where you started. The module list shows
your state in each. Twenty-one such jumps are seeded across the six modules.

**Deleting a user.** Answer a few questions, then **Delete user**. The user, their
entire history and their state in every module go in one cascade; the modules and
questions themselves are untouched, because content belongs to the flow rather
than to any user.

**Breaking things on purpose.** In the admin UI, delete a question other options
point at — refused, with the referencing options named. Point an option at a
question in another module — it becomes a module switch, no extra configuration.

---

## Deliberate limits

- **No auth.** A user is an id in the path. Everything user-scoped keys off it, so
  adding auth means resolving that id from a token and changing nothing else.
- **`seq` is `max(seq)+1` inside the transaction.** Two concurrent answers from the
  *same* user race into the `@@unique([userId, seq])` constraint and surface as a
  409 the client retries. A per-user advisory lock is the upgrade if that ever
  matters; it is marked with a `ponytail:` comment in `flow.service.ts`.
- **`back` is one step at a time**, by replaying the module's live events as a
  stack (`ANSWERED` pushes, `BACK` pops) rather than mutating history.
