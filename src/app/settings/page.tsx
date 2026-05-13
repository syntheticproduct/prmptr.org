"use client";

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatError } from "@/lib/errors";

type DirChild = {
  name: string;
  isDir: boolean;
  sizeBytes: number;
  childCount: number | null;
};

type EntryBody =
  | {
      kind: "file";
      sizeBytes: number;
      lineCount: number | null;
      content: string;
      truncated: boolean;
      modifiedUnixMs: number | null;
    }
  | {
      kind: "dir";
      entryCount: number;
      truncated: boolean;
      children: DirChild[];
      totalSizeBytes: number;
    }
  | { kind: "missing" }
  | { kind: "error"; message: string };

type ConfigEntry = {
  label: string;
  path: string;
  note: string | null;
  body: EntryBody;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function relTime(ms: number | null): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return new Date(ms).toLocaleString();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export default function GlobalSettingsPage() {
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    invoke<ConfigEntry[]>("read_global_settings")
      .then((data) => {
        setEntries(data);
        // Expand the four small top-level files by default; collapse dirs.
        setExpanded(
          new Set(
            data
              .filter((e) => e.body.kind === "file" && e.body.sizeBytes < 32 * 1024)
              .slice(0, 4)
              .map((e) => e.path),
          ),
        );
      })
      .catch((e) => setError(formatError(e)));
  }, []);

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <main className="min-h-dvh bg-[var(--bg)] p-6 text-[var(--text)]">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-baseline justify-between">
          <h1 className="font-mono text-lg font-medium">
            Global Settings
            <span className="ml-2 text-[var(--text-muted)]">·</span>
            <span className="ml-2 font-sans text-xs text-[var(--text-muted)]">
              ~/.claude/
            </span>
          </h1>
          {entries && (
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {entries.length} entries
            </span>
          )}
        </header>

        {error && (
          <div className="rounded-lg bg-[var(--surface)] p-4 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}

        {!entries && !error && (
          <div className="text-xs text-[var(--text-muted)]">Scanning…</div>
        )}

        <div className="space-y-2">
          {entries?.map((e) => (
            <EntryCard
              key={e.path}
              entry={e}
              isOpen={expanded.has(e.path)}
              onToggle={() => toggle(e.path)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function EntryCard({
  entry,
  isOpen,
  onToggle,
}: {
  entry: ConfigEntry;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const summary = (() => {
    switch (entry.body.kind) {
      case "file":
        return `${formatBytes(entry.body.sizeBytes)}${
          entry.body.lineCount != null ? ` · ${entry.body.lineCount.toLocaleString()} lines` : ""
        }${entry.body.modifiedUnixMs ? ` · ${relTime(entry.body.modifiedUnixMs)}` : ""}`;
      case "dir":
        return `${entry.body.entryCount.toLocaleString()} entries · ${formatBytes(
          entry.body.totalSizeBytes,
        )}`;
      case "missing":
        return "missing";
      case "error":
        return "error";
    }
  })();

  const isMissing = entry.body.kind === "missing";

  return (
    <div
      className={`rounded-lg bg-[var(--surface)] ring-1 ring-[var(--border)] ${
        isMissing ? "opacity-50" : ""
      }`}
    >
      <button
        onClick={onToggle}
        disabled={isMissing}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-2)] disabled:cursor-default disabled:hover:bg-[var(--surface)]"
      >
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          <span
            className={`flex-shrink-0 text-[var(--text-muted)] transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate font-mono text-sm text-[var(--text)]">
              {entry.label}
            </span>
            {entry.note && (
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                {entry.note}
              </span>
            )}
          </div>
        </div>
        <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-dim)]">
          {summary}
        </span>
      </button>

      {isOpen && entry.body.kind === "file" && (
        <div className="border-t border-[var(--border)]">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--text-dim)]">
            {entry.body.content}
          </pre>
          {entry.body.truncated && (
            <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
              Truncated. Full file is {formatBytes(entry.body.sizeBytes)}.
            </div>
          )}
        </div>
      )}

      {isOpen && entry.body.kind === "dir" && (
        <div className="border-t border-[var(--border)]">
          {entry.body.children.length === 0 ? (
            <div className="px-4 py-3 text-[10px] text-[var(--text-muted)]">
              Empty.
            </div>
          ) : (
            <ul className="max-h-[40vh] overflow-auto">
              {entry.body.children.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-1.5 text-[11px] last:border-b-0"
                >
                  <span className="flex items-center gap-2 truncate text-[var(--text-dim)]">
                    <span className="text-[var(--text-muted)]">
                      {c.isDir ? "📁" : "📄"}
                    </span>
                    <span className="truncate font-mono">{c.name}</span>
                    {c.isDir && c.childCount != null && (
                      <span className="text-[var(--text-muted)]">
                        ({c.childCount.toLocaleString()})
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                    {c.isDir ? "" : formatBytes(c.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {entry.body.truncated && (
            <div className="border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
              Showing first 200 entries.
            </div>
          )}
        </div>
      )}

      {isOpen && entry.body.kind === "error" && (
        <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--danger)]">
          {entry.body.message}
        </div>
      )}
    </div>
  );
}
