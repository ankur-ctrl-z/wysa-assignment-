/**
 * Flow rules - pure decision logic, no Prisma, no Express, no I/O.
 *
 * Everything the assignment calls an "edge case" is decided here, which is why
 * this file has no database in it: the whole matrix (stale links, broken
 * references, checkpoints, module switches, back) is testable as plain functions.
 *
 * The service layer (flow.service.ts) loads the inputs and persists the outputs
 * inside a transaction. It makes no decisions of its own.
 */
import { ApiError } from "../../lib/errors.js";

// ---------------------------------------------------------------- shapes
// Structural, not Prisma types, so the rules stay independent of the schema.

export interface RuleQuestion {
  id: string;
  moduleId: string;
  text: string;
  isCheckpoint: boolean;
}

export interface RuleOption {
  id: string;
  questionId: string;
  label: string;
  nextQuestionId: string | null;
}

export interface RuleModuleState {
  moduleId: string;
  currentQuestionId: string | null;
  contextResetSeq: number;
  completedAt: Date | null;
}

/** The subset of a history event the rules care about. */
export interface RuleEvent {
  seq: number;
  kind: string;
  moduleId: string;
  questionId: string;
}

// ---------------------------------------------------------------- start

export type StartReason = "STARTED" | "RESUMED" | "RESTARTED";

export interface StartDecision {
  question: RuleQuestion;
  reason: StartReason;
  /** true when the module live context must be reset to "now". */
  resetContext: boolean;
}

/**
 * Starting a module is really three cases wearing one name:
 *  - never started         -> entry question
 *  - parked on a question  -> resume exactly there (returning to a visited module)
 *  - left, finished, or an explicit restart -> entry question with a fresh context
 */
export function decideStart(input: {
  state: RuleModuleState | null;
  currentQuestion: RuleQuestion | null;
  entryQuestion: RuleQuestion | null;
  restart: boolean;
}): StartDecision {
  const { state, currentQuestion, entryQuestion, restart } = input;

  if (state && state.currentQuestionId && currentQuestion && !restart) {
    return { question: currentQuestion, reason: "RESUMED", resetContext: false };
  }

  if (!entryQuestion) {
    throw ApiError.badRequest(
      "MODULE_HAS_NO_ENTRY",
      "This module has no entry question set, so it cannot be started.",
      { moduleId: state?.moduleId },
    );
  }

  // A restart (explicit, after completion, or after leaving via a module switch)
  // is itself a context reset: nothing before it should influence what comes next.
  return {
    question: entryQuestion,
    reason: state ? "RESTARTED" : "STARTED",
    resetContext: Boolean(state),
  };
}

// ---------------------------------------------------------------- answer

export type AnswerDecision =
  | {
      kind: "MOVE";
      next: RuleQuestion;
      /** The target lives in a different module: this answer is a module switch. */
      crossesModule: boolean;
      /** The target is a checkpoint: reset this module live context on arrival. */
      resetContext: boolean;
    }
  | { kind: "COMPLETE" };

/**
 * Guards run in a deliberate order - cheapest and most specific first - so the
 * client always gets the most informative error rather than a generic 400.
 */
export function decideAnswer<TCurrent>(input: {
  requestedQuestionId: string;
  requestedOptionId: string;
  question: RuleQuestion | null;
  option: RuleOption | null;
  /** Resolved option.nextQuestionId. null when the option is terminal OR the target is missing. */
  target: RuleQuestion | null;
  state: RuleModuleState | null;
  /**
   * The question the user is genuinely on. The rules never inspect it - it is
   * attached to errors so a stale client can re-render itself - so its shape is
   * whatever the caller wants to hand back.
   */
  currentQuestion: TCurrent | null;
}): AnswerDecision {
  const {
    requestedQuestionId,
    requestedOptionId,
    question,
    option,
    target,
    state,
    currentQuestion,
  } = input;

  // 1. The question does not exist (deleted, or a fabricated id).
  if (!question) {
    throw ApiError.notFound("QUESTION_NOT_FOUND", "That question does not exist.", {
      questionId: requestedQuestionId,
      currentQuestion,
    });
  }

  // 2. The option does not exist.
  if (!option) {
    throw ApiError.notFound("OPTION_NOT_FOUND", "That option does not exist.", {
      optionId: requestedOptionId,
      currentQuestion,
    });
  }

  // 3. The option exists but belongs to a different question - a mismatched pair
  //    from a stale client, not a valid move.
  if (option.questionId !== question.id) {
    throw ApiError.badRequest("OPTION_MISMATCH", "That option does not belong to that question.", {
      questionId: question.id,
      optionId: option.id,
      currentQuestion,
    });
  }

  // 4. The user is not on this question. Covers double submits, old browser tabs
  //    and replayed deep links. 409 + the live question, so the client self-heals.
  if (!state || state.currentQuestionId !== question.id) {
    throw ApiError.conflict("STALE_QUESTION", "You have already moved past that question.", {
      requestedQuestionId: question.id,
      currentQuestion,
    });
  }

  // 5. The option points somewhere that no longer resolves. The user stays parked
  //    on their current question rather than being stranded on a null.
  if (option.nextQuestionId && !target) {
    throw ApiError.conflict(
      "BROKEN_REFERENCE",
      "That option points to a question that no longer exists.",
      {
        optionId: option.id,
        brokenQuestionId: option.nextQuestionId,
        currentQuestion,
      },
    );
  }

  // 6. A terminal option ends the module.
  if (!target) return { kind: "COMPLETE" };

  return {
    kind: "MOVE",
    next: target,
    crossesModule: target.moduleId !== question.moduleId,
    resetContext: target.isCheckpoint,
  };
}

// ---------------------------------------------------------------- back

/**
 * History is append-only, so "back" cannot pop a row. It replays the module live
 * events as a stack instead:
 *
 *   ANSWERED(q) -> push q      (the user moved off q)
 *   BACK        -> pop         (the user moved back onto it)
 *
 * The top of the stack is the previous question. Events at or below
 * contextResetSeq are excluded, which is exactly what makes a checkpoint a wall:
 * the stack is empty on its far side even though the history is fully intact.
 */
export function decideBack(input: {
  state: RuleModuleState | null;
  /** All events for this user in this module, ascending by seq. */
  events: RuleEvent[];
}): { previousQuestionId: string } {
  const { state, events } = input;

  if (!state || !state.currentQuestionId) {
    throw ApiError.badRequest("NO_ACTIVE_QUESTION", "You are not currently in this module.");
  }

  const live = events.filter((e) => e.seq > state.contextResetSeq);
  const stack: string[] = [];
  for (const event of live) {
    if (event.kind === "ANSWERED") stack.push(event.questionId);
    else if (event.kind === "BACK") stack.pop();
  }

  const previousQuestionId = stack.pop();
  if (previousQuestionId) return { previousQuestionId };

  // Distinguish "nothing to go back to" from "there is, but a checkpoint is in
  // the way" - the second is a much more useful thing to show a user.
  const blockedByCheckpoint = events.some(
    (e) => e.kind === "ANSWERED" && e.seq <= state.contextResetSeq,
  );
  if (blockedByCheckpoint) {
    throw ApiError.badRequest(
      "CHECKPOINT_BOUNDARY",
      "You cannot go back past a checkpoint. Earlier answers are still in your history.",
      { contextResetSeq: state.contextResetSeq },
    );
  }

  throw ApiError.badRequest("NO_PREVIOUS_QUESTION", "You are at the start of this module.");
}

// ---------------------------------------------------------------- deep links

export type ResolutionReason =
  | "EXACT" // the requested question is genuinely where the user is
  | "CURRENT" // no question was requested; here is the live one
  | "SUPERSEDED" // valid question, but the user has moved on within that module
  | "STALE_CHECKPOINT" // the user has passed a checkpoint since that link was made
  | "QUESTION_GONE" // the question was deleted
  | "MODULE_NOT_STARTED" // valid question, but the user has never entered that module
  | "MODULE_NOT_ACTIVE" // the user finished or left that module
  | "NO_ACTIVE_QUESTION"; // nothing to serve at all - user has not started anything

export interface Resolution {
  question: RuleQuestion | null;
  reason: ResolutionReason;
  requestedQuestionId: string | null;
}

/**
 * Requirement 6: an old deep link or notification must never dead-end. This
 * ALWAYS resolves to the best available question and reports why, so the client
 * can say "that link is out of date" instead of showing a 404.
 */
export function resolveDeepLink(input: {
  requestedQuestionId: string | null;
  /** The requested question, or null if it no longer exists. */
  requestedQuestion: RuleQuestion | null;
  /** The user state for the REQUESTED question module. */
  stateForModule: RuleModuleState | null;
  /** Where the user is inside the requested question module. */
  moduleCurrentQuestion: RuleQuestion | null;
  /** That module entry question. */
  entryQuestion: RuleQuestion | null;
  /** Where the user is globally, used when the request tells us nothing usable. */
  globalCurrentQuestion: RuleQuestion | null;
  /** seq of the ANSWERED event for the requested question, if it was ever answered. */
  answeredAtSeq: number | null;
}): Resolution {
  const {
    requestedQuestionId,
    requestedQuestion,
    stateForModule,
    moduleCurrentQuestion,
    entryQuestion,
    globalCurrentQuestion,
    answeredAtSeq,
  } = input;

  const served = (reason: ResolutionReason, question: RuleQuestion | null): Resolution => ({
    question,
    reason: question ? reason : "NO_ACTIVE_QUESTION",
    requestedQuestionId,
  });

  if (!requestedQuestionId) return served("CURRENT", globalCurrentQuestion);
  if (!requestedQuestion) return served("QUESTION_GONE", globalCurrentQuestion);
  if (!stateForModule) return served("MODULE_NOT_STARTED", entryQuestion);

  if (stateForModule.currentQuestionId === requestedQuestion.id) {
    return { question: requestedQuestion, reason: "EXACT", requestedQuestionId };
  }

  if (!moduleCurrentQuestion) {
    return served("MODULE_NOT_ACTIVE", entryQuestion ?? globalCurrentQuestion);
  }

  // The link predates a checkpoint the user has since crossed - the most
  // interesting stale case, and worth naming separately from a plain move.
  if (answeredAtSeq !== null && answeredAtSeq <= stateForModule.contextResetSeq) {
    return served("STALE_CHECKPOINT", moduleCurrentQuestion);
  }

  return served("SUPERSEDED", moduleCurrentQuestion);
}
