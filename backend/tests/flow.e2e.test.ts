/**
 * End-to-end walks through the seeded pet-care flow, against a real Postgres and
 * the real Express app.
 *
 * Requires a running database and the seed data:
 *   docker compose up -d db && npm run prisma:deploy && npm run seed
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();

interface Option {
  id: string;
  label: string;
}
interface Question {
  id: string;
  text: string;
  isCheckpoint: boolean;
  module: { key: string };
  options: Option[];
}

/** Finds an option by the label the seed gave it. Fails loudly if the seed moved. */
function pick(question: Question | null, label: string): string {
  assert.ok(question, "expected to be on a question");
  const option = question.options.find((o) => o.label === label);
  assert.ok(
    option,
    `no option "${label}" on "${question.text}" (have: ${question.options.map((o) => o.label).join(" | ")})`,
  );
  return option.id;
}

/** A per-test user plus the flow endpoints bound to them. */
async function newUser(prefix: string) {
  const { body: user } = await request(app)
    .post("/api/users")
    .send({ name: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` })
    .expect(201);

  return {
    id: user.id as string,
    start: (moduleKey: string, restart = false) =>
      request(app).post(`/api/flow/${user.id}/start`).send({ moduleKey, restart }),
    answer: (questionId: string, optionId: string) =>
      request(app).post(`/api/flow/${user.id}/answer`).send({ questionId, optionId }),
    back: () => request(app).post(`/api/flow/${user.id}/back`),
    resume: (questionId?: string) =>
      request(app).get(`/api/flow/${user.id}/resume`).query(questionId ? { questionId } : {}),
    history: () => request(app).get(`/api/flow/${user.id}/history`),
    state: () => request(app).get(`/api/flow/${user.id}/state`),
  };
}

after(() => prisma.$disconnect());

// ---------------------------------------------------------------------------

test("a full conversation: switching modules, checkpoints, stale links, back", async (t) => {
  const flow = await newUser("e2e");

  // ---- start a module -----------------------------------------------------
  let res = await flow.start("new-pet-intake").expect(200);
  let q: Question = res.body.question;
  assert.equal(res.body.reason, "STARTED");
  assert.match(q.text, /^Welcome/);
  const intakeEntryId = q.id;

  // ---- advance, then step back (bonus) ------------------------------------
  res = await flow.answer(q.id, pick(q, "A dog")).expect(200);
  assert.equal(res.body.reason, "ADVANCED");
  assert.equal(res.body.question.text, "How old are they?");

  res = await flow.back().expect(200);
  assert.equal(res.body.reason, "WENT_BACK");
  assert.equal(res.body.question.id, intakeEntryId, "back returns to the previous question");
  q = res.body.question;

  await t.test("an option pointing into another module is a module switch", async () => {
    const r = await flow.answer(q.id, pick(q, "Actually, I need help with something else")).expect(200);
    assert.equal(r.body.reason, "MODULE_SWITCHED");
    assert.equal(r.body.question.module.key, "support");
    q = r.body.question;
  });

  await t.test("back cannot walk out of the module the user switched into", async () => {
    const r = await flow.back().expect(400);
    assert.equal(r.body.error.code, "NO_PREVIOUS_QUESTION");
  });

  // ---- through support to its checkpoint ----------------------------------
  res = await flow.answer(q.id, pick(q, "Something else")).expect(200);
  q = res.body.question;
  res = await flow.answer(q.id, pick(q, "Feedback")).expect(200);
  q = res.body.question;

  await t.test("landing on a checkpoint resets the module's live context", async () => {
    const r = await flow.answer(q.id, pick(q, "It can wait")).expect(200);
    assert.equal(r.body.reason, "CHECKPOINT_REACHED");
    assert.equal(r.body.question.isCheckpoint, true);
    q = r.body.question;
  });

  await t.test("back refuses to cross the checkpoint", async () => {
    const r = await flow.back().expect(400);
    assert.equal(r.body.error.code, "CHECKPOINT_BOUNDARY");
  });

  await t.test("returning to a previously visited module works", async () => {
    let r = await flow.answer(q.id, pick(q, "Email me")).expect(200);
    q = r.body.question;
    r = await flow.answer(q.id, pick(q, "Register another pet")).expect(200);
    assert.equal(r.body.reason, "MODULE_SWITCHED");
    assert.equal(r.body.question.module.key, "new-pet-intake");
    assert.equal(r.body.question.id, intakeEntryId);
    q = r.body.question;
  });

  // ---- walk intake down to its first checkpoint ---------------------------
  for (const label of ["A dog", "Under a year", "No, this would be their first visit", "Yes"]) {
    res = await flow.answer(q.id, pick(q, label)).expect(200);
    q = res.body.question;
  }
  assert.equal(res.body.reason, "CHECKPOINT_REACHED");
  assert.match(q.text, /^Thanks/);

  await t.test("history is preserved across the checkpoint, just marked as archived", async () => {
    const { body } = await flow.history().expect(200);
    const events = body.events as { seq: number; kind: string; isLiveContext: boolean }[];

    assert.deepEqual(
      events.map((e) => e.seq),
      [...events].sort((a, b) => a.seq - b.seq).map((e) => e.seq),
      "history is ordered by seq",
    );
    assert.ok(events.some((e) => e.kind === "MODULE_SWITCH"), "module switches are recorded");
    assert.ok(events.some((e) => e.kind === "CHECKPOINT"), "checkpoints are recorded");
    assert.ok(events.some((e) => e.kind === "BACK"), "back is recorded");
    assert.ok(
      events.some((e) => e.kind === "ANSWERED" && !e.isLiveContext),
      "pre-checkpoint answers survive in history but stop being live context",
    );
  });

  // ---- defensive handling -------------------------------------------------
  await t.test("an old deep link resolves to the latest valid question", async () => {
    const r = await flow.resume(intakeEntryId).expect(200);
    assert.equal(r.body.reason, "STALE_CHECKPOINT");
    assert.equal(r.body.redirected, true);
    assert.equal(r.body.question.id, q.id, "served the user's current question instead");
  });

  await t.test("a deep link to a question that never existed still resolves", async () => {
    const r = await flow.resume("does-not-exist").expect(200);
    assert.equal(r.body.reason, "QUESTION_GONE");
    assert.equal(r.body.question.id, q.id);
  });

  await t.test("answering a question the user has moved past is a 409 with a way back", async () => {
    // A genuinely valid question/option pair - it is only the user's state that
    // has moved on, which is exactly the stale-link / double-submit case.
    const stale = await prisma.option.findFirstOrThrow({ where: { questionId: intakeEntryId } });
    const r = await flow.answer(intakeEntryId, stale.id).expect(409);
    assert.equal(r.body.error.code, "STALE_QUESTION");
    assert.equal(r.body.error.currentQuestion.id, q.id, "the live question comes back with the error");
  });

  await t.test("an option from a different question is rejected", async () => {
    const other = await prisma.option.findFirstOrThrow({ where: { questionId: { not: q.id } } });
    const r = await flow.answer(q.id, other.id).expect(400);
    assert.equal(r.body.error.code, "OPTION_MISMATCH");
  });

  await t.test("unknown ids are 404, not 500", async () => {
    await flow.answer("nope", "nope").expect(404);
    await request(app).post("/api/flow/nobody/start").send({ moduleKey: "support" }).expect(404);
    await flow.start("no-such-module").expect(404);
  });

  await t.test("a malformed body is a 400 with the offending field named", async () => {
    const r = await request(app).post(`/api/flow/${flow.id}/answer`).send({ questionId: "" }).expect(400);
    assert.equal(r.body.error.code, "VALIDATION_ERROR");
    assert.ok(r.body.error.issues.length > 0);
  });

  // ---- completion and restart ---------------------------------------------
  await t.test("a terminal option completes the module", async () => {
    for (const label of ["Keep going here", "None that we know of", "Me"]) {
      const r = await flow.answer(q.id, pick(q, label)).expect(200);
      q = r.body.question;
    }
    const r = await flow.answer(q.id, pick(q, "No, I am done")).expect(200);
    assert.equal(r.body.reason, "MODULE_COMPLETED");
    assert.equal(r.body.question, null);
  });

  await t.test("starting a completed module restarts it with a fresh context", async () => {
    const r = await flow.start("new-pet-intake").expect(200);
    assert.equal(r.body.reason, "RESTARTED");
    assert.equal(r.body.question.id, intakeEntryId);
  });

  await t.test("resuming without a question id returns where the user is now", async () => {
    const r = await flow.resume().expect(200);
    assert.equal(r.body.reason, "CURRENT");
    assert.equal(r.body.question.id, intakeEntryId);
    assert.equal(r.body.redirected, false);
  });

  await t.test("state reports every module the user has touched", async () => {
    const { body } = await flow.state().expect(200);
    assert.equal(body.currentModule.key, "new-pet-intake");
    const keys = (body.modules as { moduleKey: string }[]).map((m) => m.moduleKey).sort();
    assert.deepEqual(keys, ["new-pet-intake", "support"]);
  });
});

// ---------------------------------------------------------------------------

test("a deep chain: the urgent triage branch runs six questions before its checkpoint", async () => {
  const flow = await newUser("e2e-deep");

  let q: Question = (await flow.start("symptom-triage").expect(200)).body.question;
  const visited = [q.id];

  // t1 -> t2 -> t4 -> t6 -> t8 -> t7(checkpoint): the severe path, which is
  // deliberately longer than the "mild" one that short-cuts to t9.
  const path = [
    "They are not eating or drinking",
    "Since today",
    "Severe - I am worried",
    "No, none of those",
    "They feel hot, or seem very lethargic",
  ];
  let res!: Awaited<ReturnType<typeof flow.answer>>;
  for (const label of path) {
    res = await flow.answer(q.id, pick(q, label)).expect(200);
    q = res.body.question;
    visited.push(q.id);
  }

  assert.equal(res.body.reason, "CHECKPOINT_REACHED");
  assert.equal(q.isCheckpoint, true);
  assert.equal(visited.length, 6, "six distinct questions on one path before the checkpoint");
  assert.equal(new Set(visited).size, 6, "no question repeated - this is a real chain, not a loop");
});

// ---------------------------------------------------------------------------

test("switching between modules repeatedly stays consistent", async () => {
  const flow = await newUser("e2e-switch");

  let q: Question = (await flow.start("new-pet-intake").expect(200)).body.question;

  // intake -> support -> intake, twice around the loop.
  for (let i = 0; i < 2; i++) {
    q = (await flow.answer(q.id, pick(q, "Actually, I need help with something else")).expect(200)).body
      .question;
    assert.equal(q.module.key, "support");

    for (const label of ["Something else", "Feedback", "It can wait", "Email me"]) {
      q = (await flow.answer(q.id, pick(q, label)).expect(200)).body.question;
    }

    q = (await flow.answer(q.id, pick(q, "Register another pet")).expect(200)).body.question;
    assert.equal(q.module.key, "new-pet-intake");
  }

  const { body } = await flow.state().expect(200);
  assert.equal(body.currentModule.key, "new-pet-intake");
  assert.equal(body.currentQuestionId, q.id, "state agrees with the last response");
});

// ---------------------------------------------------------------------------

test("deleting a user takes their entire conversation history with them", async () => {
  const flow = await newUser("e2e-delete");

  // Build up something worth deleting: several answers and a module switch.
  let q: Question = (await flow.start("new-pet-intake").expect(200)).body.question;
  q = (await flow.answer(q.id, pick(q, "Actually, I need help with something else")).expect(200)).body
    .question;
  q = (await flow.answer(q.id, pick(q, "Something else")).expect(200)).body.question;

  const before = {
    events: await prisma.conversationEvent.count({ where: { userId: flow.id } }),
    states: await prisma.userModuleState.count({ where: { userId: flow.id } }),
  };
  assert.ok(before.events > 3, "the user has history to lose");
  assert.equal(before.states, 2, "and state in both modules they touched");

  await request(app).delete(`/api/users/${flow.id}`).expect(204);

  // The cascade is declared in the schema; this asserts it actually fired.
  assert.equal(await prisma.conversationEvent.count({ where: { userId: flow.id } }), 0);
  assert.equal(await prisma.userModuleState.count({ where: { userId: flow.id } }), 0);
  assert.equal(await prisma.user.count({ where: { id: flow.id } }), 0);

  // And the user is gone from every user-scoped endpoint.
  await flow.state().expect(404);
  await flow.history().expect(404);
  await request(app).delete(`/api/users/${flow.id}`).expect(404);
});

test("deleting a user leaves the flow content untouched", async () => {
  const flow = await newUser("e2e-delete-content");
  const q: Question = (await flow.start("support").expect(200)).body.question;
  await flow.answer(q.id, pick(q, "My account")).expect(200);

  const before = await prisma.question.count();
  await request(app).delete(`/api/users/${flow.id}`).expect(204);

  assert.equal(await prisma.question.count(), before, "modules and questions belong to the flow, not the user");
});
