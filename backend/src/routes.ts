import { Router } from "express";
import { userRoutes } from "./modules/users/users.routes.js";
import { moduleRoutes, optionRoutes, questionRoutes } from "./modules/catalog/catalog.routes.js";
import { flowRoutes } from "./modules/flow/flow.routes.js";

export const api: Router = Router();

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

api.use("/users", userRoutes);
api.use("/modules", moduleRoutes);
api.use("/questions", questionRoutes);
api.use("/options", optionRoutes);
api.use("/flow", flowRoutes);
