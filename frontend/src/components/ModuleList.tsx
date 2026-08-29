import type { ModuleSummary, StateView } from "../api/client";

interface Props {
  modules: ModuleSummary[];
  state: StateView | null;
  busy: boolean;
  onStart: (key: string, restart: boolean) => void;
}

/**
 * Also the per-module state read-out: where the user stands in every module they
 * have touched, which is the other half of "state vs history".
 */
export function ModuleList({ modules, state, busy, onStart }: Props) {
  const byKey = new Map((state?.modules ?? []).map((m) => [m.moduleKey, m]));

  return (
    <ul className="modules">
      {modules.map((mod) => {
        const progress = byKey.get(mod.key);
        const active = state?.currentModule?.key === mod.key;
        const visited = Boolean(progress);
        const inProgress = Boolean(progress?.currentQuestionId);

        return (
          <li key={mod.key} className={active ? "module active" : "module"}>
            <div className="module-head">
              <strong>{mod.title}</strong>
              <code className="muted">{mod._count.questions}q</code>
            </div>
            <div className="eyebrow">{mod.key}</div>

            <div className="module-status muted">
              {!visited && "not started"}
              {visited && inProgress && (active ? "in progress (current)" : "in progress")}
              {visited && !inProgress && (progress?.completedAt ? "completed" : "left")}
              {progress && progress.contextResetSeq > 0 && (
                <> &middot; context reset at #{progress.contextResetSeq}</>
              )}
            </div>

            <div className="row">
              <button disabled={busy} onClick={() => onStart(mod.key, false)}>
                {inProgress ? "Resume" : "Start"}
              </button>
              {visited && (
                <button className="ghost" disabled={busy} onClick={() => onStart(mod.key, true)}>
                  Restart
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
