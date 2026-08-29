import type { QuestionView } from "../api/client";

interface Props {
  question: QuestionView;
  step: number;
  busy: boolean;
  onAnswer: (optionId: string) => void;
}

export function QuestionCard({ question, step, busy, onAnswer }: Props) {
  return (
    <>
      <div className="stepline">
        <span className="step">Step {step}</span>
        <span>·</span>
        <span>{question.module.title}</span>
      </div>

      <section className="card">
        <div className="card-head">
          <span className="eyebrow">{question.module.key}</span>
          {question.isCheckpoint && (
            <span
              className="pill pill-checkpoint"
              title="Answers before this point stay in your history but no longer affect the flow"
            >
              checkpoint
            </span>
          )}
        </div>

        <h2 className="question">{question.text}</h2>

        <ul className="options">
          {question.options.map((option) => (
            <li key={option.id}>
              <button
                className="option"
                disabled={busy || option.isBroken}
                onClick={() => onAnswer(option.id)}
              >
                <span className="option-label">
                  <span className="option-dot" aria-hidden="true" />
                  {option.label}
                </span>
                <span className="option-tags">
                  {option.switchesToModuleKey && (
                    <span className="tag tag-switch">&rarr; {option.switchesToModuleKey}</span>
                  )}
                  {option.nextQuestionId === null && <span className="tag">ends module</span>}
                  {option.isBroken && <span className="tag tag-bad">broken link</span>}
                </span>
              </button>
            </li>
          ))}
          {question.options.length === 0 && (
            <li className="muted">This question has no options. Pick another module to continue.</li>
          )}
        </ul>

        <p className="qid">
          question id <code>{question.id}</code> — copy it to try an out-of-date deep link
        </p>
      </section>
    </>
  );
}
