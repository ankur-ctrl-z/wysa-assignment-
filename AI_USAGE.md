# AI Usage

AI was used as a development assistant during the project. Generated code was reviewed, tested separately, and modified before being integrated into the final project.

## 1. Tools Used

| Tool | Used For |
|---|---|
| **Claude** | Backend APIs, implementation support, debugging, tests, and development assistance |
| **Gemini** | Frontend component structure and development assistance |

Both tools were used at different stages of the project rather than relying on a single AI tool.

---

## 2. Development Process

The project was first set up manually with:

- React + TypeScript for the frontend
- Node.js + Express + TypeScript for the backend
- Prisma as the ORM
- PostgreSQL running through Docker

The database structure was designed first and added to `schema.prisma`. After that, Prisma migrations were created and applied.

The backend API requirements were then explained to Claude, including how the APIs should communicate with the frontend and how the conversation flow should work. The generated backend code was tested independently using Postman before being integrated into the project.

Some generated code needed changes. For example, the Zod validation schemas did not correctly match the Prisma/database schema, so they were fixed and tested again. Rate limiting was also added to specific routes.

For the frontend, the UI was built component by component:

- `HistoryPanel.tsx`
- `ModuleList.tsx`
- `QuestionsCard.tsx`
- `UserPicker.tsx`

Gemini was used to help with the initial structure of these components. API calls were then added and the frontend was tested against the running backend.

After the frontend and backend were working correctly, Dockerfiles were created for both applications and Docker Compose was used to run the frontend, backend, and PostgreSQL together.

---

## 3. Important AI-Assisted Changes

The generated code was not accepted without testing. A few important issues were found and fixed during development:

- The initial **Back** logic did not work correctly when pressing Back multiple times. It was changed to replay the live events as a stack, where `ANSWERED` pushes and `BACK` pops.
- Module switching initially marked the previous module as completed. This was changed so leaving a module is different from completing it.
- `contextResetSeq` was also updated when entering a module to prevent Back navigation from crossing the module boundary.
- The seed file was moved to `src/seed.ts` so it could be compiled and used correctly in the production Docker image.
- Question deletion was changed to use `Restrict` so questions referenced by options cannot be deleted accidentally.
- The Zod schemas were corrected to match the actual database structure.

---

## 4. Testing and Verification

The generated code was tested separately before being integrated, and the complete application was tested again after integration.

The project includes tests for:

- Conversation flow rules
- Back navigation
- Checkpoints
- Module switching
- Deep links
- Stale questions
- Invalid options and IDs
- Module completion
- Restarting a module

The backend APIs were also tested using Postman and `curl`.

The complete stack was tested using:

```bash
docker compose up --build

5. Overall AI Usage

AI was mainly used to speed up implementation and provide development assistance. The database design, project setup, API verification, debugging, integration, and final testing were handled and reviewed manually.
