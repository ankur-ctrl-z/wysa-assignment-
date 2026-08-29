import { useState } from "react";
import type { User } from "../api/client";
import { flowApi } from "../api/client";

interface Props {
  users: User[];
  userId: string | null;
  onSelect: (id: string) => void;
  onCreated: () => void;
  /** Called after a user is deleted, so the page can clear what it was showing. */
  onDeleted: () => void;
}

export function UserPicker({ users, userId, onSelect, onCreated, onDeleted }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = users.find((u) => u.id === userId) ?? null;

  const create = async () => {
    if (!name.trim()) return;
    const user = await flowApi.createUser(name.trim());
    setName("");
    onCreated();
    onSelect(user.id);
  };

  const remove = async () => {
    if (!selected) return;
    // Native confirm: this destroys data, and a bespoke modal would be more code
    // than the guard is worth.
    const ok = window.confirm(
      `Delete ${selected.name}?\n\nTheir entire conversation history and progress in every module will be deleted too. This cannot be undone.`,
    );
    if (!ok) return;

    setBusy(true);
    try {
      await flowApi.deleteUser(selected.id);
      onDeleted();
      onCreated(); // reloads the user list
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <label>
        User
        <select value={userId ?? ""} onChange={(e) => onSelect(e.target.value)}>
          <option value="" disabled>
            Choose a user
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <button
          className="ghost danger"
          onClick={() => void remove()}
          disabled={busy}
          title="Delete this user and all of their conversation history"
        >
          Delete user
        </button>
      )}

      <span className="muted">|</span>

      <input
        placeholder="New user name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void create()}
      />
      <button onClick={() => void create()} disabled={!name.trim()}>
        Add
      </button>
    </div>
  );
}
