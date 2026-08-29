import { Router } from "express";
import { userRoutes } from "./modules/users/users.routes.js";
import { moduleRoutes, optionRoutes, questionRoutes } from "./modules/catalog/catalog.routes.js";
import { flowRoutes } from "./modules/flow/flow.routes.js";

// The only file that knows every module exists. Adding a feature means adding a
// folder under src/modules and one line here.
export const api: Router = Router();

api.get("/health", (_req, res) => {
  res.json({ ok: true });
});

api.use("/users", userRoutes);
api.use("/modules", moduleRoutes);
api.use("/questions", questionRoutes);
api.use("/options", optionRoutes);
api.use("/flow", flowRoutes);
