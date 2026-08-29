import { useState } from "react";
import { adminApi, type GraphOption } from "../../api/client";

export interface QuestionTarget {
  id: string;
  label: string;
  moduleKey: string;
}

interface Props {
  option: GraphOption;
  targets: QuestionTarget[];
  currentModuleKey: string;
  onChanged: () => void;
}

export function OptionEditor({ option, targets, currentModuleKey, onChanged }: Props) {
  const [label, setLabel] = useState(option.label);
  const [error, setError] = useState<string | null>(null);

  const save = (data: { label?: string; nextQuestionId?: string | null }) =>
    adminApi
      .updateOption(option.id, data)
      .then(onChanged)
      .catch((err: Error) => setError(err.message));

  return (
    <li className="option-row">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label !== option.label && void save({ label })}
      />
      <select
        value={option.nextQuestionId ?? ""}
        onChange={(e) => void save({ nextQuestionId: e.target.value || null })}
      >
        <option value="">— ends the module —</option>
        {groupByModule(targets, currentModuleKey).map(([moduleKey, group]) => (
          <optgroup
            key={moduleKey}
            label={moduleKey === currentModuleKey ? `${moduleKey} (this module)` : `${moduleKey} (switches module)`}
          >
            {group.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {option.switchesModule && <span className="tag">switches module</span>}

      <button
        className="ghost danger"
        onClick={() => void adminApi.deleteOption(option.id).then(onChanged)}
        title="Delete option"
      >
        ×
      </button>

      {error && <span className="tag tag-bad">{error}</span>}
    </li>
  );
}

/** Targets bucketed by module, with the current module first so it is one hop away. */
function groupByModule(targets: QuestionTarget[], currentModuleKey: string) {
  const groups = new Map<string, QuestionTarget[]>();
  for (const t of targets) {
    const group = groups.get(t.moduleKey);
    if (group) group.push(t);
    else groups.set(t.moduleKey, [t]);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === currentModuleKey ? -1 : b === currentModuleKey ? 1 : a.localeCompare(b),
  );
}
