/**
 * Seed data - six modules of a pet-care conversation, deliberately awkward.
 *
 * It is written as one declarative FLOW array so the shape of the conversation is
 * readable at a glance and editable without touching any logic. Refs ("p1", "t7")
 * are seed-local names; a cross-module link is just a ref belonging to another
 * module, exactly as the data model intends - there is no "switch module" concept
 * to configure.
 *
 * The content is shaped to exercise every case the assignment asks about:
 *   - 50 questions across 6 modules, chains up to 9 questions deep
 *   - symptom-triage forks on severity into a long urgent path and a short one
 *   - 8 checkpoints (p6, p9, t7, t10, a7, n7, m7, s7)
 *   - loops back across a checkpoint (p6 -> p2, t7 -> t1, a7 -> a2, n7 -> n2,
 *     m7 -> m1, s7 -> s1) - this is what makes the watermark observable
 *   - 15 cross-module jumps, so switching modules repeatedly and returning to a
 *     previously visited module are both reachable by clicking:
 *
 *       intake      -> support, nutrition, meds, appointment
 *       triage      -> appointment, support, nutrition
 *       appointment -> triage, meds, support
 *       nutrition   -> support
 *       meds        -> triage, appointment
 *       support     -> triage, appointment, intake
 *
 *   - terminal options (next: null) in every module
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedOption {
  label: string;
  /** ref of the next question, or null to end the module. */
  next: string | null;
}

interface SeedQuestion {
  ref: string;
  text: string;
  entry?: boolean;
  checkpoint?: boolean;
  options: SeedOption[];
}

interface SeedModule {
  key: string;
  title: string;
  questions: SeedQuestion[];
}

const FLOW: SeedModule[] = [
  // ---------------------------------------------------------------- 1 of 6
  {
    key: "new-pet-intake",
    title: "New Pet Intake",
    questions: [
      {
        ref: "p1",
        text: "Welcome! Which pet are you registering today?",
        entry: true,
        options: [
          { label: "A dog", next: "p2" },
          { label: "A cat", next: "p2" },
          { label: "Another kind of pet", next: "p2" },
          { label: "Actually, I need help with something else", next: "s1" },
        ],
      },
      {
        ref: "p2",
        text: "How old are they?",
        options: [
          { label: "Under a year", next: "p3" },
          { label: "One to seven years", next: "p3" },
          { label: "Older than seven", next: "p3" },
        ],
      },
      {
        ref: "p3",
        text: "Have they seen a vet before?",
        options: [
          { label: "Yes, and we have the records", next: "p4" },
          { label: "No, this would be their first visit", next: "p5" },
        ],
      },
      {
        ref: "p4",
        text: "Can you share those records now?",
        options: [
          { label: "Yes, I have them to hand", next: "p5" },
          { label: "I will send them later", next: "p5" },
        ],
      },
      {
        ref: "p5",
        text: "Are they spayed or neutered?",
        options: [
          { label: "Yes", next: "p6" },
          { label: "No", next: "p6" },
          { label: "I am not sure", next: "p6" },
        ],
      },
      {
        ref: "p6",
        text: "Thanks - the basics are saved. Where would you like to go next?",
        checkpoint: true,
        options: [
          { label: "Set up their diet", next: "n1" },
          { label: "Record vaccinations", next: "m1" },
          { label: "Keep going here", next: "p7" },
          { label: "Start the details over", next: "p2" },
        ],
      },
      {
        ref: "p7",
        text: "Any known allergies?",
        options: [
          { label: "None that we know of", next: "p8" },
          { label: "Yes, to certain foods", next: "p8" },
          { label: "Yes, to a medication", next: "m1" },
        ],
      },
      {
        ref: "p8",
        text: "Who is the main contact for this pet?",
        options: [
          { label: "Me", next: "p9" },
          { label: "Someone else in the household", next: "p9" },
        ],
      },
      {
        ref: "p9",
        text: "Registration complete. Anything else while you are here?",
        checkpoint: true,
        options: [
          { label: "Book a first appointment", next: "a1" },
          { label: "Set up a nutrition plan", next: "n1" },
          { label: "No, I am done", next: null },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 2 of 6
  {
    key: "symptom-triage",
    title: "Symptom Triage",
    questions: [
      {
        ref: "t1",
        text: "What have you noticed?",
        entry: true,
        options: [
          { label: "They are not eating or drinking", next: "t2" },
          { label: "They are limping or seem in pain", next: "t2" },
          { label: "Vomiting or diarrhoea", next: "t2" },
          { label: "Something about their behaviour", next: "t3" },
        ],
      },
      {
        ref: "t2",
        text: "How long has this been going on?",
        options: [
          { label: "Since today", next: "t4" },
          { label: "Two or three days", next: "t4" },
          { label: "More than a week", next: "t5" },
        ],
      },
      {
        ref: "t3",
        text: "Has anything changed at home recently?",
        options: [
          { label: "We moved or travelled", next: "t5" },
          { label: "A new pet or person in the house", next: "t5" },
          { label: "Nothing has changed", next: "t4" },
        ],
      },
      {
        ref: "t4",
        text: "How would you rate it right now?",
        options: [
          { label: "Mild - they seem mostly themselves", next: "t9" },
          { label: "Moderate - they are clearly off", next: "t5" },
          { label: "Severe - I am worried", next: "t6" },
        ],
      },
      {
        ref: "t5",
        text: "Are they eating and drinking normally?",
        options: [
          { label: "Both, as usual", next: "t9" },
          { label: "Drinking but not eating", next: "t6" },
          { label: "Neither", next: "t6" },
        ],
      },
      {
        ref: "t6",
        text: "Right now, are you seeing laboured breathing, collapse, or bleeding?",
        options: [
          { label: "Yes, one of those", next: "t7" },
          { label: "No, none of those", next: "t8" },
        ],
      },
      {
        ref: "t7",
        text: "That needs to be seen today. Booking is the next step.",
        checkpoint: true,
        options: [
          { label: "Book the earliest appointment", next: "a1" },
          { label: "Talk to someone first", next: "s1" },
          { label: "Describe the symptoms again", next: "t1" },
        ],
      },
      {
        ref: "t8",
        text: "Has their temperature or energy level changed?",
        options: [
          { label: "They feel hot, or seem very lethargic", next: "t7" },
          { label: "No obvious change", next: "t9" },
        ],
      },
      {
        ref: "t9",
        text: "Would you like us to keep an eye on this?",
        options: [
          { label: "Yes, remind me in two days", next: "t10" },
          { label: "No, I will watch them myself", next: "t10" },
        ],
      },
      {
        ref: "t10",
        text: "Triage saved. What now?",
        checkpoint: true,
        options: [
          { label: "Book an appointment anyway", next: "a1" },
          { label: "Review what they are eating", next: "n1" },
          { label: "Start a new triage", next: "t1" },
          { label: "Nothing for now", next: null },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 3 of 6
  {
    key: "appointment",
    title: "Book an Appointment",
    questions: [
      {
        ref: "a1",
        text: "What kind of visit is this?",
        entry: true,
        options: [
          { label: "A routine check-up", next: "a2" },
          { label: "Something is wrong", next: "t1" },
          { label: "A vaccination", next: "m1" },
          { label: "A follow-up visit", next: "a2" },
        ],
      },
      {
        ref: "a2",
        text: "Which clinic works best for you?",
        options: [
          { label: "The main clinic", next: "a3" },
          { label: "The branch clinic", next: "a3" },
          { label: "Either is fine", next: "a3" },
        ],
      },
      {
        ref: "a3",
        text: "How soon do you need to come in?",
        options: [
          { label: "Today if at all possible", next: "a4" },
          { label: "Sometime this week", next: "a4" },
          { label: "Next week or later", next: "a5" },
        ],
      },
      {
        ref: "a4",
        text: "Are you able to travel to the clinic?",
        options: [
          { label: "Yes", next: "a5" },
          { label: "No, I need a home visit", next: "a5" },
        ],
      },
      {
        ref: "a5",
        text: "What time of day suits you?",
        options: [
          { label: "Morning", next: "a6" },
          { label: "Afternoon", next: "a6" },
          { label: "Evening", next: "a6" },
        ],
      },
      {
        ref: "a6",
        text: "Would you like a reminder beforehand?",
        options: [
          { label: "Text me", next: "a7" },
          { label: "Email me", next: "a7" },
          { label: "No reminder", next: "a7" },
        ],
      },
      {
        ref: "a7",
        text: "Appointment request saved. Anything else?",
        checkpoint: true,
        options: [
          { label: "Change the details", next: "a2" },
          { label: "Add a note for the vet", next: "a8" },
          { label: "Ask a question first", next: "s1" },
          { label: "No, that is all", next: null },
        ],
      },
      {
        ref: "a8",
        text: "Anything the vet should know before the visit?",
        options: [
          { label: "They are nervous around strangers", next: null },
          { label: "They are on medication", next: "m1" },
          { label: "Nothing to add", next: null },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 4 of 6
  {
    key: "nutrition-plan",
    title: "Nutrition Plan",
    questions: [
      {
        ref: "n1",
        text: "What are they eating at the moment?",
        entry: true,
        options: [
          { label: "Dry food", next: "n2" },
          { label: "Wet food", next: "n2" },
          { label: "A mix of both", next: "n2" },
          { label: "Home-cooked or raw", next: "n3" },
        ],
      },
      {
        ref: "n2",
        text: "How many meals a day?",
        options: [
          { label: "One", next: "n4" },
          { label: "Two", next: "n4" },
          { label: "Food is always available", next: "n4" },
        ],
      },
      {
        ref: "n3",
        text: "Are you following a recipe from a vet?",
        options: [
          { label: "Yes", next: "n4" },
          { label: "No", next: "n4" },
        ],
      },
      {
        ref: "n4",
        text: "How is their weight?",
        options: [
          { label: "About right", next: "n5" },
          { label: "A little over", next: "n5" },
          { label: "A little under", next: "n5" },
          { label: "I am not sure", next: "n5" },
        ],
      },
      {
        ref: "n5",
        text: "Is there any food they react badly to?",
        options: [
          { label: "Yes, we know of some", next: "n6" },
          { label: "None that we know of", next: "n6" },
        ],
      },
      {
        ref: "n6",
        text: "How much exercise do they get?",
        options: [
          { label: "Barely any", next: "n7" },
          { label: "A walk or two a day", next: "n7" },
          { label: "They are very active", next: "n7" },
        ],
      },
      {
        ref: "n7",
        text: "Plan saved. What would you like to do?",
        checkpoint: true,
        options: [
          { label: "Adjust the answers", next: "n2" },
          { label: "See the feeding schedule", next: "n8" },
          { label: "Ask about a specific food", next: "s1" },
          { label: "Done", next: null },
        ],
      },
      {
        ref: "n8",
        text: "Should we send the schedule as a reminder?",
        options: [
          { label: "Yes, weekly", next: null },
          { label: "No thanks", next: null },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 5 of 6
  {
    key: "meds-vaccines",
    title: "Medication & Vaccines",
    questions: [
      {
        ref: "m1",
        text: "What would you like to record?",
        entry: true,
        options: [
          { label: "A vaccination", next: "m2" },
          { label: "A medication", next: "m3" },
          { label: "Both", next: "m2" },
        ],
      },
      {
        ref: "m2",
        text: "Which vaccinations have they had?",
        options: [
          { label: "All of the core ones", next: "m4" },
          { label: "Some of them", next: "m4" },
          { label: "None yet", next: "m4" },
          { label: "I do not know", next: "m4" },
        ],
      },
      {
        ref: "m3",
        text: "Is this a long-term medication?",
        options: [
          { label: "Yes, ongoing", next: "m4" },
          { label: "No, a short course", next: "m4" },
        ],
      },
      {
        ref: "m4",
        text: "Have they ever reacted to a vaccine or medicine?",
        options: [
          { label: "Yes", next: "m5" },
          { label: "No", next: "m6" },
          { label: "Not that I know of", next: "m6" },
        ],
      },
      {
        ref: "m5",
        text: "How serious was that reaction?",
        options: [
          { label: "Mild - a sore spot or some tiredness", next: "m6" },
          { label: "Serious - they needed to be seen", next: "t1" },
        ],
      },
      {
        ref: "m6",
        text: "Would you like reminders when the next dose is due?",
        options: [
          { label: "Yes please", next: "m7" },
          { label: "No thanks", next: "m7" },
        ],
      },
      {
        ref: "m7",
        text: "Saved. Anything else?",
        checkpoint: true,
        options: [
          { label: "Record another one", next: "m1" },
          { label: "Book the next dose", next: "a1" },
          { label: "No, I am done", next: null },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- 6 of 6
  {
    key: "support",
    title: "Support",
    questions: [
      {
        ref: "s1",
        text: "What do you need help with?",
        entry: true,
        options: [
          { label: "My account", next: "s2" },
          { label: "A booking", next: "s3" },
          { label: "Something about my pet", next: "t1" },
          { label: "Something else", next: "s4" },
        ],
      },
      {
        ref: "s2",
        text: "Are you able to sign in?",
        options: [
          { label: "Yes", next: "s5" },
          { label: "No", next: "s5" },
        ],
      },
      {
        ref: "s3",
        text: "Which booking is this about?",
        options: [
          { label: "One I have already made", next: "s5" },
          { label: "One I am trying to make", next: "a1" },
        ],
      },
      {
        ref: "s4",
        text: "How would you describe it?",
        options: [
          { label: "A problem with the app", next: "s5" },
          { label: "A question about a service", next: "s5" },
          { label: "Feedback", next: "s6" },
        ],
      },
      {
        ref: "s5",
        text: "Have you tried anything already?",
        options: [
          { label: "Yes, and it did not help", next: "s6" },
          { label: "No, not yet", next: "s6" },
        ],
      },
      {
        ref: "s6",
        text: "How urgent is this?",
        options: [
          { label: "It can wait", next: "s7" },
          { label: "I need help today", next: "s7" },
        ],
      },
      {
        ref: "s7",
        text: "Logged. How should we follow up?",
        checkpoint: true,
        options: [
          { label: "Email me", next: "s8" },
          { label: "Call me", next: "s8" },
          { label: "Start over", next: "s1" },
          { label: "No follow-up needed", next: null },
        ],
      },
      {
        ref: "s8",
        text: "Anything else before we close this?",
        options: [
          { label: "Register another pet", next: "p1" },
          { label: "Book an appointment", next: "a1" },
          { label: "No, that is all", next: null },
        ],
      },
    ],
  },
];

const USERS = ["Ada", "Grace"];

async function main() {
  if ((await prisma.module.count()) > 0) {
    console.log("Modules already exist - skipping seed. Use `npm run seed -- --force` to replace.");
    return;
  }

  // Pass 1: modules and questions, so every ref exists before anything links to it.
  const ids = new Map<string, string>();
  const modules = new Map<string, string>();

  for (const mod of FLOW) {
    const created = await prisma.module.create({ data: { key: mod.key, title: mod.title } });
    modules.set(mod.key, created.id);
    for (const q of mod.questions) {
      const question = await prisma.question.create({
        data: { moduleId: created.id, text: q.text, isCheckpoint: q.checkpoint ?? false },
      });
      ids.set(q.ref, question.id);
    }
  }

  // Pass 2: options (including cross-module targets) and entry pointers.
  for (const mod of FLOW) {
    for (const q of mod.questions) {
      await prisma.option.createMany({
        data: q.options.map((o, order) => ({
          questionId: ids.get(q.ref)!,
          label: o.label,
          order,
          nextQuestionId: o.next ? (ids.get(o.next) ?? null) : null,
        })),
      });
      if (q.entry) {
        await prisma.module.update({
          where: { id: modules.get(mod.key)! },
          data: { entryQuestionId: ids.get(q.ref)! },
        });
      }
    }
  }

  for (const name of USERS) await prisma.user.create({ data: { name } });

  console.log(`Seeded ${FLOW.length} modules, ${ids.size} questions, ${USERS.length} users.`);
}

async function reset() {
  // Order matters: options reference questions, modules reference an entry question.
  await prisma.conversationEvent.deleteMany();
  await prisma.userModuleState.deleteMany();
  await prisma.module.updateMany({ data: { entryQuestionId: null } });
  await prisma.option.deleteMany();
  await prisma.question.deleteMany();
  await prisma.module.deleteMany();
  await prisma.user.deleteMany();
}

const run = process.argv.includes("--force") ? reset().then(main) : main();

run
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
