import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/errors.js";
import * as catalog from "./catalog.service.js";

const id = z.string().min(1);
const key = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens.");

const createModuleBody = z.object({ key, title: z.string().min(1) });
const updateModuleBody = z
  .object({ title: z.string().min(1).optional(), entryQuestionId: id.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const createQuestionBody = z.object({
  moduleKey: key,
  text: z.string().min(1),
  isCheckpoint: z.boolean().optional(),
  makeEntry: z.boolean().optional(),
});
const updateQuestionBody = z
  .object({ text: z.string().min(1).optional(), isCheckpoint: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const createOptionBody = z.object({
  questionId: id,
  label: z.string().min(1),
  nextQuestionId: id.nullable().optional(),
  order: z.number().int().min(0).optional(),
});
const updateOptionBody = z
  .object({
    label: z.string().min(1).optional(),
    nextQuestionId: id.nullable().optional(),
    order: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// ---------------------------------------------------------------- modules

export const moduleRoutes: Router = Router();

moduleRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ modules: await catalog.listModules() });
  }),
);

moduleRoutes.get(
  "/:key",
  asyncHandler(async (req, res) => {
    res.json(await catalog.getModuleGraph(req.params.key));
  }),
);

/** Same payload as GET /:key - kept as an explicit route because the admin UI asks for a graph. */
moduleRoutes.get(
  "/:key/graph",
  asyncHandler(async (req, res) => {
    res.json(await catalog.getModuleGraph(req.params.key));
  }),
);

moduleRoutes.get(
  "/:key/validate",
  asyncHandler(async (req, res) => {
    res.json(await catalog.validateModule(req.params.key));
  }),
);

moduleRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createModule(createModuleBody.parse(req.body)));
  }),
);

moduleRoutes.patch(
  "/:key",
  asyncHandler(async (req, res) => {
    res.json(await catalog.updateModule(req.params.key, updateModuleBody.parse(req.body)));
  }),
);

moduleRoutes.delete(
  "/:key",
  asyncHandler(async (req, res) => {
    await catalog.deleteModule(req.params.key);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- questions

export const questionRoutes: Router = Router();

questionRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createQuestion(createQuestionBody.parse(req.body)));
  }),
);

questionRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await catalog.updateQuestion(req.params.id, updateQuestionBody.parse(req.body)));
  }),
);

questionRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await catalog.deleteQuestion(req.params.id);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- options

export const optionRoutes: Router = Router();

optionRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    res.status(201).json(await catalog.createOption(createOptionBody.parse(req.body)));
  }),
);

optionRoutes.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await catalog.updateOption(req.params.id, updateOptionBody.parse(req.body)));
  }),
);

optionRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await catalog.deleteOption(req.params.id);
    res.status(204).end();
  }),
);
