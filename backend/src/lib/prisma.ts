import { PrismaClient } from "@prisma/client";

// One client for the process. tsx watch reloads the module graph, so stash it on
// globalThis to avoid leaking a connection pool per reload in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "production" ? ["error"] : ["error", "warn"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
