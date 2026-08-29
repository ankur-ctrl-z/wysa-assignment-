import cors from "cors";
import express, { type Express } from "express";
import { api } from "./routes.js";
import { errorHandler } from "./lib/errors.js";

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true }));
  app.use(express.json());

  app.use("/api", api);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "No such endpoint." } });
  });
  app.use(errorHandler);

  return app;
}
