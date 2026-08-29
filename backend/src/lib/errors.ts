import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";

/**
 * Every failure the API can produce has a stable machine-readable code.
 * Clients branch on `code`, humans read `message`, and `context` carries whatever
 * the client needs to recover — most importantly, the question it should show
 * instead when the one it asked for is stale.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "USER_NOT_FOUND"
  | "MODULE_NOT_FOUND"
  | "MODULE_NOT_STARTED"
  | "MODULE_HAS_NO_ENTRY"
  | "QUESTION_NOT_FOUND"
  | "OPTION_NOT_FOUND"
  | "OPTION_MISMATCH"
  | "STALE_QUESTION"
  | "BROKEN_REFERENCE"
  | "NO_ACTIVE_QUESTION"
  | "NO_PREVIOUS_QUESTION"
  | "CHECKPOINT_BOUNDARY"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  static notFound(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    return new ApiError(code, 404, message, context);
  }

  static badRequest(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    return new ApiError(code, 400, message, context);
  }

  /** 409: the request was well-formed but the user's state has moved on. */
  static conflict(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    return new ApiError(code, 409, message, context);
  }
}

/** Express 4 does not catch rejected promises; this does. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Handlers validate with schema.parse(); the resulting ZodError lands here so
  // every trust-boundary rejection looks like every other API error.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request failed validation.",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.context } });
    return;
  }

  // Prisma unique-constraint violations are the only DB error worth translating;
  // everything else is a bug and should look like one in the logs.
  const code = (err as { code?: string } | null)?.code;
  if (code === "P2002") {
    res.status(409).json({ error: { code: "CONFLICT", message: "That record already exists." } });
    return;
  }
  if (code === "P2003" || code === "P2014") {
    res.status(409).json({
      error: { code: "CONFLICT", message: "Other records still reference this one." },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
}
