/**
 * Catalog service - authoring the flow content (modules, questions, options).
 *
 * This is the admin side of the system. It never touches history or user state;
 * it only shapes the graph that the flow engine walks.
 */
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";

// ---------------------------------------------------------------- modules

export const listModules = () =>
  prisma.module.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { questions: true } } },
  });

export async function getModuleGraph(key: string) {
  const mod = await prisma.module.findUnique({
    where: { key },
    include: {
      questions: {
        orderBy: { createdAt: "asc" },
        include: {
          options: {
            orderBy: { order: "asc" },
            include: { nextQuestion: { include: { module: true } } },
          },
          _count: { select: { incoming: true } },
        },
      },
    },
  });
  if (!mod) throw ApiError.notFound("MODULE_NOT_FOUND", "That module does not exist.", { key });

  return {
    id: mod.id,
    key: mod.key,
    title: mod.title,
    entryQuestionId: mod.entryQuestionId,
    questions: mod.questions.map((q) => ({
      id: q.id,
      text: q.text,
      isCheckpoint: q.isCheckpoint,
      isEntry: q.id === mod.entryQuestionId,
      incomingCount: q._count.incoming,
      options: q.options.map((o) => ({
        id: o.id,
        label: o.label,
        order: o.order,
        nextQuestionId: o.nextQuestionId,
        nextQuestionText: o.nextQuestion?.text ?? null,
        nextModuleKey: o.nextQuestion?.module.key ?? null,
        switchesModule: Boolean(o.nextQuestion && o.nextQuestion.moduleId !== mod.id),
        isTerminal: o.nextQuestionId === null,
      })),
    })),
  };
}

export const createModule = (data: { key: string; title: string }) => prisma.module.create({ data });

export async function updateModule(
  key: string,
  data: { title?: string; entryQuestionId?: string | null },
) {
  const mod = await prisma.module.findUnique({ where: { key } });
  if (!mod) throw ApiError.notFound("MODULE_NOT_FOUND", "That module does not exist.", { key });

  if (data.entryQuestionId) {
    const entry = await prisma.question.findUnique({ where: { id: data.entryQuestionId } });
    if (!entry) {
      throw ApiError.notFound("QUESTION_NOT_FOUND", "That entry question does not exist.", {
        questionId: data.entryQuestionId,
      });
    }
    if (entry.moduleId !== mod.id) {
      throw ApiError.badRequest(
        "VALIDATION_ERROR",
        "The entry question must belong to this module.",
        { questionId: entry.id, moduleId: mod.id },
      );
    }
  }

  return prisma.module.update({ where: { key }, data });
}

export async function deleteModule(key: string) {
  const mod = await prisma.module.findUnique({ where: { key }, include: { questions: true } });
  if (!mod) throw ApiError.notFound("MODULE_NOT_FOUND", "That module does not exist.", { key });

  // Options in OTHER modules may jump into this one. Deleting would strand them,
  // so refuse and name them - the same guard the FK enforces, with a usable message.
  const incoming = await prisma.option.count({
    where: { nextQuestion: { moduleId: mod.id }, question: { moduleId: { not: mod.id } } },
  });
  if (incoming > 0) {
    throw ApiError.conflict(
      "CONFLICT",
      `${incoming} option(s) in other modules point into this module. Repoint them first.`,
      { incoming },
    );
  }

  // Clear the entry pointer first so it does not block deleting its own question.
  await prisma.module.update({ where: { key }, data: { entryQuestionId: null } });
  await prisma.option.deleteMany({ where: { question: { moduleId: mod.id } } });
  return prisma.module.delete({ where: { key } });
}

// ---------------------------------------------------------------- questions

export async function createQuestion(data: {
  moduleKey: string;
  text: string;
  isCheckpoint?: boolean;
  makeEntry?: boolean;
}) {
  const mod = await prisma.module.findUnique({ where: { key: data.moduleKey } });
  if (!mod) {
    throw ApiError.notFound("MODULE_NOT_FOUND", "That module does not exist.", {
      moduleKey: data.moduleKey,
    });
  }

  const question = await prisma.question.create({
    data: { moduleId: mod.id, text: data.text, isCheckpoint: data.isCheckpoint ?? false },
  });

  // The first question in a module becomes its entry unless told otherwise -
  // a module with no entry cannot be started, and that is a silly way to fail.
  if (data.makeEntry || !mod.entryQuestionId) {
    await prisma.module.update({ where: { id: mod.id }, data: { entryQuestionId: question.id } });
  }
  return question;
}

export const updateQuestion = (id: string, data: { text?: string; isCheckpoint?: boolean }) =>
  prisma.question.update({ where: { id }, data }).catch(notFound("QUESTION_NOT_FOUND", id));

export async function deleteQuestion(id: string) {
  const question = await prisma.question.findUnique({
    where: { id },
    include: { incoming: { include: { question: { include: { module: true } } } } },
  });
  if (!question) {
    throw ApiError.notFound("QUESTION_NOT_FOUND", "That question does not exist.", { id });
  }

  if (question.incoming.length > 0) {
    throw ApiError.conflict(
      "CONFLICT",
      `${question.incoming.length} option(s) point to this question. Repoint or delete them first.`,
      {
        referencedBy: question.incoming.map((o) => ({
          optionId: o.id,
          label: o.label,
          fromQuestionId: o.questionId,
          fromModuleKey: o.question.module.key,
        })),
      },
    );
  }

  await prisma.module.updateMany({
    where: { entryQuestionId: id },
    data: { entryQuestionId: null },
  });
  return prisma.question.delete({ where: { id } });
}

// ---------------------------------------------------------------- options

export async function createOption(data: {
  questionId: string;
  label: string;
  nextQuestionId?: string | null;
  order?: number;
}) {
  await requireQuestion(data.questionId, "questionId");
  if (data.nextQuestionId) await requireQuestion(data.nextQuestionId, "nextQuestionId");

  const count = await prisma.option.count({ where: { questionId: data.questionId } });
  return prisma.option.create({
    data: {
      questionId: data.questionId,
      label: data.label,
      nextQuestionId: data.nextQuestionId ?? null,
      order: data.order ?? count,
    },
  });
}

export async function updateOption(
  id: string,
  data: { label?: string; nextQuestionId?: string | null; order?: number },
) {
  if (data.nextQuestionId) await requireQuestion(data.nextQuestionId, "nextQuestionId");
  return prisma.option.update({ where: { id }, data }).catch(notFound("OPTION_NOT_FOUND", id));
}

export const deleteOption = (id: string) =>
  prisma.option.delete({ where: { id } }).catch(notFound("OPTION_NOT_FOUND", id));

// ---------------------------------------------------------------- validation

export interface FlowIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  questionId?: string;
  optionId?: string;
}

/**
 * Static analysis of a module's graph. The engine already handles a broken flow
 * at runtime; this lets an author see the breakage before a user walks into it.
 */
export async function validateModule(key: string): Promise<{ ok: boolean; issues: FlowIssue[] }> {
  const graph = await getModuleGraph(key);
  const issues: FlowIssue[] = [];

  if (!graph.entryQuestionId) {
    issues.push({
      severity: "error",
      code: "NO_ENTRY_QUESTION",
      message: "This module has no entry question, so it cannot be started.",
    });
  }

  for (const q of graph.questions) {
    if (q.options.length === 0) {
      issues.push({
        severity: "warning",
        code: "DEAD_END",
        message: `"${q.text}" has no options, so the flow stops there with no way to finish.`,
        questionId: q.id,
      });
    }
    for (const o of q.options) {
      if (o.switchesModule) {
        issues.push({
          severity: "info",
          code: "MODULE_SWITCH",
          message: `"${o.label}" moves the user to module "${o.nextModuleKey}".`,
          questionId: q.id,
          optionId: o.id,
        });
      }
    }
  }

  // Reachability from the entry question, staying inside this module.
  const byId = new Map(graph.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  const queue = graph.entryQuestionId ? [graph.entryQuestionId] : [];
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const o of byId.get(current)?.options ?? []) {
      if (o.nextQuestionId && byId.has(o.nextQuestionId)) queue.push(o.nextQuestionId);
    }
  }

  for (const q of graph.questions) {
    // A question reachable only from another module is fine; one nothing points
    // at is orphaned content.
    if (!seen.has(q.id) && q.incomingCount === 0) {
      issues.push({
        severity: "warning",
        code: "UNREACHABLE",
        message: `"${q.text}" cannot be reached from the entry question.`,
        questionId: q.id,
      });
    }
  }

  return { ok: !issues.some((i) => i.severity === "error"), issues };
}

// ---------------------------------------------------------------- helpers

async function requireQuestion(id: string, field: string) {
  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) {
    throw ApiError.notFound("QUESTION_NOT_FOUND", `No question found for ${field}.`, { [field]: id });
  }
  return question;
}

/** Turns Prisma's P2025 ("record not found") into our own 404. */
const notFound =
  (code: "QUESTION_NOT_FOUND" | "OPTION_NOT_FOUND", id: string) =>
  (err: unknown): never => {
    if ((err as { code?: string })?.code === "P2025") {
      throw ApiError.notFound(code, "That record does not exist.", { id });
    }
    throw err;
  };
