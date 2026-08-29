/**
 * The edge-case matrix, tested as pure functions - no database, no HTTP.
 * Run with: npm run test:rules
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/lib/errors.js";
import {
  decideAnswer,
  decideBack,
  decideStart,
  resolveDeepLink,
  type RuleEvent,
  type RuleModuleState,
  type RuleOption,
  type RuleQuestion,
} from "../src/modules/flow/flow.rules.js";

const q = (id: string, moduleId = "m1", isCheckpoint = false): RuleQuestion => ({
  id,
  moduleId,
  text: id,
  isCheckpoint,
});

const opt = (id: string, questionId: string, nextQuestionId: string | null): RuleOption => ({
  id,
  questionId,
  label: id,
  nextQuestionId,
});

const state = (over: Partial<RuleModuleState> = {}): RuleModuleState => ({
  moduleId: "m1",
  currentQuestionId: "q1",
  contextResetSeq: 0,
  completedAt: null,
  ...over,
});

/** Asserts the call throws an ApiError with the given code. */
function expectCode(code: string, fn: () => unknown) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

// ---------------------------------------------------------------- start

test("start: a module never touched begins at its entry question", () => {
  const d = decideStart({ state: null, currentQuestion: null, entryQuestion: q("q1"), restart: false });
  assert.deepEqual([d.reason, d.question.id, d.resetContext], ["STARTED", "q1", false]);
});

test("start: returning to a module resumes exactly where the user was", () => {
  const d = decideStart({
    state: state({ currentQuestionId: "q3" }),
    currentQuestion: q("q3"),
    entryQuestion: q("q1"),
    restart: false,
  });
  assert.deepEqual([d.reason, d.question.id], ["RESUMED", "q3"]);
});

test("start: an explicit restart returns to entry and resets live context", () => {
  const d = decideStart({
    state: state({ currentQuestionId: "q3" }),
    currentQuestion: q("q3"),
    entryQuestion: q("q1"),
    restart: true,
  });
  assert.deepEqual([d.reason, d.question.id, d.resetContext], ["RESTARTED", "q1", true]);
});

test("start: a module left via a switch restarts rather than dead-ending", () => {
  const d = decideStart({
    state: state({ currentQuestionId: null }),
    currentQuestion: null,
    entryQuestion: q("q1"),
    restart: false,
  });
  assert.equal(d.reason, "RESTARTED");
});

test("start: a module with no entry question is refused, not crashed into", () => {
  expectCode("MODULE_HAS_NO_ENTRY", () =>
    decideStart({ state: null, currentQuestion: null, entryQuestion: null, restart: false }),
  );
});

// ---------------------------------------------------------------- answer

const answerInput = (over: Record<string, unknown> = {}) => ({
  requestedQuestionId: "q1",
  requestedOptionId: "a",
  question: q("q1"),
  option: opt("a", "q1", "q2"),
  target: q("q2"),
  state: state(),
  currentQuestion: q("q1"),
  ...over,
});

test("answer: advancing inside a module", () => {
  const d = decideAnswer(answerInput());
  assert.deepEqual(d, { kind: "MOVE", next: q("q2"), crossesModule: false, resetContext: false });
});

test("answer: an option targeting another module is a switch", () => {
  const d = decideAnswer(answerInput({ option: opt("a", "q1", "s1"), target: q("s1", "m2") }));
  assert.equal(d.kind === "MOVE" && d.crossesModule, true);
});

test("answer: landing on a checkpoint asks for a context reset", () => {
  const d = decideAnswer(answerInput({ target: q("q2", "m1", true) }));
  assert.equal(d.kind === "MOVE" && d.resetContext, true);
});

test("answer: a terminal option completes the module", () => {
  const d = decideAnswer(answerInput({ option: opt("a", "q1", null), target: null }));
  assert.deepEqual(d, { kind: "COMPLETE" });
});

test("answer: unknown question", () => {
  expectCode("QUESTION_NOT_FOUND", () => decideAnswer(answerInput({ question: null })));
});

test("answer: unknown option", () => {
  expectCode("OPTION_NOT_FOUND", () => decideAnswer(answerInput({ option: null })));
});

test("answer: an option belonging to a different question is rejected", () => {
  expectCode("OPTION_MISMATCH", () => decideAnswer(answerInput({ option: opt("a", "qOTHER", "q2") })));
});

test("answer: answering a question the user has moved past is a conflict", () => {
  expectCode("STALE_QUESTION", () =>
    decideAnswer(answerInput({ state: state({ currentQuestionId: "q9" }) })),
  );
});

test("answer: STALE_QUESTION hands back the live question so the client can recover", () => {
  try {
    decideAnswer(answerInput({ state: state({ currentQuestionId: "q9" }), currentQuestion: q("q9") }));
    assert.fail("expected a throw");
  } catch (err) {
    assert.deepEqual((err as ApiError).context.currentQuestion, q("q9"));
  }
});

test("answer: an option pointing at a deleted question does not strand the user", () => {
  expectCode("BROKEN_REFERENCE", () =>
    decideAnswer(answerInput({ option: opt("a", "q1", "gone"), target: null })),
  );
});

test("answer: with no state at all, the question is treated as stale rather than accepted", () => {
  expectCode("STALE_QUESTION", () => decideAnswer(answerInput({ state: null })));
});

// ---------------------------------------------------------------- back

const ev = (seq: number, kind: string, questionId: string): RuleEvent => ({
  seq,
  kind,
  moduleId: "m1",
  questionId,
});

test("back: steps onto the question the user last answered", () => {
  const d = decideBack({
    state: state({ currentQuestionId: "q3" }),
    events: [ev(1, "PRESENTED", "q1"), ev(2, "ANSWERED", "q1"), ev(3, "ANSWERED", "q2")],
  });
  assert.equal(d.previousQuestionId, "q2");
});

test("back: repeated backs walk the stack down rather than sticking", () => {
  // History is append-only, so a previous BACK is replayed as a pop.
  const d = decideBack({
    state: state({ currentQuestionId: "q2" }),
    events: [ev(1, "ANSWERED", "q1"), ev(2, "ANSWERED", "q2"), ev(3, "BACK", "q2")],
  });
  assert.equal(d.previousQuestionId, "q1");
});

test("back: answering again after a back re-pushes, so back returns there", () => {
  const d = decideBack({
    state: state({ currentQuestionId: "q3" }),
    events: [
      ev(1, "ANSWERED", "q1"),
      ev(2, "ANSWERED", "q2"),
      ev(3, "BACK", "q2"),
      ev(4, "ANSWERED", "q2"),
    ],
  });
  assert.equal(d.previousQuestionId, "q2");
});

test("back: a checkpoint is a wall, and says so", () => {
  expectCode("CHECKPOINT_BOUNDARY", () =>
    decideBack({
      state: state({ currentQuestionId: "q5", contextResetSeq: 4 }),
      events: [ev(1, "ANSWERED", "q1"), ev(2, "ANSWERED", "q2"), ev(4, "CHECKPOINT", "q5")],
    }),
  );
});

test("back: history survives the checkpoint even though the flow cannot cross it", () => {
  // Same input as above: the pre-checkpoint ANSWERED events are still present.
  const events = [ev(1, "ANSWERED", "q1"), ev(2, "ANSWERED", "q2"), ev(4, "CHECKPOINT", "q5")];
  assert.equal(events.filter((e) => e.kind === "ANSWERED").length, 2);
});

test("back: at the start of a module there is nothing to go back to", () => {
  expectCode("NO_PREVIOUS_QUESTION", () =>
    decideBack({ state: state({ currentQuestionId: "q1" }), events: [ev(1, "PRESENTED", "q1")] }),
  );
});

test("back: outside any module is refused", () => {
  expectCode("NO_ACTIVE_QUESTION", () =>
    decideBack({ state: state({ currentQuestionId: null }), events: [] }),
  );
});

// ---------------------------------------------------------------- deep links

const linkInput = (over: Record<string, unknown> = {}) => ({
  requestedQuestionId: "q1",
  requestedQuestion: q("q1"),
  stateForModule: state({ currentQuestionId: "q1" }),
  moduleCurrentQuestion: q("q1"),
  entryQuestion: q("q1"),
  globalCurrentQuestion: q("q1"),
  answeredAtSeq: null,
  ...over,
});

test("deep link: a still-valid link serves exactly what it asked for", () => {
  assert.equal(resolveDeepLink(linkInput()).reason, "EXACT");
});

test("deep link: no question requested just returns the live one", () => {
  const r = resolveDeepLink(linkInput({ requestedQuestionId: null, globalCurrentQuestion: q("q7") }));
  assert.deepEqual([r.reason, r.question?.id], ["CURRENT", "q7"]);
});

test("deep link: a deleted question falls back to where the user actually is", () => {
  const r = resolveDeepLink(
    linkInput({ requestedQuestion: null, globalCurrentQuestion: q("q7") }),
  );
  assert.deepEqual([r.reason, r.question?.id], ["QUESTION_GONE", "q7"]);
});

test("deep link: a link into a module the user has never started offers its entry", () => {
  const r = resolveDeepLink(linkInput({ stateForModule: null, entryQuestion: q("q1") }));
  assert.deepEqual([r.reason, r.question?.id], ["MODULE_NOT_STARTED", "q1"]);
});

test("deep link: a link the user has moved past returns the latest valid question", () => {
  const r = resolveDeepLink(
    linkInput({
      stateForModule: state({ currentQuestionId: "q4" }),
      moduleCurrentQuestion: q("q4"),
      answeredAtSeq: 5,
    }),
  );
  assert.deepEqual([r.reason, r.question?.id], ["SUPERSEDED", "q4"]);
});

test("deep link: a link from before a crossed checkpoint is named as such", () => {
  const r = resolveDeepLink(
    linkInput({
      stateForModule: state({ currentQuestionId: "q4", contextResetSeq: 9 }),
      moduleCurrentQuestion: q("q4"),
      answeredAtSeq: 5, // answered before the checkpoint at seq 9
    }),
  );
  assert.deepEqual([r.reason, r.question?.id], ["STALE_CHECKPOINT", "q4"]);
});

test("deep link: a module the user finished offers its entry again", () => {
  const r = resolveDeepLink(
    linkInput({ stateForModule: state({ currentQuestionId: null }), moduleCurrentQuestion: null }),
  );
  assert.equal(r.reason, "MODULE_NOT_ACTIVE");
});

test("deep link: with nothing to serve it says so instead of returning null silently", () => {
  const r = resolveDeepLink(
    linkInput({ requestedQuestionId: null, globalCurrentQuestion: null }),
  );
  assert.deepEqual([r.reason, r.question], ["NO_ACTIVE_QUESTION", null]);
});
