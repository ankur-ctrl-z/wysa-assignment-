import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, flowApi, type FlowResponse, type HistoryEvent, type QuestionView } from "../api/client";
import { useApi } from "../hooks/useApi";
import { HistoryPanel } from "../components/HistoryPanel";
import { ModuleList } from "../components/ModuleList";
import { QuestionCard } from "../components/QuestionCard";
import { UserPicker } from "../components/UserPicker";

type Notice = { tone: "info" | "warn" | "ok"; text: string; code?: string } | null;

/** Plain-English wording for the reason codes the API returns. */
const REASONS: Record<string, string> = {
  MODULE_NOT_STARTED: "You have not started that module yet, so here is its first question.",
  MODULE_NOT_ACTIVE: "You had already finished or left that module.",
  SUPERSEDED: "That link is out of date. Here is where you actually are.",
  STALE_CHECKPOINT: "You have passed a checkpoint since that link was made. Here is the current question.",
  QUESTION_GONE: "That question no longer exists. Here is where you actually are.",
  NO_ACTIVE_QUESTION: "Nothing in progress yet — pick a module to begin.",
};

export function PlayerPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get("user");
  const deepLinkQuestionId = params.get("questionId");

  const users = useApi(() => flowApi.users(), []);
  const modules = useApi(() => flowApi.modules(), []);

  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const selectUser = (id: string) => setParams({ user: id }, { replace: true });

  const refreshHistory = useCallback(async (id: string) => {
    setHistory(await flowApi.history(id));
  }, []);

  const syncUrl = useCallback(
    (question: QuestionView | null) => {
      if (!userId) return;
      const next: Record<string, string> = { user: userId };
      if (question) next.questionId = question.id;
      setParams(next, { replace: true });
    },
    [userId, setParams],
  );

  useEffect(() => {
    if (!userId) {
      setFlow(null);
      setHistory([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    flowApi
      .resume(userId, deepLinkQuestionId)
      .then(async (res) => {
        if (cancelled) return;
        setFlow(res);
        setNotice(
          res.redirected || res.reason === "NO_ACTIVE_QUESTION"
            ? { tone: "warn", text: REASONS[res.reason] ?? res.reason, code: res.reason }
            : null,
        );
        await refreshHistory(userId);
        if (res.question && res.question.id !== deepLinkQuestionId) syncUrl(res.question);
      })
      .catch((err: Error) => !cancelled && setNotice({ tone: "warn", text: err.message }))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const act = async (run: () => Promise<FlowResponse>, onReason?: (reason: string) => Notice) => {
    if (!userId) return;
    setBusy(true);
    try {
      const res = await run();
      setFlow(res);
      syncUrl(res.question);
      setNotice(onReason?.(res.reason) ?? null);
      await refreshHistory(userId);
    } catch (err) {
      if (err instanceof ApiError) {
        setNotice({ tone: "warn", text: err.message, code: err.code });
        const recovered = err.context.currentQuestion as QuestionView | undefined;
        if (recovered && flow) setFlow({ ...flow, question: recovered });
        await refreshHistory(userId);
      } else {
        setNotice({ tone: "warn", text: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  };

  const answer = (optionId: string) =>
    act(
      () => flowApi.answer(userId!, flow!.question!.id, optionId),
      (reason) =>
        reason === "MODULE_SWITCHED"
          ? { tone: "info", text: "You have moved to another module.", code: reason }
          : reason === "CHECKPOINT_REACHED"
            ? {
                tone: "info",
                text: "Checkpoint reached. Earlier answers stay in your history but no longer affect the flow.",
                code: reason,
              }
            : reason === "MODULE_COMPLETED"
              ? { tone: "ok", text: "Module complete. Pick another one to keep going.", code: reason }
              : null,
    );

  const openDeepLink = (questionId: string) => {
    if (!userId || !questionId.trim()) return;
    setParams({ user: userId, questionId: questionId.trim() }, { replace: true });
    void act(
      () => flowApi.resume(userId, questionId.trim()),
      (reason) =>
        reason === "EXACT"
          ? { tone: "ok", text: "That link is still valid.", code: reason }
          : { tone: "warn", text: REASONS[reason] ?? reason, code: reason },
    );
  };

  const step =
    1 +
    history.filter(
      (e) => e.kind === "ANSWERED" && e.isLiveContext && e.moduleId === flow?.question?.module.id,
    ).length;

  return (
    <div className="layout">
      <div>
        <UserPicker
          users={users.data ?? []}
          userId={userId}
          onSelect={selectUser}
          onCreated={users.reload}
          onDeleted={() => {
            setParams({}, { replace: true });
            setFlow(null);
            setHistory([]);
            setNotice({ tone: "ok", text: "User deleted, along with their entire conversation history." });
          }}
        />

        {!userId && <p className="muted">Pick a user to begin.</p>}

        {notice && (
          <div className={`notice notice-${notice.tone}`}>
            <span className="notice-icon" aria-hidden="true">
              {notice.tone === "warn" ? "!" : notice.tone === "ok" ? "✓" : "i"}
            </span>
            <span>{notice.text}</span>
            {notice.code && <span className="notice-code">{notice.code}</span>}
          </div>
        )}

        {userId && flow?.question && (
          <QuestionCard question={flow.question} step={step} busy={busy} onAnswer={answer} />
        )}

        {userId && !flow?.question && (
          <p className="muted">Nothing in progress. Start a module below.</p>
        )}

        {userId && (
          <div className="row">
            <button className="ghost" disabled={busy} onClick={() => void act(() => flowApi.back(userId))}>
              &larr; Back
            </button>
            <DeepLinkBox onOpen={openDeepLink} />
          </div>
        )}

        {userId && (
          <>
            <h3>Modules</h3>
            <ModuleList
              modules={modules.data ?? []}
              state={flow?.state ?? null}
              busy={busy}
              onStart={(key, restart) => void act(() => flowApi.start(userId, key, restart))}
            />
          </>
        )}
      </div>

      <aside>
        <HistoryPanel events={history} />
      </aside>
    </div>
  );
}

function DeepLinkBox({ onOpen }: { onOpen: (questionId: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <input
        placeholder="Open an old deep link (question id)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onOpen(value)}
      />
      <button className="ghost" onClick={() => onOpen(value)} disabled={!value.trim()}>
        Open
      </button>
    </>
  );
}
