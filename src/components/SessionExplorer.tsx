"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveSessions,
  listClaudeSessions,
  readClaudeSessionTail,
  unarchiveSessions,
  type ClaudeMessageBrief,
  type ClaudeSessionSummary,
} from "@/lib/tauri-fs";
import { formatError } from "@/lib/errors";

type Filter = "active" | "archived" | "all";

const TAIL_SIZE = 6;
// Width of the hover terminal preview, in monospace chars. Matches a typical
// Claude Code terminal viewport.
const TERMINAL_COLS = 96;

type TailState =
  | { kind: "loading" }
  | { kind: "ok"; messages: ClaudeMessageBrief[] }
  | { kind: "err"; message: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; sessions: ClaudeSessionSummary[] }
  | { kind: "err"; message: string };

// Inline panel — rendered inside the Claude Code root tab.

function fmtWhen(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  // MM-DD HH:MM in local time, matching the user's requested format.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function fmtTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(s: string, max = 1200): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function SessionTailPreview({ tail }: { tail: TailState | undefined }) {
  if (!tail || tail.kind === "loading") {
    return (
      <div className="text-[11px] text-[var(--text-muted)]">Loading tail…</div>
    );
  }
  if (tail.kind === "err") {
    return (
      <div className="text-[11px] text-[var(--danger)]">{tail.message}</div>
    );
  }
  if (tail.messages.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-muted)]">
        No visible messages — session may be all tool calls / system events.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 font-sans text-[12px]">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
        Last {tail.messages.length} message{tail.messages.length === 1 ? "" : "s"}
      </div>
      {tail.messages.map((m, i) => (
        <div
          key={i}
          className={`rounded-md border border-[var(--border)] px-3 py-2 ${
            m.role === "user"
              ? "bg-[var(--surface)]"
              : "bg-[var(--surface-2)]"
          }`}
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider">
            <span
              className={
                m.role === "user"
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-dim)]"
              }
            >
              {m.role}
            </span>
            {m.timestamp && (
              <span className="text-[var(--text-muted)]">
                {fmtTimestamp(m.timestamp)}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap break-words text-[var(--text)]">
            {truncate(m.text)}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SessionExplorer() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("active");
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [tails, setTails] = useState<Map<string, TailState>>(new Map());
  const [hover, setHover] = useState<{
    path: string;
    session: ClaudeSessionSummary;
    rect: DOMRect;
  } | null>(null);

  const refresh = useCallback((f: Filter) => {
    setState({ kind: "loading" });
    setExpandedPath(null);
    setHover(null);
    setTails(new Map());
    // "active" still asks for archived=false so the listing skips the
    // archive scan entirely; "archived" and "all" need archived=true to
    // pull both roots, then we filter client-side.
    const includeArchived = f !== "active";
    listClaudeSessions(includeArchived)
      .then((sessions) => setState({ kind: "ok", sessions }))
      .catch((e) => setState({ kind: "err", message: formatError(e) }));
  }, []);

  const ensureTail = useCallback(
    (path: string) => {
      setTails((m) => {
        if (m.has(path)) return m;
        const next = new Map(m).set(path, { kind: "loading" } as TailState);
        readClaudeSessionTail(path, TAIL_SIZE)
          .then((messages) =>
            setTails((cur) =>
              new Map(cur).set(path, { kind: "ok", messages }),
            ),
          )
          .catch((e) =>
            setTails((cur) =>
              new Map(cur).set(path, {
                kind: "err",
                message: formatError(e),
              }),
            ),
          );
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setOpError(null);
    refresh(filter);
  }, [filter, refresh]);

  const handleArchive = useCallback(
    async (path: string, action: "archive" | "unarchive") => {
      setBusyPath(path);
      setOpError(null);
      try {
        const fn = action === "archive" ? archiveSessions : unarchiveSessions;
        const result = await fn([path]);
        if (result.failed.length > 0) {
          setOpError(result.failed[0].reason);
        }
        refresh(filter);
      } catch (e) {
        setOpError(formatError(e));
      } finally {
        setBusyPath(null);
      }
    },
    [filter, refresh],
  );

  const visibleSessions = useMemo(() => {
    if (state.kind !== "ok") return [];
    if (filter === "active") return state.sessions.filter((s) => !s.archived);
    if (filter === "archived") return state.sessions.filter((s) => s.archived);
    return state.sessions;
  }, [state, filter]);

  const toggleExpand = useCallback(
    (path: string) => {
      if (expandedPath === path) {
        setExpandedPath(null);
        return;
      }
      setExpandedPath(path);
      ensureTail(path);
    },
    [expandedPath, ensureTail],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--surface)]">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2">
          <h2 className="font-mono text-sm text-[var(--text)]">
            Session explorer
            {state.kind === "ok" && (
              <span className="ml-2 text-xs text-[var(--text-muted)]">
                {visibleSessions.length} of {state.sessions.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            <FilterToggle value={filter} onChange={setFilter} />
          </div>
        </header>

        {opError && (
          <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--danger)]/10 px-4 py-1.5 text-[11px] text-[var(--danger)]">
            {opError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {state.kind === "loading" && (
            <div className="p-6 text-sm text-[var(--text-muted)]">Loading…</div>
          )}
          {state.kind === "err" && (
            <div className="p-6 text-sm text-[var(--danger)]">
              {state.message}
            </div>
          )}
          {state.kind === "ok" && visibleSessions.length === 0 && (
            <div className="p-6 text-sm text-[var(--text-muted)]">
              {filter === "archived"
                ? "No archived sessions yet."
                : filter === "active"
                  ? "No active sessions for this repo."
                  : "No sessions found for this repo."}
            </div>
          )}
          {state.kind === "ok" && visibleSessions.length > 0 && (
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead className="sticky top-0 bg-[var(--surface-2)] text-[var(--text-dim)]">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">When</th>
                  <th className="px-3 py-1.5 text-right font-medium">Size</th>
                  <th className="px-3 py-1.5 text-right font-medium">Turns</th>
                  <th className="px-3 py-1.5 text-left font-medium">Worktree</th>
                  <th className="px-3 py-1.5 text-left font-medium">ID</th>
                  <th className="px-3 py-1.5 text-left font-medium">Topic</th>
                  <th className="px-3 py-1.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((s) => {
                  const isOpen = expandedPath === s.sourcePath;
                  const tail = tails.get(s.sourcePath);
                  return (
                    <Fragment key={s.sourcePath}>
                      <tr
                        onClick={() => toggleExpand(s.sourcePath)}
                        onMouseEnter={(e) => {
                          ensureTail(s.sourcePath);
                          setHover({
                            path: s.sourcePath,
                            session: s,
                            rect: e.currentTarget.getBoundingClientRect(),
                          });
                        }}
                        onMouseLeave={() =>
                          setHover((h) =>
                            h && h.path === s.sourcePath ? null : h,
                          )
                        }
                        className={`cursor-pointer border-t border-[var(--border)] text-[var(--text)] transition hover:bg-[var(--surface-2)] ${
                          isOpen ? "bg-[var(--surface-2)]" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 text-[var(--text-dim)]">
                          <span className="mr-1 inline-block w-3 text-[var(--text-muted)]">
                            {isOpen ? "▾" : "▸"}
                          </span>
                          {fmtWhen(s.whenUnixMs)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-[var(--text-dim)]">
                          {fmtSize(s.sizeBytes)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right text-[var(--text-dim)]">
                          {s.turns}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span
                            className={
                              s.worktree === "(main)"
                                ? "text-[var(--text-muted)]"
                                : "text-[var(--accent)]"
                            }
                          >
                            {s.worktree}
                          </span>
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-1.5 text-[var(--text-muted)]"
                          title={s.id}
                        >
                          {shortId(s.id)}
                        </td>
                        <td
                          className="max-w-[640px] truncate px-3 py-1.5"
                          title={s.topic}
                        >
                          {s.topic || (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td
                          className="whitespace-nowrap px-3 py-1.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            disabled={busyPath === s.sourcePath}
                            onClick={() =>
                              handleArchive(
                                s.sourcePath,
                                s.archived ? "unarchive" : "archive",
                              )
                            }
                            className="rounded px-2 py-0.5 text-[10px] text-[var(--text-dim)] transition hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                            title={
                              s.archived
                                ? "Move back to ~/.claude/projects/"
                                : "Move to ~/.claude/projects-archive/"
                            }
                          >
                            {busyPath === s.sourcePath
                              ? "…"
                              : s.archived
                                ? "Unarchive"
                                : "Archive"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-[var(--bg)]">
                          <td colSpan={7} className="px-6 py-3">
                            <SessionTailPreview tail={tail} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {hover && (
          <SessionHoverCard
            session={hover.session}
            rect={hover.rect}
            tail={tails.get(hover.path)}
          />
        )}
    </div>
  );
}

function SessionHoverCard({
  session,
  rect,
  tail,
}: {
  session: ClaudeSessionSummary;
  rect: DOMRect;
  tail: TailState | undefined;
}) {
  // Position: prefer right side of the row, fall back to left if the right
  // would overflow the viewport. Vertically centered against the row, then
  // clamped into the viewport with an 8px margin.
  const cardWidthPx = TERMINAL_COLS * 8 + 24; // ~8px/ch monospace + padding
  const cardMaxHeight = Math.min(560, window.innerHeight - 32);
  const margin = 8;
  let left = rect.right + margin;
  if (left + cardWidthPx > window.innerWidth - margin) {
    left = Math.max(margin, rect.left - cardWidthPx - margin);
  }
  let top = rect.top + rect.height / 2 - cardMaxHeight / 2;
  top = Math.max(margin, Math.min(top, window.innerHeight - cardMaxHeight - margin));

  return (
    <div
      className="pointer-events-none fixed z-40 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[#0a0908] font-mono text-[12px] text-[var(--text)] shadow-2xl"
      style={{
        left,
        top,
        width: `${TERMINAL_COLS}ch`,
        maxHeight: cardMaxHeight,
      }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[#161514] px-2.5 py-1 text-[10px] text-[var(--text-muted)]">
        <span>
          ● claude — {session.worktree} · {shortId(session.id)}
        </span>
        <span>
          {session.turns} turns · {fmtSize(session.sizeBytes)}
        </span>
      </div>
      <div className="overflow-hidden p-3" style={{ maxHeight: cardMaxHeight - 28 }}>
        {(!tail || tail.kind === "loading") && (
          <div className="text-[var(--text-muted)]">Loading session tail…</div>
        )}
        {tail?.kind === "err" && (
          <div className="text-[var(--danger)]">{tail.message}</div>
        )}
        {tail?.kind === "ok" && tail.messages.length === 0 && (
          <div className="text-[var(--text-muted)]">
            No visible messages — session is all tool calls / system events.
          </div>
        )}
        {tail?.kind === "ok" && tail.messages.length > 0 && (
          <div className="flex flex-col gap-3">
            {tail.messages.map((m, i) => (
              <TerminalMessage key={i} msg={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterToggle({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (v: Filter) => void;
}) {
  const opts: { value: Filter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "all", label: "All" },
  ];
  return (
    <div className="flex overflow-hidden rounded-md ring-1 ring-[var(--border)]">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 text-[11px] transition ${
            value === o.value
              ? "bg-[var(--surface-2)] text-[var(--text)]"
              : "text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TerminalMessage({ msg }: { msg: ClaudeMessageBrief }) {
  const isUser = msg.role === "user";
  const marker = isUser ? ">" : "⏺";
  const markerColor = isUser ? "text-[#a3e635]" : "text-[var(--accent)]";
  // Hard cap per-message preview so a single long message can't dominate.
  const text = msg.text.length > 1400 ? msg.text.slice(0, 1400) + "…" : msg.text;
  return (
    <div className="flex gap-2">
      <span className={`flex-shrink-0 ${markerColor}`}>{marker}</span>
      <div
        className={`whitespace-pre-wrap break-words ${
          isUser ? "text-[var(--text)]" : "text-[var(--text-dim)]"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
