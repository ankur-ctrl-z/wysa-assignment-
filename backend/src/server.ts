import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const port = Number(process.env.PORT ?? 3000);
const server = createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}/api`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect().then(() => process.exit(0)));
  });
}
