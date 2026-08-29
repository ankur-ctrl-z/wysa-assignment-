import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/errors.js";
import * as flow from "./flow.service.js";

const id = z.string().min(1);

const startBody = z.object({ moduleKey: id, restart: z.boolean().optional().default(false) });
const answerBody = z.object({ questionId: id, optionId: id });
const resumeQuery = z.object({ questionId: id.optional() });
const historyQuery = z.object({ moduleKey: id.optional() });

export const flowRoutes: Router = Router({ mergeParams: true });

/** Where the user is, plus their state in every module they have touched. */
flowRoutes.get(
  "/:userId/state",
  asyncHandler(async (req, res) => {
    res.json(await flow.getState(req.params.userId));
  }),
);

/** Complete conversation history. Never filtered by checkpoints. */
flowRoutes.get(
  "/:userId/history",
  asyncHandler(async (req, res) => {
    const { moduleKey } = historyQuery.parse(req.query);
    res.json({ events: await flow.history(req.params.userId, moduleKey) });
  }),
);

/**
 * Deep link / notification entry point.
 * Always 200: if the requested question is stale or gone, the latest valid
 * question is returned instead along with the reason.
 */
flowRoutes.get(
  "/:userId/resume",
  asyncHandler(async (req, res) => {
    const { questionId } = resumeQuery.parse(req.query);
    res.json(await flow.resume(req.params.userId, questionId ?? null));
  }),
);

/** Start a module, or resume it if the user is already partway through. */
flowRoutes.post(
  "/:userId/start",
  asyncHandler(async (req, res) => {
    const { moduleKey, restart } = startBody.parse(req.body);
    res.json(await flow.start(req.params.userId, moduleKey, restart));
  }),
);

/** Answer the current question by choosing one of its options. */
flowRoutes.post(
  "/:userId/answer",
  asyncHandler(async (req, res) => {
    const { questionId, optionId } = answerBody.parse(req.body);
    res.json(await flow.answer(req.params.userId, questionId, optionId));
  }),
);

/** Bonus: step back one question within the current module state. */
flowRoutes.post(
  "/:userId/back",
  asyncHandler(async (req, res) => {
    res.json(await flow.back(req.params.userId));
  }),
);
