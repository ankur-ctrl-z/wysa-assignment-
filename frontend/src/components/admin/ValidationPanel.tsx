import type { FlowIssue } from "../../api/client";

export function ValidationPanel({ ok, issues }: { ok: boolean; issues: FlowIssue[] }) {
  return (
    <div className="validation">
      <div className={ok ? "notice notice-ok" : "notice notice-warn"}>
        {ok ? "This module can be started." : "This module has errors and cannot be started."}
      </div>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue, i) => (
            <li key={i} className={`issue issue-${issue.severity}`}>
              <span className="tag">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
