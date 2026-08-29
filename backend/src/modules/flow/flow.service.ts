/**
 * Flow service - loads inputs for the rules, persists their outcome.
 *
 * Every write goes through one transaction and follows the same discipline:
 *   append to history (never update it), then move state to match.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import {
  decideAnswer,
  decideBack,
  decideStart,
  resolveDeepLink,
  type RuleModuleState,
  type RuleQuestion,
} from "./flow.rules.js";

type Tx = Prisma.TransactionClient | PrismaClient;

// ---------------------------------------------------------------- views
// The shapes the API hands back. Kept in one place so the player UI and the
// admin UI never have to guess what a "question" looks like.

export interface OptionView {
  id: string;
  label: string;
  order: number;
  /** null when this option ends the module. */
  nextQuestionId: string | null;
  /** Set when the option jumps to another module, so the UI can flag it. */
  switchesToModuleKey: string | null;
  /** true when the target is missing - the admin UI surfaces this as a defect. */
  isBroken: boolean;
}

export interface QuestionView {
  id: string;
  text: string;
  isCheckpoint: boolean;
  module: { id: string; key: string; title: string };
  options: OptionView[];
}

const questionInclude = {
  module: true,
  options: {
    orderBy: { order: "asc" },
    include: { nextQuestion: { include: { module: true } } },
  },
} satisfies Prisma.QuestionInclude;

type QuestionWithGraph = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

function toQuestionView(question: QuestionWithGraph): QuestionView {
  return {
    id: question.id,
    text: question.text,
    isCheckpoint: question.isCheckpoint,
    module: { id: question.module.id, key: question.module.key, title: question.module.title },
    options: question.options.map((option) => ({
      id: option.id,
      label: option.label,
      order: option.order,
      nextQuestionId: option.nextQuestionId,
      switchesToModuleKey:
        option.nextQuestion && option.nextQuestion.moduleId !== question.moduleId
          ? option.nextQuestion.module.key
          : null,
      isBroken: Boolean(option.nextQuestionId && !option.nextQuestion),
    })),
  };
}

async function loadQuestionView(db: Tx, questionId: string | null): Promise<QuestionView | null> {
  if (!questionId) return null;
  const question = await db.question.findUnique({ where: { id: questionId }, include: questionInclude });
  return question ? toQuestionView(question) : null;
}

/** The rules only need the four fields they actually branch on. */
const toRuleQuestion = (view: QuestionView | null): RuleQuestion | null =>
  view
    ? { id: view.id, moduleId: view.module.id, text: view.text, isCheckpoint: view.isCheckpoint }
    : null;

// ---------------------------------------------------------------- history

/**
 * Per-user gapless sequence. Allocated inside the caller transaction so it stays
 * consistent with the events it orders.
 *
 * ponytail: max(seq)+1 races if one user answers twice concurrently; the
 * @@unique([userId, seq]) turns that into a 409 the client retries. Swap for a
 * per-user advisory lock (or a Postgres sequence per user) if that ever shows up.
 */
async function nextSeq(tx: Tx, userId: string): Promise<number> {
  const { _max } = await tx.conversationEvent.aggregate({
    where: { userId },
    _max: { seq: true },
  });
  return (_max.seq ?? 0) + 1;
}

type EventKind = "PRESENTED" | "ANSWERED" | "CHECKPOINT" | "MODULE_SWITCH" | "BACK" | "COMPLETED";

/** The only way anything is written to history. Append-only by construction. */
async function appendEvent(
  tx: Tx,
  input: {
    userId: string;
    kind: EventKind;
    question: QuestionView;
    optionId?: string | null;
    optionLabel?: string | null;
  },
): Promise<number> {
  const seq = await nextSeq(tx, input.userId);
  await tx.conversationEvent.create({
    data: {
      userId: input.userId,
      seq,
      kind: input.kind,
      moduleId: input.question.module.id,
      questionId: input.question.id,
      optionId: input.optionId ?? null,
      // Snapshots: history must survive the content being edited or deleted.
      moduleTitle: input.question.module.title,
      questionText: input.question.text,
      optionLabel: input.optionLabel ?? null,
    },
  });
  return seq;
}

// ---------------------------------------------------------------- loaders

async function requireUser(db: Tx, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.notFound("USER_NOT_FOUND", "That user does not exist.", { userId });
  return user;
}

async function requireModule(db: Tx, moduleKey: string) {
  const found = await db.module.findUnique({ where: { key: moduleKey } });
  if (!found) throw ApiError.notFound("MODULE_NOT_FOUND", "That module does not exist.", { moduleKey });
  return found;
}

async function loadState(db: Tx, userId: string, moduleId: string): Promise<RuleModuleState | null> {
  const state = await db.userModuleState.findUnique({
    where: { userId_moduleId: { userId, moduleId } },
  });
  return state
    ? {
        moduleId: state.moduleId,
        currentQuestionId: state.currentQuestionId,
        contextResetSeq: state.contextResetSeq,
        completedAt: state.completedAt,
      }
    : null;
}

/** Where the user is right now, across all modules. */
async function loadGlobalCurrentQuestion(db: Tx, userId: string): Promise<QuestionView | null> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.currentModuleId) return null;
  const state = await loadState(db, userId, user.currentModuleId);
  return loadQuestionView(db, state?.currentQuestionId ?? null);
}

// ---------------------------------------------------------------- operations

export interface FlowResponse {
  question: QuestionView | null;
  state: StateView;
  /** Why this particular question is being served. */
  reason: string;
}

export async function start(userId: string, moduleKey: string, restart: boolean): Promise<FlowResponse> {
  await requireUser(prisma, userId);
  const mod = await requireModule(prisma, moduleKey);

  return prisma.$transaction(async (tx) => {
    const state = await loadState(tx, userId, mod.id);
    const currentQuestion = await loadQuestionView(tx, state?.currentQuestionId ?? null);
    const entryQuestion = await loadQuestionView(tx, mod.entryQuestionId);

    const decision = decideStart({
      state,
      currentQuestion: toRuleQuestion(currentQuestion),
      entryQuestion: toRuleQuestion(entryQuestion),
      restart,
    });

    const question = decision.reason === "RESUMED" ? currentQuestion! : entryQuestion!;

    // Resuming changes nothing in history: the user is simply looking at where
    // they already were. Only an actual (re)start is an event.
    let seq = state?.contextResetSeq ?? 0;
    if (decision.reason !== "RESUMED") {
      seq = await appendEvent(tx, { userId, kind: "PRESENTED", question });
    }

    await tx.userModuleState.upsert({
      where: { userId_moduleId: { userId, moduleId: mod.id } },
      create: {
        userId,
        moduleId: mod.id,
        currentQuestionId: question.id,
        contextResetSeq: decision.resetContext ? seq : 0,
      },
      update: {
        currentQuestionId: question.id,
        completedAt: null,
        ...(decision.resetContext ? { contextResetSeq: seq } : {}),
      },
    });
    await tx.user.update({ where: { id: userId }, data: { currentModuleId: mod.id } });

    return { question, state: await buildStateView(tx, userId), reason: decision.reason };
  });
}

export async function answer(
  userId: string,
  questionId: string,
  optionId: string,
): Promise<FlowResponse> {
  await requireUser(prisma, userId);

  return prisma.$transaction(async (tx) => {
    const question = await loadQuestionView(tx, questionId);
    const option = question?.options.find((o) => o.id === optionId) ?? null;

    // The option may not belong to this question (or may not exist at all); load
    // it independently so the rules can tell those two cases apart.
    const optionRow = option
      ? { id: option.id, questionId, label: option.label, nextQuestionId: option.nextQuestionId }
      : await tx.option
          .findUnique({ where: { id: optionId } })
          .then((o) =>
            o ? { id: o.id, questionId: o.questionId, label: o.label, nextQuestionId: o.nextQuestionId } : null,
          );

    const state = question ? await loadState(tx, userId, question.module.id) : null;
    const currentQuestion =
      (await loadQuestionView(tx, state?.currentQuestionId ?? null)) ??
      (await loadGlobalCurrentQuestion(tx, userId));
    const target = await loadQuestionView(tx, optionRow?.nextQuestionId ?? null);

    const decision = decideAnswer({
      requestedQuestionId: questionId,
      requestedOptionId: optionId,
      question: toRuleQuestion(question),
      option: optionRow,
      target: toRuleQuestion(target),
      state,
      currentQuestion,
    });

    // Past this point the move is valid, so question/optionRow are non-null.
    const answered = question!;
    const chosen = optionRow!;

    await appendEvent(tx, {
      userId,
      kind: "ANSWERED",
      question: answered,
      optionId: chosen.id,
      optionLabel: chosen.label,
    });

    if (decision.kind === "COMPLETE") {
      await appendEvent(tx, { userId, kind: "COMPLETED", question: answered });
      await tx.userModuleState.update({
        where: { userId_moduleId: { userId, moduleId: answered.module.id } },
        data: { currentQuestionId: null, completedAt: new Date() },
      });
      return { question: null, state: await buildStateView(tx, userId), reason: "MODULE_COMPLETED" };
    }

    const next = target!;

    if (decision.crossesModule) {
      const switchSeq = await appendEvent(tx, { userId, kind: "MODULE_SWITCH", question: next });

      // The user has left the source module. currentQuestionId is cleared but
      // completedAt stays null - they left, they did not finish.
      await tx.userModuleState.update({
        where: { userId_moduleId: { userId, moduleId: answered.module.id } },
        data: { currentQuestionId: null },
      });

      // Entering a module from outside is a fresh context for that module, so the
      // watermark moves. That is what keeps `back` from walking out of the module
      // the user is currently in, however many times they switch.
      await tx.userModuleState.upsert({
        where: { userId_moduleId: { userId, moduleId: next.module.id } },
        create: {
          userId,
          moduleId: next.module.id,
          currentQuestionId: next.id,
          contextResetSeq: switchSeq,
        },
        update: { currentQuestionId: next.id, contextResetSeq: switchSeq, completedAt: null },
      });
      await tx.user.update({ where: { id: userId }, data: { currentModuleId: next.module.id } });

      return { question: next, state: await buildStateView(tx, userId), reason: "MODULE_SWITCHED" };
    }

    // Same module. A checkpoint target moves the watermark to itself: everything
    // before it stays in history but stops counting as live context.
    let contextResetSeq: number | undefined;
    if (decision.resetContext) {
      contextResetSeq = await appendEvent(tx, { userId, kind: "CHECKPOINT", question: next });
    }

    await tx.userModuleState.update({
      where: { userId_moduleId: { userId, moduleId: answered.module.id } },
      data: {
        currentQuestionId: next.id,
        ...(contextResetSeq !== undefined ? { contextResetSeq } : {}),
      },
    });

    return {
      question: next,
      state: await buildStateView(tx, userId),
      reason: decision.resetContext ? "CHECKPOINT_REACHED" : "ADVANCED",
    };
  });
}

/** Bonus: step back one question, within the current module and since the last checkpoint. */
export async function back(userId: string): Promise<FlowResponse> {
  const user = await requireUser(prisma, userId);
  if (!user.currentModuleId) {
    throw ApiError.badRequest("NO_ACTIVE_QUESTION", "You have not started a module yet.");
  }
  const moduleId = user.currentModuleId;

  return prisma.$transaction(async (tx) => {
    const state = await loadState(tx, userId, moduleId);
    const events = await tx.conversationEvent.findMany({
      where: { userId, moduleId },
      orderBy: { seq: "asc" },
      select: { seq: true, kind: true, moduleId: true, questionId: true },
    });

    const { previousQuestionId } = decideBack({ state, events });

    const previous = await loadQuestionView(tx, previousQuestionId);
    if (!previous) {
      // The question we came from has since been deleted. Stay put rather than
      // moving the user somewhere that no longer exists.
      throw ApiError.conflict("BROKEN_REFERENCE", "The previous question no longer exists.", {
        brokenQuestionId: previousQuestionId,
      });
    }

    await appendEvent(tx, { userId, kind: "BACK", question: previous });
    await tx.userModuleState.update({
      where: { userId_moduleId: { userId, moduleId } },
      data: { currentQuestionId: previous.id, completedAt: null },
    });

    return { question: previous, state: await buildStateView(tx, userId), reason: "WENT_BACK" };
  });
}

/**
 * Deep link / notification entry point. Always 200 - see resolveDeepLink.
 */
export async function resume(userId: string, requestedQuestionId: string | null) {
  await requireUser(prisma, userId);

  const requested = await loadQuestionView(prisma, requestedQuestionId);
  const stateForModule = requested ? await loadState(prisma, userId, requested.module.id) : null;
  const moduleCurrentQuestion = await loadQuestionView(prisma, stateForModule?.currentQuestionId ?? null);

  const entryQuestion = requested
    ? await prisma.module
        .findUnique({ where: { id: requested.module.id } })
        .then((m) => loadQuestionView(prisma, m?.entryQuestionId ?? null))
    : null;

  // Was the requested question ever actually answered, and if so when? That is
  // what separates "you moved on" from "you crossed a checkpoint".
  const answeredEvent = requestedQuestionId
    ? await prisma.conversationEvent.findFirst({
        where: { userId, questionId: requestedQuestionId, kind: "ANSWERED" },
        orderBy: { seq: "desc" },
        select: { seq: true },
      })
    : null;

  const resolution = resolveDeepLink({
    requestedQuestionId,
    requestedQuestion: toRuleQuestion(requested),
    stateForModule,
    moduleCurrentQuestion: toRuleQuestion(moduleCurrentQuestion),
    entryQuestion: toRuleQuestion(entryQuestion),
    globalCurrentQuestion: toRuleQuestion(await loadGlobalCurrentQuestion(prisma, userId)),
    answeredAtSeq: answeredEvent?.seq ?? null,
  });

  // Re-hydrate the chosen id into a full view (the rules only pass ids around).
  const question = await loadQuestionView(prisma, resolution.question?.id ?? null);

  return {
    question,
    reason: resolution.reason,
    requestedQuestionId: resolution.requestedQuestionId,
    /** true when the client should tell the user their link was out of date. */
    redirected: Boolean(requestedQuestionId) && resolution.reason !== "EXACT",
    state: await buildStateView(prisma, userId),
  };
}

// ---------------------------------------------------------------- reads

export interface StateView {
  userId: string;
  currentModule: { id: string; key: string; title: string } | null;
  currentQuestionId: string | null;
  modules: {
    moduleKey: string;
    moduleTitle: string;
    currentQuestionId: string | null;
    contextResetSeq: number;
    completedAt: Date | null;
    startedAt: Date;
  }[];
}

async function buildStateView(db: Tx, userId: string): Promise<StateView> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { states: { include: { module: true }, orderBy: { startedAt: "asc" } } },
  });
  const current = user.states.find((s) => s.moduleId === user.currentModuleId);

  return {
    userId,
    currentModule: current
      ? { id: current.module.id, key: current.module.key, title: current.module.title }
      : null,
    currentQuestionId: current?.currentQuestionId ?? null,
    modules: user.states.map((s) => ({
      moduleKey: s.module.key,
      moduleTitle: s.module.title,
      currentQuestionId: s.currentQuestionId,
      contextResetSeq: s.contextResetSeq,
      completedAt: s.completedAt,
      startedAt: s.startedAt,
    })),
  };
}

export const getState = (userId: string) =>
  requireUser(prisma, userId).then(() => buildStateView(prisma, userId));

/**
 * The complete conversation history. Nothing here is ever filtered away by a
 * checkpoint - `isLiveContext` just marks which side of the watermark each event
 * falls on, so the UI can show the boundary instead of hiding what came before.
 */
export async function history(userId: string, moduleKey?: string) {
  await requireUser(prisma, userId);
  const mod = moduleKey ? await requireModule(prisma, moduleKey) : null;

  const [events, states] = await Promise.all([
    prisma.conversationEvent.findMany({
      where: { userId, ...(mod ? { moduleId: mod.id } : {}) },
      orderBy: { seq: "asc" },
    }),
    prisma.userModuleState.findMany({ where: { userId } }),
  ]);

  const watermark = new Map(states.map((s) => [s.moduleId, s.contextResetSeq]));

  return events.map((e) => ({
    seq: e.seq,
    kind: e.kind,
    moduleId: e.moduleId,
    moduleTitle: e.moduleTitle,
    questionId: e.questionId,
    questionText: e.questionText,
    optionId: e.optionId,
    optionLabel: e.optionLabel,
    createdAt: e.createdAt,
    isLiveContext: e.seq > (watermark.get(e.moduleId) ?? 0),
  }));
}
