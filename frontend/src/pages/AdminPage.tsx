import { useCallback, useEffect, useState } from "react";
import { adminApi, flowApi, type FlowIssue, type ModuleGraph, type ModuleSummary } from "../api/client";
import { QuestionEditor } from "../components/admin/QuestionEditor";
import type { QuestionTarget } from "../components/admin/OptionEditor";
import { ValidationPanel } from "../components/admin/ValidationPanel";

/**
 * Flow authoring. Every option's target is chosen from every question in the
 * system, which is how a cross-module jump gets created - there is no separate
 * "switch module" concept to configure.
 */
export function AdminPage() {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [graphs, setGraphs] = useState<ModuleGraph[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ ok: boolean; issues: FlowIssue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ key: "", title: "" });
  const [newQuestion, setNewQuestion] = useState("");

  const load = useCallback(async () => {
    const list = await flowApi.modules();
    setModules(list);
    setGraphs(await Promise.all(list.map((m) => adminApi.graph(m.key))));
    setSelected((current) => current ?? list[0]?.key ?? null);
  }, []);

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    void adminApi
      .validate(selected)
      .then(setValidation)
      .catch(() => setValidation(null));
  }, [selected, graphs]);

  const graph = graphs.find((g) => g.key === selected) ?? null;

  // Every question in the system, so any option can point anywhere.
  const targets: QuestionTarget[] = graphs.flatMap((g) =>
    g.questions.map((q) => ({
      id: q.id,
      moduleKey: g.key,
      label: q.text.length > 60 ? `${q.text.slice(0, 57)}...` : q.text,
    })),
  );

  const guard = (p: Promise<unknown>) =>
    p
      .then(() => {
        setError(null);
        return load();
      })
      .catch((err: Error) => setError(err.message));

  // NOTE: the editor column comes FIRST in the DOM. `.layout` is a
  // `1fr | 390px` grid, so rendering the sidebar first put the narrow module list
  // in the wide column and squeezed the question editor into 390px.
  return (
    <div className="layout">
      <div>
        {error && <div className="notice notice-warn">{error}</div>}

        {graph && (
          <>
            <div className="row space-between">
              <h2>
                {graph.title} <code className="muted">{graph.key}</code>
              </h2>
              <button className="ghost danger" onClick={() => void guard(adminApi.deleteModule(graph.key))}>
                Delete module
              </button>
            </div>

            {validation && <ValidationPanel ok={validation.ok} issues={validation.issues} />}

            <ul className="q-list">
              {graph.questions.map((question) => (
                <QuestionEditor
                  key={question.id}
                  question={question}
                  moduleKey={graph.key}
                  targets={targets}
                  onChanged={() => void load()}
                />
              ))}
            </ul>

            <div className="row">
              <input
                placeholder="New question text"
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuestion()}
              />
              <button onClick={addQuestion} disabled={!newQuestion.trim()}>
                Add question
              </button>
            </div>
          </>
        )}

        {!graph && <p className="muted">No modules yet. Create one in the panel on the right.</p>}
      </div>

      <aside>
        {/* The form sits above the list: creating a module is the action, the
            list below is the result of it. */}
        <div className="panel">
          <h3>New module</h3>
          <div className="stack">
            <input
              placeholder="key (lowercase-hyphens)"
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
            />
            <input
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <button
              disabled={!draft.key.trim() || !draft.title.trim()}
              onClick={() =>
                void guard(
                  adminApi
                    .createModule(draft.key.trim(), draft.title.trim())
                    .then(() => setDraft({ key: "", title: "" })),
                )
              }
            >
              Create module
            </button>
          </div>

          <h3 style={{ marginTop: "1.4rem" }}>
            Modules <span className="muted">{modules.length}</span>
          </h3>
          <ul className="module-nav">
            {modules.map((mod) => (
              <li key={mod.key}>
                <button
                  className={mod.key === selected ? "nav active" : "nav"}
                  onClick={() => setSelected(mod.key)}
                >
                  <span>{mod.title}</span>
                  <span className="nav-count">{mod._count.questions}q</span>
                  <span className="nav-key">{mod.key}</span>
                </button>
              </li>
            ))}
            {modules.length === 0 && <li className="muted">None yet.</li>}
          </ul>
        </div>
      </aside>
    </div>
  );

  function addQuestion() {
    if (!graph || !newQuestion.trim()) return;
    void guard(
      adminApi
        .createQuestion({ moduleKey: graph.key, text: newQuestion.trim() })
        .then(() => setNewQuestion("")),
    );
  }
}
