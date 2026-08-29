import { useState } from "react";
import { adminApi, type GraphQuestion } from "../../api/client";
import { OptionEditor, type QuestionTarget } from "./OptionEditor";

interface Props {
  question: GraphQuestion;
  moduleKey: string;
  targets: QuestionTarget[];
  onChanged: () => void;
}

export function QuestionEditor({ question, moduleKey, targets, onChanged }: Props) {
  const [text, setText] = useState(question.text);
  const [newOption, setNewOption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const guard = (p: Promise<unknown>) =>
    p.then(() => {
      setError(null);
      onChanged();
    }).catch((err: Error) => setError(err.message));

  return (
    <li className={`q-card ${question.isEntry ? "entry" : ""}`}>
      <div className="q-head">
        <textarea
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== question.text && void guard(adminApi.updateQuestion(question.id, { text }))}
        />
        <div className="q-flags">
          {question.isEntry && <span className="pill">entry</span>}
          <label title="Landing here clears the module's live context">
            <input
              type="checkbox"
              checked={question.isCheckpoint}
              onChange={(e) =>
                void guard(adminApi.updateQuestion(question.id, { isCheckpoint: e.target.checked }))
              }
            />
            checkpoint
          </label>
          {!question.isEntry && (
            <button
              className="ghost"
              onClick={() => void guard(adminApi.updateModule(moduleKey, { entryQuestionId: question.id }))}
            >
              Make entry
            </button>
          )}
          <button
            className="ghost danger"
            onClick={() => void guard(adminApi.deleteQuestion(question.id))}
            title={
              question.incomingCount > 0
                ? `${question.incomingCount} option(s) point here`
                : "Delete question"
            }
          >
            Delete
          </button>
        </div>
      </div>

      {error && <div className="notice notice-warn">{error}</div>}

      <ul className="option-list">
        {question.options.map((option) => (
          <OptionEditor
            key={option.id}
            option={option}
            targets={targets}
            currentModuleKey={moduleKey}
            onChanged={onChanged}
          />
        ))}
      </ul>

      <div className="row">
        <input
          placeholder="New option label"
          value={newOption}
          onChange={(e) => setNewOption(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addOption()}
        />
        <button onClick={addOption} disabled={!newOption.trim()}>
          Add option
        </button>
      </div>

      <p className="qid">
        <code>{question.id}</code> &middot; {question.incomingCount} option(s) point here
      </p>
    </li>
  );

  function addOption() {
    if (!newOption.trim()) return;
    void guard(
      adminApi
        .createOption({ questionId: question.id, label: newOption.trim() })
        .then(() => setNewOption("")),
    );
  }
}
