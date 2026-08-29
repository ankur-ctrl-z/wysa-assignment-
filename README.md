# Modular Conversation Flow System

A question-based conversation system where users answer questions and their answers decide what question comes next.

The project supports:

* Multiple conversation modules
* Different paths based on user answers
* Moving from one module to another
* Checkpoints that reset the active context
* Complete conversation history
* Back navigation
* Deep links to questions
* Admin UI for managing modules, questions, and options

## Tech Stack

* **Frontend:** React + Vite + TypeScript
* **Backend:** Node.js + Express + TypeScript
* **Database:** PostgreSQL
* **ORM:** Prisma
* **Docker:** Docker Compose

---

# Getting Started

The easiest way to run the complete project is with Docker.

## 1. Clone the project

```bash
git clone <your-repository-url>
cd <project-folder>
```

## 2. Start the project

**MAKE SURE DOCKER DESKTOP IS INSTALLED AND RUNNING.**
Open the docker desktop on your computer and the run the next command on your terminal

Then run:

```bash
docker compose up --build
```

This will:

1. Start PostgreSQL
2. Start the backend
3. Start the frontend
4. Run database migrations
5. Seed the database with sample conversation data

You do not need to install Node.js or PostgreSQL separately when using Docker.

## 3. Open the application

Once Docker finishes starting the containers, open:

```text
http://localhost:5173
```

This is the main application where you can go through the conversation.

### Admin Panel

```text
http://localhost:5173/admin
```

This is where you can manage modules, questions, and options.

### Backend API

```text
http://localhost:3000/api
```

### PostgreSQL

```text
localhost:5432
```

---

# How to Navigate the Application

## Player UI

Open:

```text
http://localhost:5173
```

The Player UI is where you interact with the conversation.

A typical flow is:

```text
Start
  ↓
Question
  ↓
Select an option
  ↓
Next question
  ↓
Another question
  ↓
Checkpoint / Module switch / Completion
```

The next question depends on the option you select.

Some options can move you to another module.

For example:

```text
New Pet Intake
      ↓
"Need help with something else?"
      ↓
Support
      ↓
"Register another pet"
      ↓
New Pet Intake
```

### History

The history panel shows the user's previous actions.

History is never deleted when a checkpoint is reached.

Instead, older events are marked as being outside the current live context.

### Back

The **Back** button moves one step backward.

It cannot go back across a checkpoint.

---

# Admin UI

Open:

```text
http://localhost:5173/admin
```

The Admin UI is used to manage the conversation flow.

You can:

* Create modules
* Edit modules
* Delete modules
* Create questions
* Edit questions
* Delete questions
* Create options
* Edit options
* Delete options
* View the module graph
* Validate a module

---

# Project Structure

```text
backend/
├── prisma/
│   └── schema.prisma
│
├── src/
│   ├── seed.ts
│   ├── routes.ts
│   │
│   ├── lib/
│   │   ├── prisma.ts
│   │   └── ...
│   │
│   └── modules/
│       ├── users/
│       ├── catalog/
│       └── flow/
│           ├── flow.rules.ts
│           ├── flow.service.ts
│           └── flow.routes.ts
│
└── tests/
    ├── rules.test.ts
    └── flow.e2e.test.ts

frontend/
└── src/
    ├── api/
    │   └── client.ts
    │
    ├── pages/
    │   ├── PlayerPage.tsx
    │   └── AdminPage.tsx
    │
    └── components/
```

# How the Conversation Flow Works

The system separates three things:

### 1. Content

This defines what the conversation looks like.

```text
Module
Question
Option
```

### 2. History

This stores everything the user has done.

```text
ConversationEvent
```

History is append-only. Previous events are not changed or removed.

### 3. State

This stores where the user currently is.

```text
User
UserModuleState
```

This separation makes checkpoints and navigation easier to manage.

---

# Checkpoints

Some questions are marked as checkpoints.

When a user reaches a checkpoint, the system starts a new context from that point.

Old history is still available, but it no longer affects the current flow.

For example:

```text
Question 1
   ↓
Question 2
   ↓
Checkpoint
   ↓
Question 4
   ↓
Question 5
```

After reaching the checkpoint, the user cannot use **Back** to cross it.

The old history is still visible.

---

# Sample Data

The project comes with sample data containing:

* 6 modules
* 50 questions
* 8 checkpoints
* Multiple branching paths
* Cross-module navigation
* Completed flows
* Long question chains

The modules are:

| Module                | Questions |
| --------------------- | --------: |
| New Pet Intake        |         9 |
| Symptom Triage        |        10 |
| Book an Appointment   |         8 |
| Nutrition Plan        |         8 |
| Medication & Vaccines |         7 |
| Support               |         8 |

The sample data is defined in:

```text
backend/src/seed.ts
```

---

# Running Without Docker

Docker is recommended because it runs the complete project with minimal setup.

If you want to run the backend and frontend directly on your machine, PostgreSQL still needs to be running.

## 1. Start PostgreSQL

You can use Docker only for PostgreSQL:

```bash
docker compose up -d db
```

## 2. Start the backend

```bash
cd backend
npm install
npx prisma migrate deploy
npm run seed
npm run dev
```

Backend:

```text
http://localhost:3000
```

## 3. Start the frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend:

```text
http://localhost:5173
```

The frontend is configured to send `/api` requests to the backend.

---

# Environment Variables

The backend uses:

```text
backend/.env
```

The default database URL is:

```env
DATABASE_URL="postgresql://USERNAME:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

---
