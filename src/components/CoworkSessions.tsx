"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listCoworkSessions,
  setCoworkArchived,
  type CoworkSummary,
} from "@/lib/tauri-fs";

type LoadState =
  | { kind: "loading" }
  | {
      kind: "ok";
      sessions: CoworkSummary[];
      pinnedOrder: string[];
      pinnedOrderWarning: string | null;
    }
  | { kind: "err"; message: string };

type SortKey = "title" | "lastActivityAt" | "createdAt" | "model";
type SortDir = "asc" | "desc";

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtAbs(ms: number | null): string {
  if (!ms) return "unknown";
  return new Date(ms).toLocaleString();
}

function formatError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

function lastPathSegment(p: string | null, n = 2): string {
  if (!p) return "";
  return p.split(/[\\/]/).filter(Boolean).slice(-n).join("/");
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (s: CoworkSummary) => void;
};

export function CoworkSessions({ open, onClose, onSelect }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("lastActivityAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    listCoworkSessions()
      .then((listing) =>
        setState({
          kind: "ok",
          sessions: listing.sessions,
          pinnedOrder: listing.pinnedOrder,
          pinnedOrderWarning: listing.pinnedOrderWarning,
        }),
      )
      .catch((e) => setState({ kind: "err", message: formatError(e) }));
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setStarredOnly(false);
      setShowArchived(false);
      setSelected(new Set());
      setBusy(null);
      return;
    }
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sorted = useMemo(() => {
    if (state.kind !== "ok") return [];
    const arr = [...state.sessions];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortKey) {
        case "title":
          av = a.title.toLowerCase();
          bv = b.title.toLowerCase();
          break;
        case "lastActivityAt":
          av = a.lastActivityAt;
          bv = b.lastActivityAt;
          break;
        case "createdAt":
          av = a.createdAt;
          bv = b.createdAt;
          break;
        case "model":
          av = (a.model ?? "").toLowerCase();
          bv = (b.model ?? "").toLowerCase();
          break;
      }
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [state, sortKey, sortDir]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sorted.filter((s) => {
      if (!showArchived && s.isArchived) return false;
      if (starredOnly && !s.isStarred) return false;
      if (!q) return true;
      const hay = `${s.title}\n${s.initialMessage ?? ""}\n${s.cwd ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, query, showArchived, starredOnly]);

  // Mirror Claude's sidebar: Pinned section above, Recent below.
  // Recent honors the active sort. Pinned honors Claude Desktop's
  // explicit `pinnedOrder` first (top-of-sidebar manual order), then
  // any starred sessions not in that array fall in below in the active
  // sort — matching what Claude shows when you've only manually placed
  // a few chats at the top and let the rest sit in the default order.
  const pinned = useMemo(() => {
    const starred = filtered.filter((s) => s.isStarred);
    const order = state.kind === "ok" ? state.pinnedOrder : [];
    if (order.length === 0) return starred;
    const byId = new Map(starred.map((s) => [s.sessionId, s]));
    const seen = new Set<string>();
    const head: CoworkSummary[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s && !seen.has(id)) {
        head.push(s);
        seen.add(id);
      }
    }
    const tail = starred.filter((s) => !seen.has(s.sessionId));
    return [...head, ...tail];
  }, [filtered, state]);
  const recent = useMemo(
    () => filtered.filter((s) => !s.isStarred),
    [filtered],
  );

  const selectedSummaries = useMemo(() => {
    if (state.kind !== "ok") return [] as CoworkSummary[];
    return state.sessions.filter((s) => selected.has(s.sessionId));
  }, [state, selected]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.sessionId));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" || key === "model" ? "asc" : "desc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const s of filtered) next.delete(s.sessionId);
      } else {
        for (const s of filtered) next.add(s.sessionId);
      }
      return next;
    });
  };

  const runBulkArchive = useCallback(
    async (archived: boolean) => {
      if (selectedSummaries.length === 0) return;
      const action = archived ? "archive" : "unarchive";
      if (
        !window.confirm(
          `${archived ? "Archive" : "Unarchive"} ${selectedSummaries.length} session${
            selectedSummaries.length === 1 ? "" : "s"
          }?\n\nThis writes to Claude Desktop's session files. If Claude Desktop is open with one of these sessions, your change may be reverted on close.`,
        )
      ) {
        return;
      }
      setBusy(action);
      try {
        const paths = selectedSummaries.map((s) => s.sourcePath);
        const result = await setCoworkArchived(paths, archived);
        setSelected(new Set());
        refresh();
        if (result.failed.length > 0) {
          window.alert(
            `${result.updated} updated, ${result.failed.length} failed.\n\n` +
              result.failed
                .slice(0, 5)
                .map((f) => `${lastPathSegment(f.path, 1)}: ${f.reason}`)
                .join("\n"),
          );
        }
      } catch (e) {
        window.alert(`Bulk ${action} failed: ${formatError(e)}`);
      } finally {
        setBusy(null);
      }
    },
    [selectedSummaries, refresh],
  );

  if (!open) return null;

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const renderRow = (s: CoworkSummary) => {
    const isSel = selected.has(s.sessionId);
    return (
      <tr
        key={s.sessionId}
        onClick={() => {
          onSelect(s);
          onClose();
        }}
        className={`cursor-pointer border-b border-[var(--border)] transition ${
          isSel ? "bg-[var(--accent-tint)]" : "hover:bg-[var(--surface-2)]"
        } ${s.isArchived ? "opacity-60" : ""}`}
      >
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSel}
            onChange={() => toggleSelect(s.sessionId)}
            className="accent-[var(--accent)]"
            aria-label={`Select ${s.title}`}
          />
        </td>
        <td className="px-1 py-1.5 text-center text-[var(--warning)]">
          {s.isStarred ? "★" : ""}
        </td>
        <td className="max-w-0 truncate px-2 py-1.5 text-[var(--text)]">
          {s.title}
        </td>
        <td
          className="px-2 py-1.5 font-mono text-[10px] text-[var(--text-dim)]"
          title={fmtAbs(s.lastActivityAt)}
        >
          {fmtDate(s.lastActivityAt)}
        </td>
        <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--text-dim)]">
          {s.model ?? "—"}
        </td>
        <td
          className="truncate px-2 py-1.5 font-mono text-[10px] text-[var(--text-dim)]"
          title={s.cwd ?? ""}
        >
          {lastPathSegment(s.cwd, 2)}
        </td>
        <td className="px-2 py-1.5 text-center text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          {s.isArchived ? "archived" : ""}
        </td>
      </tr>
    );
  };

  const sectionHeader = (
    label: string,
    count: number,
    warning?: string | null,
  ) => (
    <tr className="bg-[var(--bg)]">
      <td
        colSpan={7}
        className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
      >
        {label} <span className="text-[var(--text-faint)]">· {count}</span>
        {warning && (
          <span
            className="ml-2 normal-case tracking-normal text-[var(--warning)]"
            title={warning}
          >
            ⚠ pin order unavailable — using default sort
          </span>
        )}
      </td>
    </tr>
  );

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-[5vh] flex max-h-[90vh] w-[min(1200px,95vw)] flex-col overflow-hidden rounded-lg bg-[var(--surface)] shadow-2xl ring-1 ring-[var(--border-strong)]"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-sm font-medium text-[var(--text)]">
              Cowork sessions
            </h2>
            {state.kind === "ok" && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {filtered.length}/{state.sessions.length} shown
                {state.sessions.filter((s) => s.isStarred).length > 0 && (
                  <> · {state.sessions.filter((s) => s.isStarred).length} ★</>
                )}
                {state.sessions.filter((s) => s.isArchived).length > 0 && (
                  <> · {state.sessions.filter((s) => s.isArchived).length} archived</>
                )}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, initial prompt, working folder…"
            className="min-w-[200px] flex-1 rounded-md bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--text)] outline-none ring-1 ring-transparent placeholder:text-[var(--text-muted)] focus:ring-[var(--accent)]/40"
          />
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={starredOnly}
              onChange={(e) => setStarredOnly(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            ★ only
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            show archived
          </label>
        </div>

        {/* Bulk action bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-[10px]">
          <span className="text-[var(--text-muted)]">
            {selected.size} selected
          </span>
          <span className="flex-1" />
          <button
            disabled={selected.size === 0 || busy !== null}
            onClick={() => runBulkArchive(true)}
            className="rounded-md bg-[var(--surface-2)] px-2.5 py-1 text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "archive" ? "…" : `Archive (${selected.size})`}
          </button>
          <button
            disabled={selected.size === 0 || busy !== null}
            onClick={() => runBulkArchive(false)}
            className="rounded-md bg-[var(--surface-2)] px-2.5 py-1 text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "unarchive" ? "…" : `Unarchive (${selected.size})`}
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {state.kind === "loading" && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              Scanning sessions…
            </div>
          )}
          {state.kind === "err" && (
            <div className="py-8 text-center text-xs text-[var(--danger)]">
              {state.message}
              <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                On WSL dev, set <code>PRMPTR_COWORK_PATH</code> to your
                local-agent-mode-sessions directory.
              </div>
            </div>
          )}
          {state.kind === "ok" && filtered.length === 0 && (
            <div className="py-8 text-center text-xs text-[var(--text-muted)]">
              No sessions match.
            </div>
          )}
          {state.kind === "ok" && filtered.length > 0 && (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="w-8 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAllFiltered}
                      className="accent-[var(--accent)]"
                      aria-label="Select all visible"
                    />
                  </th>
                  <th className="w-6 px-1 py-2 text-center">★</th>
                  <th
                    className="cursor-pointer px-2 py-2 select-none hover:text-[var(--text)]"
                    onClick={() => toggleSort("title")}
                  >
                    Title{sortArrow("title")}
                  </th>
                  <th
                    className="w-32 cursor-pointer px-2 py-2 select-none hover:text-[var(--text)]"
                    onClick={() => toggleSort("lastActivityAt")}
                  >
                    Last activity{sortArrow("lastActivityAt")}
                  </th>
                  <th
                    className="w-40 cursor-pointer px-2 py-2 select-none hover:text-[var(--text)]"
                    onClick={() => toggleSort("model")}
                  >
                    Model{sortArrow("model")}
                  </th>
                  <th className="w-56 px-2 py-2">Folder</th>
                  <th className="w-20 px-2 py-2 text-center">State</th>
                </tr>
              </thead>
              <tbody>
                {pinned.length > 0 && (
                  <>
                    {sectionHeader(
                      "Pinned",
                      pinned.length,
                      state.kind === "ok" ? state.pinnedOrderWarning : null,
                    )}
                    {pinned.map(renderRow)}
                  </>
                )}
                {recent.length > 0 && (
                  <>
                    {sectionHeader("Recent", recent.length)}
                    {recent.map(renderRow)}
                  </>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
