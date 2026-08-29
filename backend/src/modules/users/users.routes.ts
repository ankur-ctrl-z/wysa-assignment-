import { Router } from "express";
import { z } from "zod";
import { asyncHandler, ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

// No auth in this exercise: a user is just an id you pass around. Everything
// user-scoped keys off it, so adding real auth later means resolving the id from
// a token instead of the path, and nothing else changes.
const createUserBody = z.object({ name: z.string().min(1) });

export const userRoutes: Router = Router();

userRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ users: await prisma.user.findMany({ orderBy: { createdAt: "asc" } }) });
  }),
);

userRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw ApiError.notFound("USER_NOT_FOUND", "That user does not exist.", { id: req.params.id });
    res.json(user);
  }),
);

userRoutes.post(
  "/",
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.user.create({ data: createUserBody.parse(req.body) }));
  }),
);

/**
 * Deletes the user and, with them, their entire conversation history and module
 * state. Both ConversationEvent.user and UserModuleState.user are declared
 * `onDelete: Cascade`, so this single delete removes every trace in one statement
 * rather than three that could partially fail.
 *
 * Content (modules, questions, options) is untouched — it belongs to the flow,
 * not to any user.
 */
userRoutes.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.user.delete({ where: { id: req.params.id } }).catch((err: unknown) => {
      if ((err as { code?: string })?.code === "P2025") {
        throw ApiError.notFound("USER_NOT_FOUND", "That user does not exist.", { id: req.params.id });
      }
      throw err;
    });
    res.status(204).end();
  }),
);
