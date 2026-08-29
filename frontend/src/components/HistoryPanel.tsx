import type { HistoryEvent } from "../api/client";

const LABELS: Record<string, string> = {
  PRESENTED: "Started",
  ANSWERED: "Answered",
  CHECKPOINT: "Checkpoint",
  MODULE_SWITCH: "Switched module",
  BACK: "Went back",
  COMPLETED: "Completed module",
};

/**
 * The complete history, never trimmed. Events on the far side of a checkpoint are
 * dimmed and chipped rather than hidden - that visible difference between
 * "history" and "live context" is what the checkpoint rule actually means.
 */
export function HistoryPanel({ events }: { events: HistoryEvent[] }) {
  const archived = events.filter((e) => !e.isLiveContext).length;

  return (
    <div className="panel">
      <h3>
        Conversation history
        <span className="muted">
          {events.length} event{events.length === 1 ? "" : "s"}
          {archived > 0 && ` · ${archived} archived`}
        </span>
      </h3>

      {events.length === 0 ? (
        <p className="muted">Nothing yet. Start a module to begin.</p>
      ) : (
        <ol className="history">
          {events.map((event) => (
            <li
              key={event.seq}
              className={`event event-${event.kind.toLowerCase()} ${event.isLiveContext ? "" : "archived"}`}
            >
              <div className="event-head">
                <span className="kind">{LABELS[event.kind] ?? event.kind}</span>
                <span className="seq">#{event.seq}</span>
                <span className="muted">{event.moduleTitle}</span>
                {!event.isLiveContext && (
                  <span className="tag" title="Kept in history, but no longer affects the flow">
                    before checkpoint
                  </span>
                )}
              </div>
              <div className="event-text">{event.questionText}</div>
              {event.optionLabel && <div className="event-answer">&rarr; {event.optionLabel}</div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
